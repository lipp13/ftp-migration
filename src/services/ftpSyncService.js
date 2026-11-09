const fs = require('fs');
const path = require('path');
const ftp = require('basic-ftp');
const { query } = require('../config/db');
const ingestionService = require('./ingestionService');

class FtpSyncService {
  constructor(options = {}) {
    this.incomingDir = options.incomingDir || path.resolve(__dirname, '../../storage/ftp_simulator/incoming');
    this.processedDir = options.processedDir || path.resolve(__dirname, '../../storage/ftp_simulator/processed');
    this.isSyncing = false;

    this.ensureDirectories();
  }

  ensureDirectories() {
    [this.incomingDir, this.processedDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Mengambil riwayat sync dari PostgreSQL berdasarkan remote path
   * @param {string} remotePath
   * @returns {Promise<Map<string, Object>>}
   */
  async getSyncMap(remotePath) {
    const res = await query(
      'SELECT id, filename, file_size, remote_modified_at, sync_status FROM ftp_sync_files WHERE remote_path = $1',
      [remotePath]
    );

    const map = new Map();
    res.rows.forEach((row) => {
      map.set(row.filename, {
        id: row.id,
        file_size: Number(row.file_size),
        remote_modified_at: new Date(row.remote_modified_at),
        sync_status: row.sync_status,
      });
    });

    return map;
  }

  /**
   * Catat status sinkronisasi sukses
   */
  async recordSyncSuccess(remotePath, filename, fileSize, remoteModifiedAt, status = 'INGESTED') {
    const sql = `
      INSERT INTO ftp_sync_files (remote_path, filename, file_size, remote_modified_at, sync_status, last_synced_at, last_error)
      VALUES ($1, $2, $3, $4, $5, NOW(), NULL)
      ON CONFLICT (remote_path, filename)
      DO UPDATE SET
        file_size = EXCLUDED.file_size,
        remote_modified_at = EXCLUDED.remote_modified_at,
        sync_status = EXCLUDED.sync_status,
        last_synced_at = NOW(),
        last_error = NULL;
    `;
    await query(sql, [remotePath, filename, fileSize, remoteModifiedAt, status]);
  }

  /**
   * Catat status sinkronisasi gagal
   */
  async recordSyncError(remotePath, filename, fileSize, remoteModifiedAt, errorMsg) {
    const sql = `
      INSERT INTO ftp_sync_files (remote_path, filename, file_size, remote_modified_at, sync_status, last_synced_at, last_error)
      VALUES ($1, $2, $3, $4, 'FAILED', NOW(), $5)
      ON CONFLICT (remote_path, filename)
      DO UPDATE SET
        sync_status = 'FAILED',
        last_synced_at = NOW(),
        last_error = EXCLUDED.last_error;
    `;
    await query(sql, [remotePath, filename, fileSize, remoteModifiedAt, errorMsg]);
  }

  /**
   * Tandai file yang telah dihapus di FTP remote
   */
  async markDeletedFiles(remotePath, deletedFilenames) {
    if (!deletedFilenames || deletedFilenames.length === 0) return;
    await query(
      `UPDATE ftp_sync_files 
       SET sync_status = 'DELETED', last_synced_at = NOW() 
       WHERE remote_path = $1 AND filename = ANY($2::text[])`,
      [remotePath, deletedFilenames]
    );
  }

  /**
   * Buat koneksi client FTP
   */
  async createFtpClient() {
    const timeout = Number(process.env.FTP_TIMEOUT || 30000);
    const client = new ftp.Client(timeout);

    await client.access({
      host: process.env.FTP_HOST,
      port: Number(process.env.FTP_PORT || 21),
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false,
    });

    return client;
  }

  /**
   * Menentukan daftar direktori yang akan disinkronkan:
   * - Mendukung 1 folder: '/ucl11112'
   * - Mendukung banyak folder (koma): '/ucl11112, /ucl11113, /ul00506'
   * - Mendukung auto-discovery semua folder di root: 'ALL' atau '*'
   */
  async resolveTargetDirectories(client, rawConfig) {
    const configStr = String(rawConfig || process.env.FTP_REMOTE_DIR || '/ucl11112').trim();

    if (configStr.toUpperCase() === 'ALL' || configStr === '*') {
      console.log('[FTP Sync] Mode AUTO-DISCOVERY aktif: Memindai semua folder di root FTP...');
      const rootEntries = await client.list('/');
      const dirs = rootEntries
        .filter((e) => e.type === 2 && !e.name.startsWith('.'))
        .map((e) => (e.name.startsWith('/') ? e.name : `/${e.name}`));
      console.log(`[FTP Sync] Ditemukan ${dirs.length} folder di server FTP:`, dirs.join(', '));
      return dirs;
    }

    if (configStr.includes(',')) {
      return configStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith('/') ? s : `/${s}`));
    }

    return [configStr.startsWith('/') ? configStr : `/${configStr}`];
  }

