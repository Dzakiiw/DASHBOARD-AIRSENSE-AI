// Program Final Server.js - versi dengan komentar penjelasan

const express = require("express")
const cors = require("cors")

const app = express()
const PORT = 3001

// ================= MIDDLEWARE =================
// cors() digunakan agar backend dapat diakses oleh frontend/dashboard
// walaupun frontend dan backend berjalan pada domain atau port yang berbeda.
// express.json() digunakan agar server bisa membaca body request dalam format JSON
// yang dikirimkan oleh ESP32-S3.
app.use(cors())
app.use(express.json())

// ================= DATABASE SEMENTARA =================
// latestData berfungsi sebagai penyimpanan sementara data terakhir dari ESP32-S3.
// Data ini tidak masuk ke database permanen, tetapi hanya disimpan di memori server.
// Dashboard mengambil data terbaru dari variabel ini melalui endpoint /data, /sensor,
// atau /sensor/latest.
let latestData = {
  suhu: 0,
  kelembapan: 0,
  tekanan: 0,
  co: 0,
  pm25: 0,
  pm10: 0,

  // aktualPolusi adalah nilai ISPU aktual dari sensor.
  // Jika ESP32 mengirim aktualPolusi, nilai dari ESP32 digunakan.
  // Jika tidak, server menghitung sendiri dari PM2.5, PM10, dan CO.
  aktualPolusi: 0,

  // prediksi adalah hasil prediksi AI/TinyML dari ESP32-S3.
  prediksi: 0,

  // Data performa sistem.
  inferenceTimeMs: 0, // waktu proses model AI/TinyML di ESP32
  readTimeMs: 0,      // waktu pembacaan sensor
  sendTimeMs: 0,      // waktu pengiriman data
  latencyLocalMs: 0,  // total latensi lokal pengiriman data
  uptimeMs: 0,        // lama ESP32 menyala

  model: "Model_ISPU_A_LOOKBACK_30",

  // Status buffer AI dari ESP32
  bufferCount: 0,
  bufferReady: false,

  source: "Belum ada data",
  waktu: "-",
  timestamp: null
}

// ================= COMMAND RESET BUFFER =================
// Variabel ini menjadi penanda ketika dashboard meminta reset buffer AI.
// ESP32 akan mengecek endpoint /buffer/command untuk mengetahui apakah reset diperlukan.
let bufferResetRequest = false
let bufferResetRequestedAt = null

// ================= HELPER =================
// Fungsi untuk mengubah nilai menjadi angka.
// Jika nilai tidak valid, NaN, null, atau undefined, maka akan dikembalikan
// ke defaultValue. Tujuannya agar data dari ESP32 tetap aman diproses.
function toNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

// Fungsi untuk mengubah data menjadi boolean.
// ESP32/backend bisa saja mengirim true/false dalam bentuk boolean, string,
// atau angka 1/0. Fungsi ini menyamakan format tersebut menjadi boolean JS.
function toBoolean(value) {
  if (typeof value === "boolean") return value

  if (typeof value === "string") {
    return value.toLowerCase() === "true"
  }

  if (typeof value === "number") {
    return value === 1
  }

  return false
}

// ================= HITUNG ISPU FALLBACK =================
// Fungsi ini hanya dipakai kalau ESP32 tidak mengirim aktualPolusi

// Fungsi ini menghitung nilai sub-ISPU menggunakan interpolasi linear.
// Parameter:
// x  = nilai konsentrasi polutan dari sensor
// xb = batas bawah konsentrasi polutan
// xa = batas atas konsentrasi polutan
// ib = batas bawah indeks ISPU
// ia = batas atas indeks ISPU
//
// Rumus:
// ISPU = ((Ia - Ib) / (Xa - Xb)) * (X - Xb) + Ib
//
// Hasil dibatasi pada rentang 0 sampai 500 agar tetap sesuai skala ISPU.
function hitungSubISPU(x, xb, xa, ib, ia) {
  if (xa === xb) return ia

  const hasil = ((ia - ib) / (xa - xb)) * (x - xb) + ib

  return Math.min(500, Math.max(0, hasil))
}

// Fungsi ini menghitung sub-ISPU khusus parameter PM2.5.
// Nilai PM2.5 dibandingkan dengan breakpoint tertentu, lalu dikonversi
// menjadi nilai indeks ISPU menggunakan fungsi hitungSubISPU().
function hitungISPU_PM25(pm25) {
  const value = Number(pm25) || 0

  if (value <= 0) return 0
  if (value <= 15.5) return hitungSubISPU(value, 0, 15.5, 0, 50)
  if (value <= 55.4) return hitungSubISPU(value, 15.5, 55.4, 50, 100)
  if (value <= 150.4) return hitungSubISPU(value, 55.4, 150.4, 100, 200)
  if (value <= 250.4) return hitungSubISPU(value, 150.4, 250.4, 200, 300)

  return hitungSubISPU(value, 250.4, 500, 300, 500)
}

