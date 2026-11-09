const ftp = require("basic-ftp");
require("dotenv").config();

const timeout = Number(process.env.FTP_TIMEOUT || 30000);
const client = new ftp.Client(timeout);

async function testFTP() {
  try {
    // Ambil konfigurasi dari .env
    const host = process.env.FTP_HOST;
    const port = Number(process.env.FTP_PORT || 21);
    const user = process.env.FTP_USER;
    const password = process.env.FTP_PASSWORD;
    const remoteDir = process.env.FTP_REMOTE_DIR || "/ucl11112";
    const secure = String(process.env.FTP_SECURE || "false").toLowerCase();

    // Validasi konfigurasi
    if (!host || !user || !password) {
      throw new Error("FTP_HOST, FTP_USER, dan FTP_PASSWORD wajib diisi.");
    }

    
    if (secure === "true") {
      throw new Error(
        "Server tidak mendukung FTP over TLS. Gunakan FTP_SECURE=false.",
      );
    }

    console.log("================================");
    console.log("       FTP CONNECTION TEST      ");
    console.log("================================");
    console.log(`Host       : ${host}`);
    console.log(`Port       : ${port}`);
    console.log(`Directory  : ${remoteDir}`);
    console.log(`Timeout    : ${timeout} ms`);
    console.log("--------------------------------");

    // Koneksi ke FTP server
    console.log("[1] Connecting to FTP server...");

    await client.access({
      host,
      port,
      user,
      password,
      secure: false,
    });

    console.log("[SUCCESS] FTP login berhasil!");

    // Membaca direktori remote
    console.log(`\n[2] Reading directory: ${remoteDir}`);

    const entries = await client.list(remoteDir);

    // Abaikan entri direktori saat ini dan parent
    const files = entries.filter(
      (entry) => entry.name !== "." && entry.name !== "..",
    );

    const directories = files.filter((entry) => entry.type === 2);

    const regularFiles = files.filter((entry) => entry.type === 1);

    const extensionSummary = {};

    for (const file of files) {
      const ext =
        require("path").extname(file.name).toLowerCase() || "(tanpa ekstensi)";

      extensionSummary[ext] = (extensionSummary[ext] || 0) + 1;
    }

    console.log("\n[4] File extension summa        ry:");
    console.table(
      Object.entries(extensionSummary).map(([extension, count]) => ({
        extension,
        count,
      })),
    );

    console.log("[SUCCESS] Directory listing berhasil!");
    console.log("--------------------------------");
    console.log(`Total Entries : ${files.length}`);
    console.log(`Total Files   : ${regularFiles.length}`);
    console.log(`Directories   : ${directories.length}`);
    console.log("--------------------------------");

    // Tampilkan maksimal 20 file
    console.log("\n[3] Sample files:");

    console.table(
      files.slice(0, 20).map((entry) => ({
        name: entry.name,
        type: entry.type === 2 ? "DIRECTORY" : "FILE",
        size: entry.size,
        modified: entry.modifiedAt ? entry.modifiedAt.toISOString() : "-",
      })),
    );

    console.log("\n[RESULT] FTP TEST COMPLETED!");
  } catch (error) {
    console.error("\n[FTP ERROR]", error.message);
    process.exitCode = 1;
  } finally {
    // Selalu tutup koneksi
    client.close();
    console.log("\n[INFO] FTP connection closed.");
  }
}

testFTP();
