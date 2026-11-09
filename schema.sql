-- =============================================================================
-- DATABASE SCHEMA & USEFUL QUERIES: FTP MIGRATION & REALTIME LOGGER
-- Engine: PostgreSQL 14+ / 18
-- Database Name: ftp_migration
-- =============================================================================

-- =============================================================================
-- 1. TABEL UTAMA (TABLE DEFINITIONS)
-- =============================================================================

-- 1.1 Tabel Penyimpanan Data Pengukuran Logger (.zrx timeseries)
CREATE TABLE IF NOT EXISTS arr_ftp (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_logger VARCHAR(50) NOT NULL,
    recorded_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    channel VARCHAR(20) NOT NULL,
    value NUMERIC(12, 4),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    unit VARCHAR(20),
    -- Constraint Unik untuk pencegahan duplikasi data (Idempotency)
    CONSTRAINT uq_arr_ftp_logger_channel_recorded UNIQUE (id_logger, channel, recorded_at)
);

-- Index pendukung untuk query filtering & sorting cepat
CREATE INDEX IF NOT EXISTS idx_arr_ftp_logger ON arr_ftp(id_logger);
CREATE INDEX IF NOT EXISTS idx_arr_ftp_channel ON arr_ftp(channel);
CREATE INDEX IF NOT EXISTS idx_arr_ftp_recorded ON arr_ftp(recorded_at DESC);


-- 1.2 Tabel Pelacak Sinkronisasi File Remote FTP (State Management)
CREATE TABLE IF NOT EXISTS ftp_sync_files (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    remote_path VARCHAR(255) NOT NULL,          -- misal: '/ucl11112'
    filename VARCHAR(255) NOT NULL,             -- nama file fisik
    file_size BIGINT NOT NULL,                  -- ukuran file dalam bytes
    remote_modified_at TIMESTAMP NOT NULL,      -- tanggal modifikasi di server FTP
    sync_status VARCHAR(50) DEFAULT 'SYNCED',   -- 'SYNCED', 'INGESTED', 'DELETED', 'FAILED'
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_error TEXT NULL,
    -- Constraint unik per path dan file
    CONSTRAINT uq_ftp_sync_remote_file UNIQUE (remote_path, filename)
);

-- Index pendukung tabel sinkronisasi
CREATE INDEX IF NOT EXISTS idx_ftp_sync_filename ON ftp_sync_files(filename);
CREATE INDEX IF NOT EXISTS idx_ftp_sync_status ON ftp_sync_files(sync_status);
CREATE INDEX IF NOT EXISTS idx_ftp_sync_remote_mod ON ftp_sync_files(remote_modified_at);


-- =============================================================================
-- 2. QUERY MONITORING & PENGECEKAN DATA (MONITORING QUERIES)
-- =============================================================================

-- Melihat 50 data pengukuran terbaru
SELECT * 
FROM arr_ftp 
ORDER BY recorded_at DESC 
LIMIT 50;

-- Menghitung total seluruh baris data pengukuran
SELECT COUNT(*) AS total_pengukuran FROM arr_ftp;

-- Menghitung total file yang berhasil ditarik dari FTP
SELECT COUNT(*) AS total_file_disinkronkan 
FROM ftp_sync_files 
WHERE sync_status = 'INGESTED';

-- Ringkasan status file di tabel pelacak (INGESTED, DELETED, FAILED)
SELECT sync_status, COUNT(*) AS jumlah_file
FROM ftp_sync_files
GROUP BY sync_status;

-- Menghitung total data per stasiun logger & channel
SELECT 
    id_logger, 
    channel, 
    unit,
    COUNT(*) AS total_record,
    MIN(recorded_at) AS data_pertama,
    MAX(recorded_at) AS data_terakhir,
    MIN(value) AS nilai_min,
    MAX(value) AS nilai_max,
    ROUND(AVG(value), 4) AS nilai_rata_rata
FROM arr_ftp
GROUP BY id_logger, channel, unit
ORDER BY id_logger, channel;


-- =============================================================================
-- 3. QUERY MAINTENANCE & TESTING (RESET DATA)
-- =============================================================================

-- Kosongkan seluruh data pengukuran (ID kembali mulai dari 1)
TRUNCATE TABLE arr_ftp RESTART IDENTITY;

-- Kosongkan riwayat sinkronisasi FTP (ID kembali mulai dari 1)
TRUNCATE TABLE ftp_sync_files RESTART IDENTITY;

-- Kosongkan kedua tabel sekaligus untuk pengujian ulang dari 0
-- TRUNCATE TABLE arr_ftp, ftp_sync_files RESTART IDENTITY;

