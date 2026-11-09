const fs = require('fs');
const path = require('path');
const { parseZrxFile } = require('../utils/parser');
const { saveMeasurements } = require('../services/measurementService');
const { pool, query } = require('../config/db');

async function reingestAllProcessed() {
  console.log('='.repeat(65));
  console.log('   RESTORE / RE-INGEST DATA DARI FILE LOKAL KE arr_ftp');
  console.log('='.repeat(65));

  const processedDir = path.resolve(__dirname, '../../storage/ftp_simulator/processed');
  const files = fs.readdirSync(processedDir).filter((f) => f.toLowerCase().endsWith('.zrx'));

  console.log(`Ditemukan ${files.length} file .zrx di folder:`);
  console.log(processedDir);
  console.log('-'.repeat(65));

  const startTime = Date.now();
  let totalInserted = 0;
  let totalDuplicates = 0;
  let successFiles = 0;
  let failedFiles = 0;

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const fullPath = path.join(processedDir, filename);

    try {
      const parsed = parseZrxFile(fullPath);
      if (parsed.data.length > 0) {
        const res = await saveMeasurements(parsed.data);
        totalInserted += res.inserted;
        totalDuplicates += res.duplicates;
      }
      successFiles++;

      // Update status di ftp_sync_files
      await query(
        `UPDATE ftp_sync_files 
         SET sync_status = 'INGESTED', last_error = NULL, last_synced_at = NOW() 
         WHERE filename = $1`,
        [filename]
      );

      if ((i + 1) % 100 === 0 || i === files.length - 1) {
        const percent = (((i + 1) / files.length) * 100).toFixed(1);
        console.log(
          `[Progress] ${String(i + 1).padStart(4, ' ')}/${files.length} (${percent.padStart(5, ' ')}%) file diproses... (+${totalInserted} baris data)`
        );
      }
    } catch (err) {
      failedFiles++;
      console.error(`[Error] Gagal re-ingest ${filename}:`, err.message);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const dbRes = await pool.query('SELECT count(*) as total FROM arr_ftp');

  console.log('\n' + '='.repeat(65));
  console.log('   RE-INGEST LOKAL SELESAI');
  console.log('='.repeat(65));
  console.log(`Total File Diproses   : ${successFiles}`);
  console.log(`Gagal                 : ${failedFiles}`);
  console.log(`Baris Baru Masuk      : ${totalInserted}`);
  console.log(`Duplikat Diabaikan    : ${totalDuplicates}`);
  console.log(`Total di arr_ftp      : ${dbRes.rows[0].total} baris`);
  console.log(`Waktu Restore         : ${durationSec} detik`);
  console.log('='.repeat(65));

  await pool.end();
}

reingestAllProcessed();

