const { pool } = require('../config/db');
const fs = require('fs');
const path = require('path');

async function resetAllData() {
  console.log('='.repeat(60));
  console.log('   RESET ALL DATA: SIAPKAN SISTEM UNTUK DEMO / RECORD');
  console.log('='.repeat(60));

  try {
    // 1. Kosongkan data pengukuran & reset ID mulai dari 1
    await pool.query('TRUNCATE TABLE arr_ftp RESTART IDENTITY;');
    console.log('[1/3] Tabel "arr_ftp" berhasil dikosongkan (0 baris).');

    // 2. Kosongkan tabel pelacak sync FTP & reset ID mulai dari 1
    await pool.query('TRUNCATE TABLE ftp_sync_files RESTART IDENTITY;');
    console.log('[2/3] Tabel "ftp_sync_files" berhasil dikosongkan (0 file tercatat).');

    // 3. Bersihkan file lokal di storage (kecuali file .gitkeep)
    const dirs = [
      path.resolve(__dirname, '../../storage/ftp_simulator/incoming'),
      path.resolve(__dirname, '../../storage/ftp_simulator/processed'),
      path.resolve(__dirname, '../../storage/ftp_simulator/failed'),
    ];

    let deletedFilesCount = 0;
    dirs.forEach((dir) => {
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach((file) => {
          if (file !== '.gitkeep') {
            try {
              fs.unlinkSync(path.join(dir, file));
              deletedFilesCount++;
            } catch (_) {}
          }
        });
      }
    });

    console.log(`[3/3] Storage lokal dibersihkan (${deletedFilesCount} file lama dihapus).`);

    console.log('\n' + '='.repeat(60));
    console.log('STATUS: BERHASIL! Database & storage bersih, siap untuk demo.');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('[ERROR saat reset data]:', err.message);
  } finally {
    await pool.end();
  }
}

resetAllData();

