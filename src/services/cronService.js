const cron = require('node-cron');
const ingestionService = require('./ingestionService');
const ftpSyncService = require('./ftpSyncService');

class CronService {
  constructor() {
    this.task = null;
    this.isProcessing = false;
  }

  /**
   * Menjalankan cron job untuk memantau sinkronisasi FTP dan folder masuk secara berkala
   * @param {string} [schedule] - Format cron (default: per 10 detik atau CRON_SCHEDULE dari .env)
   */
  start(schedule = process.env.CRON_SCHEDULE || '0 */2 * * * *') {
    if (this.task) {
      console.log('[Cron] Scheduler sudah berjalan.');
      return;
    }

    const ftpEnabled = String(process.env.FTP_ENABLED || 'false').toLowerCase() === 'true';
    console.log(`[Cron] Memulai watcher scheduler dengan pola: "${schedule}"`);
    console.log(`[Cron] Status Auto-FTP Sync: ${ftpEnabled ? 'AKTIF (ON)' : 'NON-AKTIF (OFF - Set FTP_ENABLED=true di .env)'}`);

    this.task = cron.schedule(schedule, async () => {
      // Mencegah job berjalan tumpang tindih jika proses sebelumnya belum selesai
      if (this.isProcessing) {
        console.log('[Cron] Siklus sebelumnya masih berjalan, iterasi ini dilewati...');
        return;
      }

      this.isProcessing = true;
      try {
        // 1. Sinkronisasi otomatis dari FTP Server jika FTP_ENABLED=true 
        if (String(process.env.FTP_ENABLED || 'false').toLowerCase() === 'true') {
          const syncRes = await ftpSyncService.sync();
          if (syncRes && !syncRes.skipped && (syncRes.newFiles > 0 || syncRes.modifiedFiles > 0 || syncRes.deletedFiles > 0)) {
            console.log(
              `[Cron FTP] Sync berhasil: +${syncRes.syncedFiles} file diproses, +${syncRes.totalInsertedMeasurements} baris masuk DB.`
            );
          }
        }

        // 2. Fallback / Handler untuk simulasi lokal & file manual di folder incoming
        await ingestionService.processIncomingDirectory();
      } catch (err) {
        console.error('[Cron Error] Terjadi kesalahan pada siklus watcher:', err.message);
      } finally {
        this.isProcessing = false;
      }
    });
  }

  /**
   * Menghentikan cron job
   */
  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('[Cron] Scheduler dihentikan.');
    }
  }
}

module.exports = new CronService();
