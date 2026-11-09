const { pool } = require('../config/db');

async function runSyncMigration() {
  console.log('='.repeat(60));
  console.log('   MIGRATION: BUAT TABEL PELACAK SINKRONISASI FTP');
  console.log('='.repeat(60));

  let client;
  try {
    client = await pool.connect();

    console.log('[1/2] Membuat tabel "ftp_sync_files"...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ftp_sync_files (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        remote_path VARCHAR(255) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        file_size BIGINT NOT NULL,
        remote_modified_at TIMESTAMP NOT NULL,
        sync_status VARCHAR(50) DEFAULT 'SYNCED',
        last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_error TEXT NULL,
        CONSTRAINT uq_ftp_sync_remote_file UNIQUE (remote_path, filename)
      );
    `);
    console.log('  -> Tabel "ftp_sync_files" siap.');

    console.log('\n[2/2] Membuat index pendukung...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ftp_sync_filename ON ftp_sync_files(filename);
      CREATE INDEX IF NOT EXISTS idx_ftp_sync_status ON ftp_sync_files(sync_status);
      CREATE INDEX IF NOT EXISTS idx_ftp_sync_remote_mod ON ftp_sync_files(remote_modified_at);
    `);
    console.log('  -> Index pendukung berhasil dibuat.');

    console.log('\n' + '='.repeat(60));
    console.log('BERHASIL: Migrasi tabel sinkronisasi FTP selesai!');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('\nERROR saat migrasi tabel sinkronisasi:', err.message);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

runSyncMigration();

