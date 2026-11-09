const { pool } = require('../config/db');

/**
 * Menyimpan array data pengukuran ke tabel arr_ftp menggunakan batch insert dan transaction.
 * Menggunakan ON CONFLICT (id_logger, channel, recorded_at) DO NOTHING untuk duplicate handling.
 * 
 * @param {Array<Object>} records - Array record hasil parsing [{ id_logger, channel, recorded_at, value, unit }]
 * @param {number} [batchSize=500] - Ukuran batch insert per query
 * @returns {Promise<Object>} { total, inserted, duplicates, insertedRecords }
 */
async function saveMeasurements(records, batchSize = 500) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      total: 0,
      inserted: 0,
      duplicates: 0,
      insertedRecords: [],
    };
  }

  const client = await pool.connect();
  const insertedRecords = [];

  try {
    // Mulai transaksi database
    await client.query('BEGIN');

    // Pecah data menjadi beberapa batch untuk efisiensi memori & parameter limit PostgreSQL
    for (let i = 0; i < records.length; i += batchSize) {
      const chunk = records.slice(i, i + batchSize);

      const valuePlaceholders = [];
      const queryParams = [];
      let paramCounter = 1;

      chunk.forEach((item) => {
        valuePlaceholders.push(
          `($${paramCounter}, $${paramCounter + 1}, $${paramCounter + 2}, $${paramCounter + 3}, $${paramCounter + 4})`
        );
        queryParams.push(
          item.id_logger,
          item.channel,
          item.recorded_at,
          item.value,
          item.unit || null
        );
        paramCounter += 5;
      });

      const sql = `
        INSERT INTO arr_ftp (id_logger, channel, recorded_at, value, unit)
        VALUES ${valuePlaceholders.join(', ')}
        ON CONFLICT (id_logger, channel, recorded_at) DO NOTHING
        RETURNING id, id_logger, channel, recorded_at, value, unit;
      `;

      const result = await client.query(sql, queryParams);
      if (result.rows && result.rows.length > 0) {
        insertedRecords.push(...result.rows);
      }
    }

    // Commit transaksi jika seluruh batch berhasil
    await client.query('COMMIT');

    const total = records.length;
    const inserted = insertedRecords.length;
    const duplicates = total - inserted;

    return {
      total,
      inserted,
      duplicates,
      insertedRecords,
    };
  } catch (error) {
    // Rollback transaksi jika terjadi kesalahan
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Mengambil ringkasan statistik data dari tabel arr_ftp dan ftp_sync_files
 * @returns {Promise<Object>}
 */
async function getMeasurementStats() {
  const res = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM arr_ftp) AS total_rows,
      (SELECT COUNT(*) FROM ftp_sync_files WHERE sync_status IN ('INGESTED', 'SYNCED')) AS total_files,
      (SELECT COUNT(DISTINCT id_logger) FROM arr_ftp) AS total_loggers,
      (SELECT COUNT(DISTINCT channel) FROM arr_ftp) AS total_channels,
      (SELECT MIN(recorded_at) FROM arr_ftp) AS earliest_record,
      (SELECT MAX(recorded_at) FROM arr_ftp) AS latest_record;
  `);
  return res.rows[0];
}

module.exports = {
  saveMeasurements,
  getMeasurementStats,
};

