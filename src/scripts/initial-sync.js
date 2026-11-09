const ftpSyncService = require('../services/ftpSyncService');
const { pool } = require('../config/db');

async function runInitialSync() {
  console.log('='.repeat(65));
  console.log('   INITIAL FTP SYNC: UNDUH & INGEST SEMUA FILE REMOTE');
  console.log('='.repeat(65));

  // Opsi limit jika ada argumen --limit=N
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const batchLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  if (batchLimit) {
    console.log(`[Mode Test] Membatasi sinkronisasi maksimal ${batchLimit} file.`);
  }

  const startTime = Date.now();
  let totalRowsInserted = 0;
  let totalDuplicatesIgnored = 0;

  try {
    const summary = await ftpSyncService.sync({
      batchLimit,
      onProgress: ({ current, total, filename, reason, success, inserted, duplicates, error }) => {
        const percent = ((current / total) * 100).toFixed(1);
        if (success) {
          totalRowsInserted += inserted || 0;
          totalDuplicatesIgnored += duplicates || 0;
          console.log(
            `[${String(current).padStart(4, ' ')}/${total}] (${percent.padStart(5, ' ')}%) [${reason}] ${filename} -> Ingested: +${inserted} baru, ${duplicates} duplikat`
          );
        } else {
          console.error(
            `[${String(current).padStart(4, ' ')}/${total}] (${percent.padStart(5, ' ')}%) [ERROR] ${filename} -> Gagal: ${error}`
          );
        }
      },
    });

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(65));
    console.log('   RINGKASAN HASIL SINKRONISASI FTP');
    console.log('='.repeat(65));
    console.log(`Direktori Target     : ${summary.directories ? summary.directories.join(', ') : summary.remoteDir}`);
    console.log(`Total File di FTP     : ${summary.totalRemote}`);
    console.log(`File Baru             : ${summary.newFiles}`);
    console.log(`File Berubah          : ${summary.modifiedFiles}`);
    console.log(`File Dihapus di FTP   : ${summary.deletedFiles}`);
    console.log(`File Tidak Berubah    : ${summary.unchangedFiles}`);
    console.log(`Berhasil Disinkronkan : ${summary.syncedFiles}`);
    console.log(`Gagal Disinkronkan    : ${summary.errorFiles}`);
    console.log(`Total Data Baru (DB)  : ${totalRowsInserted} baris`);
    console.log(`Duplikat Diabaikan    : ${totalDuplicatesIgnored} baris`);
    console.log(`Waktu Eksekusi        : ${durationSec} detik`);
    console.log('='.repeat(65));

    // Periksa total record di tabel arr_ftp sekarang
    const dbRes = await pool.query('SELECT COUNT(*) as total FROM arr_ftp;');
    const syncRes = await pool.query('SELECT COUNT(*) as total FROM ftp_sync_files WHERE sync_status = \'INGESTED\';');
    console.log(`\nStatus Database Sekarang:`);
    console.log(` -> Total Pengukuran (arr_ftp)   : ${dbRes.rows[0].total} baris`);
    console.log(` -> Total File Teringest (Sync)  : ${syncRes.rows[0].total} file`);
    console.log('='.repeat(65));

  } catch (err) {
    console.error('\n[FATAL ERROR saat initial sync]:', err.message);
  } finally {
    await pool.end();
  }
}

runInitialSync();