// Fungsi ini menghitung sub-ISPU khusus parameter PM10.
// Logikanya sama seperti PM2.5, tetapi breakpoint konsentrasinya berbeda.
function hitungISPU_PM10(pm10) {
  const value = Number(pm10) || 0

  if (value <= 0) return 0
  if (value <= 50) return hitungSubISPU(value, 0, 50, 0, 50)
  if (value <= 150) return hitungSubISPU(value, 50, 150, 50, 100)
  if (value <= 350) return hitungSubISPU(value, 150, 350, 100, 200)
  if (value <= 420) return hitungSubISPU(value, 350, 420, 200, 300)

  return hitungSubISPU(value, 420, 500, 300, 500)
}

// Fungsi ini menghitung sub-ISPU untuk gas CO.
// Sensor membaca CO dalam satuan ppm, lalu kode ini mengubahnya menjadi
// pendekatan µg/m3 dengan rumus: CO µg/m3 = CO ppm × 1145.0.
function hitungISPU_CO(coPPM) {
  const value = Number(coPPM) || 0

  if (value <= 0) return 0

  // Konversi pendekatan CO dari ppm ke µg/m3
  const coUgM3 = value * 1145.0

  if (coUgM3 <= 4000) return hitungSubISPU(coUgM3, 0, 4000, 0, 50)
  if (coUgM3 <= 8000) return hitungSubISPU(coUgM3, 4000, 8000, 50, 100)
  if (coUgM3 <= 15000) return hitungSubISPU(coUgM3, 8000, 15000, 100, 200)
  if (coUgM3 <= 30000) return hitungSubISPU(coUgM3, 15000, 30000, 200, 300)

  return hitungSubISPU(coUgM3, 30000, 45000, 300, 500)
}

// Fungsi ini menghitung nilai aktual polusi akhir dari PM2.5, PM10, dan CO.
// Setiap parameter dihitung sub-ISPU-nya, lalu nilai paling tinggi dipilih.
// Prinsipnya: parameter polutan terburuk menjadi nilai ISPU utama.
// Contoh: PM2.5 = 80, PM10 = 120, CO = 60, maka aktualPolusi = 120.
function hitungAktualPolusi(pm25, pm10, co) {
  const ispuPM25 = hitungISPU_PM25(pm25)
  const ispuPM10 = hitungISPU_PM10(pm10)
  const ispuCO = hitungISPU_CO(co)

  const hasil = Math.max(ispuPM25, ispuPM10, ispuCO)

  return Math.round(Math.min(500, Math.max(1, hasil)))
}

// ================= TEST ROUTE =================
// Route sederhana untuk mengecek apakah server backend sudah berjalan.
app.get("/", (req, res) => {
  res.send("Backend ESP32-S3 AirSense berjalan 🚀")
})

// ================= TERIMA DATA DARI ESP32 =================
// Endpoint utama untuk menerima data dari ESP32-S3.
// ESP32 mengirim data sensor melalui POST /sensor.
// Data kemudian dikonversi, dihitung jika perlu, dan disimpan ke latestData.
app.post("/sensor", (req, res) => {
  console.log("\n================================")
  console.log("DATA MASUK DARI ESP32-S3")
  console.log(req.body)
  console.log("================================")

  // Mengambil body request. Jika request kosong, digunakan object kosong
  // agar kode tidak error ketika membaca field sensor.
  const body = req.body || {}

  // Membaca data sensor dari ESP32.
  // Operator ?? digunakan agar server bisa menerima beberapa kemungkinan nama field.
  // Contoh: kelembapan bisa dikirim sebagai kelembapan atau humidity.
  const suhu = toNumber(body.suhu)
  const kelembapan = toNumber(body.kelembapan ?? body.humidity)
  const tekanan = toNumber(body.tekanan ?? body.pressure)
  const co = toNumber(body.co)
  const pm25 = toNumber(body.pm25 ?? body.pm2_5)
  const pm10 = toNumber(body.pm10)

  // Jika ESP32 sudah mengirim aktualPolusi, maka nilai tersebut langsung dipakai.
  // Jika tidak ada, server menghitung nilai aktualPolusi sebagai fallback
  // menggunakan data PM2.5, PM10, dan CO.
  const aktualPolusi =
    body.aktualPolusi !== undefined && body.aktualPolusi !== null
      ? toNumber(body.aktualPolusi)
      : hitungAktualPolusi(pm25, pm10, co)

  // Menyimpan data terbaru ke latestData agar dapat dibaca dashboard.
  latestData = {
    suhu,
    kelembapan,
    tekanan,
    co,
    pm25,
    pm10,

    aktualPolusi,
    prediksi: toNumber(body.prediksi),

    inferenceTimeMs: toNumber(body.inferenceTimeMs),
    readTimeMs: toNumber(body.readTimeMs),
    sendTimeMs: toNumber(body.sendTimeMs),
    latencyLocalMs: toNumber(body.latencyLocalMs),
    uptimeMs: toNumber(body.uptimeMs),

    model: body.model || "Model_ISPU_A_LOOKBACK_30",

    // Data buffer dari ESP32
    bufferCount: toNumber(body.bufferCount),
    bufferReady: toBoolean(body.bufferReady),

    source: body.source || "ESP32-S3",
    waktu: new Date().toLocaleString("id-ID"),
    timestamp: Date.now()
  }

  console.log("DATA TERBARU DISIMPAN:")
  console.log(latestData)

  res.status(200).json({
    success: true,
    message: "Data berhasil diterima",
    data: latestData
  })
})