  /**
   * Sinkronisasi untuk satu direktori tertentu
   */
  async syncSingleDirectory(client, remoteDir, options = {}) {
    const onProgress = options.onProgress || null;
    const batchLimit = options.batchLimit || null;

    const dirSummary = {
      remoteDir,
      totalRemote: 0,
      newFiles: 0,
      modifiedFiles: 0,
      deletedFiles: 0,
      unchangedFiles: 0,
      syncedFiles: 0,
      errorFiles: 0,
      totalInsertedMeasurements: 0,
    };

    // 1. Ambil daftar file dari folder remote
    const entries = await client.list(remoteDir);
    const remoteFiles = entries.filter((e) => e.type === 1 && e.name !== '.' && e.name !== '..');
    dirSummary.totalRemote = remoteFiles.length;

    // 2. Ambil riwayat sync lokal dari PostgreSQL
    const syncMap = await this.getSyncMap(remoteDir);

    // 3. Klasifikasi file
    const filesToDownload = [];
    const currentRemoteNames = new Set();

    for (const file of remoteFiles) {
      currentRemoteNames.add(file.name);
      const record = syncMap.get(file.name);
      const remoteModTime = file.modifiedAt ? new Date(file.modifiedAt).getTime() : 0;

      if (!record) {
        filesToDownload.push({ file, reason: 'NEW' });
        dirSummary.newFiles++;
      } else if (record.sync_status === 'DELETED') {
        filesToDownload.push({ file, reason: 'RE_UPLOADED' });
        dirSummary.newFiles++;
      } else {
        const sizeChanged = file.size !== record.file_size;
        const timeChanged = Math.abs(remoteModTime - record.remote_modified_at.getTime()) > 2000;

        if (sizeChanged || timeChanged || record.sync_status === 'FAILED') {
          filesToDownload.push({ file, reason: 'MODIFIED' });
          dirSummary.modifiedFiles++;
        } else {
          dirSummary.unchangedFiles++;
        }
      }
    }

    // 4. Deteksi File yang Dihapus di folder ini
    const deletedFilenames = [];
    for (const [dbFilename, record] of syncMap.entries()) {
      if (!currentRemoteNames.has(dbFilename) && record.sync_status !== 'DELETED') {
        deletedFilenames.push(dbFilename);
      }
    }

    if (deletedFilenames.length > 0) {
      await this.markDeletedFiles(remoteDir, deletedFilenames);
      dirSummary.deletedFiles = deletedFilenames.length;
      console.log(`[FTP Sync] ${deletedFilenames.length} file di ${remoteDir} ditandai DELETED di database.`);
    }

    const queue = batchLimit ? filesToDownload.slice(0, batchLimit) : filesToDownload;
    if (queue.length === 0) {
      return dirSummary;
    }

    console.log(
      `[FTP Sync] [${remoteDir}] Memproses ${queue.length} file (${dirSummary.newFiles} baru, ${dirSummary.modifiedFiles} berubah)...`
    );

    // 5. Unduh & Ingest
    for (let i = 0; i < queue.length; i++) {
      const { file, reason } = queue[i];
      const filename = file.name;
      const tempPath = path.join(this.incomingDir, `.tmp_${Date.now()}_${filename}`);
      const finalPath = path.join(this.incomingDir, filename);
      const remoteFilePath = `${remoteDir}/${filename}`;

      try {
        await client.downloadTo(tempPath, remoteFilePath);

        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }
        fs.renameSync(tempPath, finalPath);

        let ingestResult = null;
        const isZrx = filename.toLowerCase().endsWith('.zrx');

        if (isZrx) {
          ingestResult = await ingestionService.processFile(finalPath);
          if (ingestResult.success) {
            await this.recordSyncSuccess(remoteDir, filename, file.size, file.modifiedAt, 'INGESTED');
            dirSummary.syncedFiles++;
            dirSummary.totalInsertedMeasurements += ingestResult.inserted || 0;
          } else {
            await this.recordSyncError(remoteDir, filename, file.size, file.modifiedAt, ingestResult.error || 'Ingestion failed');
            dirSummary.errorFiles++;
          }
        } else {
          const archivedTarget = path.join(this.processedDir, filename);
          if (fs.existsSync(archivedTarget)) {
            fs.unlinkSync(archivedTarget);
          }
          fs.renameSync(finalPath, archivedTarget);
          await this.recordSyncSuccess(remoteDir, filename, file.size, file.modifiedAt, 'SYNCED');
          dirSummary.syncedFiles++;
        }

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: queue.length,
            directory: remoteDir,
            filename,
            reason,
            success: ingestResult ? ingestResult.success : true,
            inserted: ingestResult ? ingestResult.inserted : 0,
            duplicates: ingestResult ? ingestResult.duplicates : 0,
          });
        }
      } catch (fileErr) {
        dirSummary.errorFiles++;
        console.error(`[FTP Sync Error] Gagal memproses ${remoteFilePath}:`, fileErr.message);

        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }

        await this.recordSyncError(remoteDir, filename, file.size, file.modifiedAt, fileErr.message);

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: queue.length,
            directory: remoteDir,
            filename,
            reason,
            success: false,
            error: fileErr.message,
          });
        }
      }
    }

    return dirSummary;
  }

  /**
   * Sinkronisasi utama FTP (Mendukung Multi-Directory & Auto-Discovery)
   */
  async sync(options = {}) {
    if (this.isSyncing) {
      console.log('[FTP Sync] Siklus sinkronisasi sebelumnya masih berjalan, lewati...');
      return { skipped: true };
    }

    this.isSyncing = true;
    this.ensureDirectories();

    let client = null;
    const totalSummary = {
      directories: [],
      totalRemote: 0,
      newFiles: 0,
      modifiedFiles: 0,
      deletedFiles: 0,
      unchangedFiles: 0,
      syncedFiles: 0,
      errorFiles: 0,
      totalInsertedMeasurements: 0,
    };

    try {
      client = await this.createFtpClient();

      // Dapatkan seluruh direktori target (bisa 1 folder, banyak folder pisah koma, atau ALL)
      const targetDirectories = await this.resolveTargetDirectories(client, options.remoteDir);
      totalSummary.directories = targetDirectories;

      for (const dir of targetDirectories) {
        try {
          const dirRes = await this.syncSingleDirectory(client, dir, options);
          totalSummary.totalRemote += dirRes.totalRemote;
          totalSummary.newFiles += dirRes.newFiles;
          totalSummary.modifiedFiles += dirRes.modifiedFiles;
          totalSummary.deletedFiles += dirRes.deletedFiles;
          totalSummary.unchangedFiles += dirRes.unchangedFiles;
          totalSummary.syncedFiles += dirRes.syncedFiles;
          totalSummary.errorFiles += dirRes.errorFiles;
          totalSummary.totalInsertedMeasurements += dirRes.totalInsertedMeasurements;
        } catch (dirErr) {
          console.error(`[FTP Sync Error] Gagal memproses direktori ${dir}:`, dirErr.message);
        }
      }

      return totalSummary;
    } catch (err) {
      console.error('[FTP Sync Fatal Error]', err.message);
      throw err;
    } finally {
      if (client) {
        client.close();
      }
      this.isSyncing = false;
    }
  }
}

module.exports = new FtpSyncService();