// ================= KIRIM DATA KE DASHBOARD =================
// Endpoint untuk dashboard mengambil data terbaru.
// Data yang dikirim adalah isi latestData.
app.get("/data", (req, res) => {
  res.json(latestData)
})

app.get("/sensor", (req, res) => {
  res.json(latestData)
})

app.get("/sensor/latest", (req, res) => {
  res.json(latestData)
})

// ================= RESET BUFFER AI DARI DASHBOARD =================
// Dashboard memanggil endpoint ini ketika tombol Reset Buffer ditekan

// Endpoint ini dipanggil dashboard ketika tombol Reset Buffer ditekan.
// Server membuat status resetBuffer = true, lalu ESP32 akan membacanya
// melalui endpoint /buffer/command.
app.post("/buffer/reset", (req, res) => {
  bufferResetRequest = true
  bufferResetRequestedAt = Date.now()

  console.log("\n================================")
  console.log("PERINTAH RESET BUFFER AI DARI DASHBOARD")
  console.log("Requested At:", new Date(bufferResetRequestedAt).toLocaleString("id-ID"))
  console.log("================================")

  res.status(200).json({
    success: true,
    message: "Perintah reset buffer AI dikirim ke ESP32",
    resetBuffer: true,
    requestedAt: bufferResetRequestedAt
  })
})

// ================= COMMAND UNTUK DICEK ESP32 =================
// ESP32 akan GET endpoint ini setiap beberapa detik

// Endpoint ini dicek oleh ESP32 secara berkala.
// Jika resetBuffer bernilai true, ESP32 tahu bahwa dashboard meminta reset buffer AI.
app.get("/buffer/command", (req, res) => {
  res.json({
    resetBuffer: bufferResetRequest,
    requestedAt: bufferResetRequestedAt
  })
})

// ================= ACK DARI ESP32 =================
// ESP32 memanggil endpoint ini setelah berhasil reset buffer

// Endpoint ini dipanggil ESP32 setelah buffer berhasil direset.
// Server mengubah resetBuffer menjadi false dan memperbarui tampilan dashboard
// agar bufferCount kembali 0 dan prediksi sementara mengikuti nilai aktual.
app.post("/buffer/ack", (req, res) => {
  bufferResetRequest = false

  // Update tampilan dashboard supaya langsung terlihat reset
  latestData.bufferCount = 0
  latestData.bufferReady = false
  latestData.prediksi = latestData.aktualPolusi
  latestData.inferenceTimeMs = 0
  latestData.source = "ESP32-S3-Buffer-Reset"
  latestData.waktu = new Date().toLocaleString("id-ID")
  latestData.timestamp = Date.now()

  console.log("\n================================")
  console.log("ESP32 SUDAH RESET BUFFER AI")
  console.log("================================")

  res.status(200).json({
    success: true,
    message: "Perintah reset buffer AI sudah diterima ESP32",
    resetBuffer: false,
    data: latestData
  })
})

// ================= JALANKAN SERVER =================
// Menjalankan server pada PORT 3001 dan host 0.0.0.0.
// Host 0.0.0.0 membuat server dapat diakses dari perangkat lain dalam jaringan,
// termasuk ESP32-S3 yang mengirim data ke IP laptop.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server jalan di http://0.0.0.0:${PORT}`)
  console.log(`📡 ESP32 POST ke       : http://IP_LAPTOP:${PORT}/sensor`)
  console.log(`📊 Dashboard ambil dari: http://localhost:${PORT}/data`)
  console.log(`🔁 Reset buffer POST ke: http://localhost:${PORT}/buffer/reset`)
})