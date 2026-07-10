// Program Final App.jsx - versi dengan komentar penjelasan

import React, { useEffect, useRef, useState } from 'react'
import {
  HomeIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ClockIcon,
  BoltIcon,
  CloudIcon,
  XMarkIcon,
  ArrowPathIcon,
  BellAlertIcon
} from '@heroicons/react/24/outline'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend
} from 'recharts'

// Rentang normalisasi polusi untuk menghitung NMAE.
// NMAE membutuhkan pembagi berupa range data.
// Error MAE dibagi dengan POLLUTION_RANGE lalu dikalikan 100%.
const POLLUTION_RANGE = 155.42105263157896

// Batas minimal penyimpanan data evaluasi.
// Walaupun tampilan hanya menampilkan 30, 50, atau 100 data,
// sistem tetap menjaga minimal penyimpanan agar data evaluasi tidak cepat hilang.
const MIN_EVALUATION_STORAGE = 200

// Pengaturan default dashboard.
// Nilai ini digunakan ketika aplikasi pertama kali dibuka
// atau ketika user mengembalikan pengaturan ke default.
const DEFAULT_SETTINGS = {
  interval: 2,
  autoReset: true,
  notifications: true,
  theme: 'dark',
  units: 'metric',
  maxHistory: 720,
  evaluationEnabled: true,
  maxEvaluationHistory: 30,
  autoStopEvaluationAfterLimit: true
}

// Daftar endpoint backend yang akan dicoba oleh frontend.
// Jika endpoint pertama gagal, sistem mencoba endpoint berikutnya.
// Tujuannya agar dashboard tetap bisa mengambil data dari backend.
const BACKEND_ENDPOINTS = [
  'https://q22s5043-3001.asse.devtunnels.ms/data',
  'https://q22s5043-3001.asse.devtunnels.ms/sensor/latest',
  'https://q22s5043-3001.asse.devtunnels.ms/sensor'
]
// Komponen utama aplikasi.
// Di dalam App terdapat pengaturan state, pengambilan data realtime dari backend,
// penyimpanan riwayat, evaluasi prediksi, notifikasi, serta pemilihan halaman dashboard.
export default function App() {
  const [page, setPage] = useState('dashboard')

  // State data menyimpan data sensor terbaru yang ditampilkan di dashboard.
  // Nilainya diperbarui secara realtime dari backend.
  const [data, setData] = useState({
  suhu: 0,
  kelembapan: 0,
  tekanan: 0,
  pm25: 0,
  pm10: 0,
  co: 0,
  aktualPolusi: 0,
  prediksi: 0,
  inferenceTimeMs: 0,
  readTimeMs: 0,
  sendTimeMs: 0,
  latencyLocalMs: 0,
  source: 'Belum ada data',

  // Tambahan status buffer AI
  bufferCount: 0,
  bufferReady: false,

  time: '--:--:--',
  timestamp: null
})

  const [isDataReady, setIsDataReady] = useState(false)
  const dataRef = useRef(data)

  // historyData menyimpan riwayat pembacaan sensor.
  // Data awal diambil dari localStorage agar riwayat tidak hilang saat halaman di-refresh.
  const [historyData, setHistoryData] = useState(() => {
    return loadArrayFromLocalStorage('airSenseHistoryData')
  })

  const [notificationHistory, setNotificationHistory] = useState(() => {
    return loadArrayFromLocalStorage('airSenseNotificationHistory')
  })

  // predictionEvaluationHistory menyimpan data evaluasi prediksi AI.
  // Setiap prediksi disimpan, lalu dibandingkan dengan aktual sensor setelah target +2 jam tercapai.
  const [predictionEvaluationHistory, setPredictionEvaluationHistory] = useState(() => {
    return loadArrayFromLocalStorage('airSensePredictionEvaluationHistory')
  })

  const [riwayatTab, setRiwayatTab] = useState('data')
  const [currentDateTime, setCurrentDateTime] = useState(new Date())

  const lastNotificationStatusRef = useRef(null)

  // State settings menyimpan pengaturan dashboard seperti interval riwayat,
  // tema, satuan, notifikasi, dan batas data evaluasi.
  // Pengaturan juga diambil dari localStorage agar tetap tersimpan setelah refresh.
  const [settings, setSettings] = useState(() => {
    try {
      const savedSettings = localStorage.getItem('airSenseSettings')

      const parsedSettings = savedSettings
        ? { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) }
        : DEFAULT_SETTINGS

      const interval = Number(parsedSettings.interval ?? DEFAULT_SETTINGS.interval)

      return {
  ...parsedSettings,
  interval,
  maxHistory: hitungMaxHistoryOtomatis(interval),
  evaluationEnabled: parsedSettings.evaluationEnabled ?? DEFAULT_SETTINGS.evaluationEnabled,
  maxEvaluationHistory: Number(parsedSettings.maxEvaluationHistory ?? DEFAULT_SETTINGS.maxEvaluationHistory),
  autoStopEvaluationAfterLimit:
    parsedSettings.autoStopEvaluationAfterLimit ??
    DEFAULT_SETTINGS.autoStopEvaluationAfterLimit
}
    } catch {
      return {
        ...DEFAULT_SETTINGS,
        maxHistory: hitungMaxHistoryOtomatis(DEFAULT_SETTINGS.interval)
      }
    }
  })

  // Menyimpan data terbaru ke dataRef.
  // dataRef digunakan agar interval penyimpanan riwayat selalu membaca data paling baru.
  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Menyimpan pengaturan dashboard ke localStorage setiap kali settings berubah.
  useEffect(() => {
    localStorage.setItem('airSenseSettings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    localStorage.setItem('airSenseHistoryData', JSON.stringify(historyData))
  }, [historyData])

  useEffect(() => {
    localStorage.setItem(
      'airSenseNotificationHistory',
      JSON.stringify(notificationHistory)
    )
  }, [notificationHistory])

  useEffect(() => {
    localStorage.setItem(
      'airSensePredictionEvaluationHistory',
      JSON.stringify(predictionEvaluationHistory)
    )
  }, [predictionEvaluationHistory])

  useEffect(() => {
    setPredictionEvaluationHistory(prev => {
      if (!Array.isArray(prev)) return []

      const storageLimit = getEvaluationStorageLimit(settings.maxEvaluationHistory)

      return prev.slice(-storageLimit)
    })
  }, [settings.maxEvaluationHistory])

  // Mengupdate tanggal dan jam realtime setiap 1 detik.
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  // Mengambil data realtime dari backend.
  // Data dari backend berasal dari ESP32-S3, lalu dikonversi ke Number
  // supaya aman digunakan untuk grafik, status, dan perhitungan evaluasi.
  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await fetchSensorBackend()

        console.log('DATA BACKEND MASUK:', result)

        const suhu = Number(result.suhu ?? 0)
        const kelembapan = Number(result.kelembapan ?? result.humidity ?? 0)
        const tekanan = Number(result.tekanan ?? result.pressure ?? 0)
        const pm25 = Number(result.pm25 ?? result.pm2_5 ?? 0)
        const pm10 = Number(result.pm10 ?? 0)
        const co = Number(result.co ?? 0)

        // Mengambil nilai aktualPolusi dari backend.
        // Jika backend tidak mengirim aktualPolusi, frontend menghitung fallback
        // menggunakan fungsi hitungNilaiAktualPolusi().
        const aktualPolusiDariBackend = Number(result.aktualPolusi ?? NaN)

        const aktualPolusi = Number.isFinite(aktualPolusiDariBackend)
          ? Math.round(aktualPolusiDariBackend)
          : hitungNilaiAktualPolusi({ pm25, pm10, co })

        // Mengambil hasil prediksi AI dari ESP32-S3.
        // Beberapa nama field disediakan untuk menjaga kompatibilitas data.
        const prediksiDariESP = Number(
          result.prediksi ??
          result.prediction ??
          result.aiPrediction ??
          0
        )

        const prediksi = Number.isFinite(prediksiDariESP)
          ? Math.round(prediksiDariESP)
          : 0

        const inferenceTimeMs = Number(result.inferenceTimeMs ?? 0)
        const readTimeMs = Number(result.readTimeMs ?? 0)
        const sendTimeMs = Number(result.sendTimeMs ?? 0)
        const latencyLocalMs = Number(result.latencyLocalMs ?? 0)
        const source = result.source ?? 'ESP32-S3'

        const bufferCount = Number(result.bufferCount ?? 0)

const bufferReady =
  typeof result.bufferReady === 'boolean'
    ? result.bufferReady
    : String(result.bufferReady).toLowerCase() === 'true'

        const now = new Date()

        const newData = {
  suhu,
  kelembapan,
  tekanan,
  pm25,
  pm10,
  co,
  aktualPolusi,
  prediksi,
  inferenceTimeMs,
  readTimeMs,
  sendTimeMs,
  latencyLocalMs,
  source,

  // Tambahan status buffer AI
  bufferCount,
  bufferReady,

  time: now.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }),
  timestamp: now.getTime()
}

        console.log('DATA MASUK DASHBOARD:', newData)

        setData(newData)
        setIsDataReady(true)
      } catch (error) {
        console.log('Gagal mengambil data backend:', error)
      }
    }

    fetchData()

    const realtimeInterval = setInterval(fetchData, 10000)

    return () => clearInterval(realtimeInterval)
  }, [])

  // Mengecek apakah ada data evaluasi prediksi yang sudah mencapai target +2 jam.
  // Jika sudah waktunya, data prediksi akan dibandingkan dengan aktual sensor saat ini.
  useEffect(() => {
    if (!isDataReady || !data.timestamp) return

    setPredictionEvaluationHistory(prev => {
      const updated = updatePredictionEvaluations(
        prev,
        data,
        Date.now()
      )

      const storageLimit = getEvaluationStorageLimit(settings.maxEvaluationHistory)

      return updated.slice(-storageLimit)
    })
  }, [data.timestamp, isDataReady, settings.maxEvaluationHistory])

  // Menyimpan snapshot data sensor ke riwayat berdasarkan interval pengaturan.
  // Pada bagian ini juga dibuat record evaluasi prediksi baru jika evaluasi aktif
  // dan buffer TinyML sudah siap.
  useEffect(() => {
    if (!isDataReady) return

    const saveHistorySnapshot = () => {
      const now = new Date()
      const today = now.toDateString()
      const latest = dataRef.current

      if (!latest || !latest.timestamp) return

      const newHistoryData = {
        ...latest,
        time: now.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        date: today,
        timestamp: now.getTime()
      }

      setHistoryData(prev => {
        if (settings.autoReset && prev.length > 0 && prev[0].date !== today) {
          return [newHistoryData]
        }

        return [...prev, newHistoryData].slice(-settings.maxHistory)
      })

      setPredictionEvaluationHistory(prev => {
  const selectedLimit = Number(settings.maxEvaluationHistory) || 30
  const storageLimit = getEvaluationStorageLimit(selectedLimit)

  const updated = updatePredictionEvaluations(
    prev,
    latest,
    now.getTime()
  ).slice(-storageLimit)

  if (!settings.evaluationEnabled) {
    return updated
  }

  // Opsional tapi disarankan:
  // Evaluasi baru hanya dibuat kalau buffer TinyML sudah siap.
  if (latest.bufferReady === false) {
    return updated
  }

  // Auto stop:
  // Kalau jumlah data evaluasi sudah mencapai batas pilihan,
  // sistem tidak membuat data Menunggu baru lagi.
  if (
    settings.autoStopEvaluationAfterLimit &&
    updated.length >= selectedLimit
  ) {
    return updated
  }

  const newEvaluationRecord = createPredictionEvaluationRecord(
    latest,
    now.getTime()
  )

  return [...updated, newEvaluationRecord].slice(-storageLimit)
})
    }

    saveHistorySnapshot()

    const historyInterval = setInterval(
      saveHistorySnapshot,
      settings.interval * 60 * 1000
    )

    return () => clearInterval(historyInterval)
  }, [
  isDataReady,
  settings.interval,
  settings.autoReset,
  settings.maxHistory,
  settings.evaluationEnabled,
  settings.maxEvaluationHistory,
  settings.autoStopEvaluationAfterLimit
])

  // Menjalankan notifikasi jika prediksi AI masuk kategori Tidak Sehat ke atas.
  // Notifikasi tidak dikirim berulang jika statusnya masih sama.
  useEffect(() => {
    if (!settings.notifications) {
      lastNotificationStatusRef.current = null
      return
    }

    const status = getStatus(data.prediksi)
    const isPolusiTinggi = data.prediksi > 100

    if (!isPolusiTinggi) {
      lastNotificationStatusRef.current = null
      return
    }

    if (lastNotificationStatusRef.current === status) return

    lastNotificationStatusRef.current = status

    const now = new Date()

    const message =
      data.prediksi <= 200
        ? `Kualitas udara Tidak Sehat. Nilai prediksi AI saat ini ${data.prediksi}. Sebaiknya gunakan masker saat keluar ruangan.`
        : data.prediksi <= 300
          ? `Kualitas udara Sangat Tidak Sehat. Nilai prediksi AI saat ini ${data.prediksi}. Kurangi aktivitas di luar ruangan.`
          : `Kualitas udara Berbahaya. Nilai prediksi AI saat ini ${data.prediksi}. Tidak disarankan keluar rumah kecuali mendesak.`

    const newNotification = {
      id: now.getTime(),
      time: now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      date: now.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      }),
      prediksi: data.prediksi,
      status,
      message,
      isTest: false
    }

    setNotificationHistory(prev => [newNotification, ...prev].slice(0, 100))

    playNotificationSound()

    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('Peringatan Polusi Tinggi', {
          body: message
        })
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification('Peringatan Polusi Tinggi', {
              body: message
            })
          }
        })
      }
    }
  }, [data.prediksi, settings.notifications])

  // Membuat data prediksi setiap 2 jam untuk tampilan halaman Prediksi AI.
  const prediksiPer2Jam = generatePrediksiPer2Jam(
    data.prediksi,
    currentDateTime.getTime()
  )

  const suhuDisplay = formatTemperature(data.suhu, settings.units)
  const tekananDisplay = formatPressure(data.tekanan, settings.units)

  const historyChartData = historyData.map(item => ({
    ...item,
    suhuGrafik: formatTemperature(item.suhu, settings.units).value,
    tekananGrafik: formatPressure(item.tekanan, settings.units).value
  }))

  const visibleEvaluationHistory = predictionEvaluationHistory.slice(
  -settings.maxEvaluationHistory
)

// Menghitung ringkasan evaluasi seperti MAE, MAPE, NMAE, dan akurasi.
const evaluationStats = getEvaluationStats(visibleEvaluationHistory)

// Membuat data grafik akurasi dari evaluasi yang sudah selesai.
const accuracyChartData = buildAccuracyChartData(visibleEvaluationHistory)

  const suhuUnit = settings.units === 'imperial' ? '°F' : '°C'
  const tekananUnit = settings.units === 'imperial' ? 'inHg' : 'hPa'

  const isDark = settings.theme === 'dark'

  const theme = {
    app: isDark ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-900',
    sidebar: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300',
    panel: isDark ? 'bg-slate-800' : 'bg-white',
    panelSoft: isDark ? 'bg-slate-700' : 'bg-slate-200',
    card: isDark ? 'bg-slate-800' : 'bg-white',
    cardSoft: isDark ? 'bg-slate-700' : 'bg-slate-100',
    muted: isDark ? 'text-gray-400' : 'text-slate-600',
    menuActive: isDark ? 'bg-slate-800 text-cyan-400' : 'bg-cyan-100 text-cyan-700',
    menuInactive: isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200',
    input: isDark ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900',
    chartGrid: isDark ? '#374151' : '#CBD5E1',
    chartAxis: isDark ? '#9CA3AF' : '#475569',
    tooltipBg: isDark ? '#1e293b' : '#ffffff',
    tooltipBorder: '#06b6d4',
    sidebarBorder: isDark ? 'border-slate-700' : 'border-slate-300'
  }

  // Evaluasi performa TinyML.
  // Target penelitian: waktu inference model AI harus kurang dari 5 detik atau 5000 ms.
  const tinyMLTime = Number(data.inferenceTimeMs || 0)
  const tinyMLTargetMs = 5000
  const tinyMLHasData = Boolean(data.timestamp)
  const tinyMLMemenuhi = tinyMLHasData && tinyMLTime < tinyMLTargetMs

  const tinyMLStatus = !tinyMLHasData
    ? 'Menunggu data'
    : tinyMLMemenuhi
      ? 'Memenuhi target < 5 detik'
      : 'Melebihi target'

  const tinyMLStatusColor = !tinyMLHasData
    ? 'text-yellow-400'
    : tinyMLMemenuhi
      ? 'text-green-400'
      : 'text-red-400'

  // Evaluasi performa pengiriman data.
  // Target penelitian: latensi pengiriman data harus kurang dari 10 detik atau 10000 ms.
  const latencyMs = Number(data.latencyLocalMs || data.sendTimeMs || 0)
  const latencyTargetMs = 10000
  const latencyHasData = Boolean(data.timestamp)
  const latencyMemenuhi = latencyHasData && latencyMs < latencyTargetMs

  const latencyStatus = !latencyHasData
    ? 'Menunggu data'
    : latencyMemenuhi
      ? 'Memenuhi target < 10 detik'
      : 'Melebihi target'

  const latencyStatusColor = !latencyHasData
    ? 'text-yellow-400'
    : latencyMemenuhi
      ? 'text-green-400'
      : 'text-red-400'

  const dashboardHasData = Boolean(data.timestamp) && data.source !== 'Belum ada data'
  const sourceStatusText = dashboardHasData ? 'Ada' : 'Tidak Ada'
  const sourceStatusColor = dashboardHasData ? 'text-green-400' : 'text-yellow-400'

  return (
    <div className={`min-h-screen font-sans ${theme.app}`}>
      <aside className={`fixed left-0 top-0 z-40 w-64 h-screen p-6 border-r ${theme.sidebar} flex flex-col overflow-y-auto`}>
        <h1 className="text-2xl font-bold text-cyan-400 mb-8">AirSense AI</h1>

        <nav className="space-y-2">
          <MenuItem
            title="Dashboard"
            icon={<HomeIcon className="w-5 h-5" />}
            active={page === 'dashboard'}
            onClick={() => setPage('dashboard')}
            theme={theme}
          />

          <MenuItem
            title="Prediksi AI"
            icon={<BoltIcon className="w-5 h-5" />}
            active={page === 'ai'}
            onClick={() => setPage('ai')}
            theme={theme}
          />

          <MenuItem
            title="Monitoring"
            icon={<ChartBarIcon className="w-5 h-5" />}
            active={page === 'monitoring'}
            onClick={() => setPage('monitoring')}
            theme={theme}
          />

          <MenuItem
            title="Riwayat"
            icon={<ClockIcon className="w-5 h-5" />}
            active={page === 'riwayat'}
            onClick={() => setPage('riwayat')}
            theme={theme}
            badge={notificationHistory.length}
          />

          <MenuItem
            title="Pengaturan"
            icon={<Cog6ToothIcon className="w-5 h-5" />}
            active={page === 'pengaturan'}
            onClick={() => setPage('pengaturan')}
            theme={theme}
          />
        </nav>

        <SidebarISPU theme={theme} />
      </aside>

      <main className="ml-64 min-h-screen p-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto">
          {page === 'dashboard' && (
            <DashboardPage
              data={data}
              theme={theme}
              currentDateTime={currentDateTime}
              suhuDisplay={suhuDisplay}
              tekananDisplay={tekananDisplay}
              evaluationStats={evaluationStats}
              settings={settings}
              isDark={isDark}
              sourceStatusText={sourceStatusText}
              sourceStatusColor={sourceStatusColor}
            />
          )}

          {page === 'ai' && (
            <PredictionPage
              data={data}
              theme={theme}
              currentDateTime={currentDateTime}
              prediksiPer2Jam={prediksiPer2Jam}
              tinyMLTime={tinyMLTime}
              tinyMLStatus={tinyMLStatus}
              tinyMLStatusColor={tinyMLStatusColor}
            />
          )}

          {page === 'monitoring' && (
            <MonitoringPage
              data={data}
              theme={theme}
              currentDateTime={currentDateTime}
              suhuDisplay={suhuDisplay}
              tekananDisplay={tekananDisplay}
              latencyMs={latencyMs}
              latencyStatus={latencyStatus}
              latencyStatusColor={latencyStatusColor}
            />
          )}

          {page === 'riwayat' && (
            <HistoryPage
              riwayatTab={riwayatTab}
              setRiwayatTab={setRiwayatTab}
              historyData={historyData}
              historyChartData={historyChartData}
              notificationHistory={notificationHistory}
              predictionEvaluationHistory={predictionEvaluationHistory}
              settings={settings}
              setSettings={setSettings}
              evaluationStats={evaluationStats}
              accuracyChartData={accuracyChartData}
              suhuUnit={suhuUnit}
              tekananUnit={tekananUnit}
              theme={theme}
            />
          )}

          {page === 'pengaturan' && (
            <SettingsPage
              settings={settings}
              setSettings={setSettings}
              setHistoryData={setHistoryData}
              setNotificationHistory={setNotificationHistory}
              setPredictionEvaluationHistory={setPredictionEvaluationHistory}
              theme={theme}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// Menampilkan halaman utama dashboard berisi prediksi AI, nilai aktual sensor, status buffer, status sumber data, ringkasan evaluasi, dan insight kualitas udara.
function DashboardPage({
  data,
  theme,
  currentDateTime,
  suhuDisplay,
  tekananDisplay,
  evaluationStats,
  settings,
  isDark,
  sourceStatusText,
  sourceStatusColor
}) {
  const bufferText = data.bufferReady
    ? 'TinyML Aktif'
    : `Buffer ${data.bufferCount || 0}/30`

  const bufferColor = data.bufferReady
    ? 'text-green-400'
    : 'text-yellow-300'

  return (
    <>
      <h2 className="text-3xl font-bold mb-6">Dashboard</h2>

      <div className={`p-6 rounded-xl mb-6 bg-gradient-to-r ${getGradientColor(data.prediksi)}`}>
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
          <div className="flex-1">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,360px)] gap-4">

              {/* BAGIAN PREDIKSI */}
              <div className="pr-0 lg:pr-5">
                <h3 className="text-lg">
                  Prediksi Polusi Saat Ini
                </h3>

                <p className="text-6xl font-bold mt-2">
                  {data.prediksi}
                </p>

                <p className="mt-2 text-lg">
                  Status: <span className="font-semibold">{getStatus(data.prediksi)}</span>
                </p>

                {/* KOTAK KECIL BUFFER DI BAWAH PREDIKSI */}
                <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black/15 backdrop-blur-sm">
                  <span className="text-sm opacity-90">
                    Buffer AI:
                  </span>

                  <span className={`text-sm font-bold ${bufferColor}`}>
                    {bufferText}
                  </span>
                </div>
              </div>

              {/* BAGIAN AKTUAL SENSOR */}
              <div className="pt-6 lg:pt-0 lg:pl-5 border-t lg:border-t-0 lg:border-l border-black/20">
                <h3 className="text-lg">
                  Nilai Aktual Sensor
                </h3>

                <p className="text-6xl font-bold mt-2">
                  {data.aktualPolusi}
                </p>

                <p className="mt-2 text-lg">
                  Status: <span className="font-semibold">{getStatus(data.aktualPolusi)}</span>
                </p>

                {/* KOTAK KECIL SUMBER DATA DI BAWAH AKTUAL SENSOR */}
                <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black/15 backdrop-blur-sm">
                  <span className="text-sm opacity-90">
                    Sumber data:
                  </span>

                  <span className={`text-sm font-bold ${sourceStatusColor}`}>
                    {sourceStatusText}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* BAGIAN TANGGAL DAN JAM */}
          <div className="bg-black/10 rounded-xl px-5 py-4 min-w-\[320px] backdrop-blur-sm">
            <div className="flex items-center justify-center gap-5">
              <CloudIcon className="w-16 h-16 opacity-90 flex-shrink-0" />

              <div className="text-center">
                <p className="text-sm font-semibold opacity-80">
                  Tanggal & Jam
                </p>

                <p className="text-lg font-bold mt-1">
                  {currentDateTime.toLocaleDateString('id-ID', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric'
                  })}
                </p>

                <p className="text-3xl font-bold mt-2">
                  {currentDateTime.toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-6">
        <MiniCard title="Suhu" value={suhuDisplay.value} unit={suhuDisplay.unit} theme={theme} />
        <MiniCard title="RH" value={data.kelembapan} unit="%" theme={theme} />
        <MiniCard title="Tekanan" value={tekananDisplay.value} unit={tekananDisplay.unit} theme={theme} />
        <MiniCard title="PM2.5" value={data.pm25} unit="µg/m³" theme={theme} />
        <MiniCard title="PM10" value={data.pm10} unit="µg/m³" theme={theme} />
        <MiniCard title="CO" value={data.co} unit="ppm" theme={theme} />
      </div>

      <div className={`${theme.panel} p-6 rounded-xl shadow-md mb-6`}>
        <h3 className="text-lg font-semibold mb-3 text-cyan-400">
          Ringkasan Evaluasi Prediksi
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
          <InfoCard title="Akurasi NMAE" value={`${evaluationStats.accuracy}%`} theme={theme} />
          <InfoCard title="MAE" value={evaluationStats.mae} theme={theme} />
          <InfoCard title="NMAE" value={`${evaluationStats.nmae}%`} theme={theme} />
          <InfoCard title="MAPE" value={`${evaluationStats.mape}%`} theme={theme} />
          <InfoCard title="Total Dinilai" value={evaluationStats.evaluated} theme={theme} />
          <InfoCard title="Menunggu" value={evaluationStats.pending} theme={theme} />
        </div>

        <p className={`text-xs mt-4 ${theme.muted}`}>
          Akurasi dihitung menggunakan 100% - NMAE • MAPE hanya sebagai metrik tambahan •
          Tabel evaluasi menampilkan {settings.maxEvaluationHistory} data terakhir
        </p>
      </div>

      <div className={`${theme.panel} p-6 rounded-xl shadow-md`}>
        <h3 className="text-lg font-semibold mb-3 text-cyan-400">
          Insight Sistem
        </h3>

        <p className={isDark ? 'text-gray-300' : 'text-slate-700'}>
          Berdasarkan hasil prediksi AI dari ESP32-S3, kualitas udara berada pada kategori
          <span className="font-bold"> {getStatus(data.prediksi)} </span>.
          {data.prediksi <= 100
            ? ' Kondisi udara masih relatif aman untuk aktivitas sehari-hari.'
            : data.prediksi <= 200
              ? ' Kualitas udara tidak sehat. Sebaiknya gunakan masker saat beraktivitas di luar ruangan.'
              : data.prediksi <= 300
                ? ' Kualitas udara sangat tidak sehat. Gunakan masker dan kurangi aktivitas di luar ruangan.'
                : ' Kualitas udara berbahaya. Tidak disarankan keluar rumah kecuali untuk keperluan mendesak.'}
        </p>
      </div>
    </>
  )
}

// Menampilkan halaman Prediksi AI, termasuk nilai prediksi ESP32-S3, proyeksi setiap 2 jam, serta evaluasi waktu pemrosesan TinyML.
function PredictionPage({
  data,
  theme,
  currentDateTime,
  prediksiPer2Jam,
  tinyMLTime,
  tinyMLStatus,
  tinyMLStatusColor
}) {
  return (
    <>
      <h2 className="text-3xl font-bold mb-6">Prediksi AI</h2>

      <div className={`p-6 rounded-xl mb-6 bg-gradient-to-r ${getGradientColor(data.prediksi)}`}>
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
          <div>
            <h3>Hasil Prediksi AI dari ESP32-S3</h3>

            <p className="text-5xl font-bold mt-2">
              {data.prediksi}
            </p>

            <p className="mt-2 text-lg">
              Status: <span className="font-semibold">{getStatus(data.prediksi)}</span>
            </p>

            <p className="text-sm mt-3 opacity-90">
              Metode: <span className="font-semibold">Deep Learning CNN-LSTM berbasis TinyML</span>
            </p>

            <p className="text-sm mt-1 opacity-90">
              Model: <span className="font-semibold">ISPU_A_LOOKBACK_30</span>
            </p>
          </div>

          <div className="md:text-right bg-black/10 rounded-xl px-5 py-4 min-w-\[260px] backdrop-blur-sm">
            <p className="text-sm font-semibold opacity-80">
              Tanggal & Jam
            </p>

            <p className="text-lg font-bold mt-1">
              {currentDateTime.toLocaleDateString('id-ID', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric'
              })}
            </p>

            <p className="text-3xl font-bold mt-2">
              {currentDateTime.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </p>
          </div>
        </div>
      </div>

      <div className={`${theme.panel} p-6 rounded-xl shadow-md mb-6`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-5">
          <div>
            <h3 className="text-xl font-semibold text-cyan-400">
              Prediksi Polusi Setiap 2 Jam
            </h3>

            <p className={`text-sm mt-1 ${theme.muted}`}>
              Nilai utama berasal dari ESP32-S3. Data 4 sampai 24 jam adalah estimasi tampilan berdasarkan prediksi saat ini.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {prediksiPer2Jam.map(item => (
            <PrediksiJamCard
              key={item.jamKeDepan}
              waktu={item.waktu}
              jamKeDepan={item.jamKeDepan}
              value={item.prediksi}
            />
          ))}
        </div>
      </div>

      <div className={`${theme.panel} p-6 rounded-xl shadow-md mb-6`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
          <div>
            <h3 className="text-xl font-semibold text-cyan-400">
              Performa Pemrosesan TinyML
            </h3>

            <p className={`text-sm mt-1 ${theme.muted}`}>
              Evaluasi waktu proses model AI pada ESP32-S3.
            </p>
          </div>

          <span className={`px-4 py-2 rounded-full text-sm font-bold bg-black/20 ${tinyMLStatusColor}`}>
            {tinyMLStatus}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`${theme.cardSoft} p-5 rounded-xl text-center`}>
            <p className={`text-xs uppercase tracking-wide ${theme.muted}`}>
              Waktu Pemrosesan TinyML
            </p>

            <p className="text-3xl font-bold text-cyan-400 mt-2">
              {tinyMLTime.toFixed(2)} ms
            </p>

            <p className={`text-xs mt-2 ${theme.muted}`}>
              Waktu inference model AI
            </p>
          </div>

          <div className={`${theme.cardSoft} p-5 rounded-xl text-center`}>
            <p className={`text-xs uppercase tracking-wide ${theme.muted}`}>
              Target Penelitian
            </p>

            <p className="text-3xl font-bold text-cyan-400 mt-2">
              &lt; 5000 ms
            </p>

            <p className={`text-xs mt-2 ${theme.muted}`}>
              Setara kurang dari 5 detik
            </p>
          </div>

          <div className={`${theme.cardSoft} p-5 rounded-xl text-center`}>
            <p className={`text-xs uppercase tracking-wide ${theme.muted}`}>
              Status TinyML
            </p>

            <p className={`text-xl font-bold mt-3 ${tinyMLStatusColor}`}>
              {tinyMLStatus}
            </p>

            <p className={`text-xs mt-2 ${theme.muted}`}>
              Berdasarkan batas waktu proses AI
            </p>
          </div>
        </div>

        <p className={`text-sm mt-4 ${theme.muted}`}>
          Waktu pemrosesan TinyML digunakan untuk membuktikan bahwa model AI dapat berjalan pada perangkat IoT berdaya rendah dengan target waktu proses di bawah 5 detik.
        </p>
      </div>
    </>
  )
}

// Menampilkan halaman monitoring sensor lingkungan, partikel, gas CO, serta evaluasi latensi pengiriman data dari ESP32-S3 ke backend.
function MonitoringPage({
  data,
  theme,
  currentDateTime,
  suhuDisplay,
  tekananDisplay,
  latencyMs,
  latencyStatus,
  latencyStatusColor
}) {
  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-3xl font-bold">Monitoring Sensor</h2>

          <p className={`text-sm mt-1 ${theme.muted}`}>
            Pemantauan realtime sensor lingkungan, partikel udara, dan gas karbon monoksida.
          </p>
        </div>

        <div className={`${theme.panel} px-4 py-3 rounded-xl shadow-md`}>
          <p className={`text-xs ${theme.muted}`}>
            Waktu Monitoring
          </p>

          <p className="font-semibold text-cyan-400">
            {currentDateTime.toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </p>
        </div>
      </div>

      <MonitoringGroup
        title="Sensor Lingkungan"
        subtitle="BME280"
        desc="Memantau suhu, kelembapan, dan tekanan udara."
        theme={theme}
      >
        <MonitoringMetricCard
          title="Suhu"
          sensor="BME280"
          value={suhuDisplay.value}
          unit={suhuDisplay.unit}
          condition={getTemperatureCondition(data.suhu)}
          progress={getProgressValue(data.suhu, 45)}
          theme={theme}
        />

        <MonitoringMetricCard
          title="Kelembapan"
          sensor="BME280"
          value={data.kelembapan}
          unit="%"
          condition={getHumidityCondition(data.kelembapan)}
          progress={getProgressValue(data.kelembapan, 100)}
          theme={theme}
        />

        <MonitoringMetricCard
          title="Tekanan"
          sensor="BME280"
          value={tekananDisplay.value}
          unit={tekananDisplay.unit}
          condition={getPressureCondition(data.tekanan)}
          progress={getPressureProgress(data.tekanan)}
          theme={theme}
        />
      </MonitoringGroup>

      <MonitoringGroup
        title="Sensor Partikel Udara"
        subtitle="PMS5003"
        desc="Memantau konsentrasi partikel PM2.5 dan PM10 di udara."
        theme={theme}
      >
        <MonitoringMetricCard
          title="PM2.5"
          sensor="PMS5003"
          value={data.pm25}
          unit="µg/m³"
          condition={getPollutantCondition(data.pm25)}
          progress={getProgressValue(data.pm25, 300)}
          theme={theme}
        />

        <MonitoringMetricCard
          title="PM10"
          sensor="PMS5003"
          value={data.pm10}
          unit="µg/m³"
          condition={getPollutantCondition(data.pm10)}
          progress={getProgressValue(data.pm10, 300)}
          theme={theme}
        />
      </MonitoringGroup>

      <MonitoringGroup
        title="Sensor Gas"
        subtitle="MEMS Carbon Monoxide"
        desc="Memantau kadar gas karbon monoksida dalam satuan ppm."
        theme={theme}
      >
        <MonitoringMetricCard
          title="CO"
          sensor="MEMS CO"
          value={data.co}
          unit="ppm"
          condition={getCOCondition(data.co)}
          progress={getProgressValue(data.co, 50)}
          theme={theme}
        />
      </MonitoringGroup>

      <div className={`${theme.panel} p-6 rounded-xl shadow-md mb-6`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
          <div>
            <h3 className="text-xl font-semibold text-cyan-400">
              Performa Pengiriman Data Sensor
            </h3>

            <p className={`text-sm mt-1 ${theme.muted}`}>
              Evaluasi latensi pengiriman data dari ESP32-S3 ke backend dashboard.
            </p>
          </div>

          <span className={`px-4 py-2 rounded-full text-sm font-bold bg-black/20 ${latencyStatusColor}`}>
            {latencyStatus}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`${theme.cardSoft} p-5 rounded-xl text-center`}>
            <p className={`text-xs uppercase tracking-wide ${theme.muted}`}>
              Latensi Pengiriman
            </p>

            <p className="text-3xl font-bold text-cyan-400 mt-2">
              {latencyMs.toFixed(0)} ms
            </p>

            <p className={`text-xs mt-2 ${theme.muted}`}>
              Read time + send time
            </p>
          </div>

          <div className={`${theme.cardSoft} p-5 rounded-xl text-center`}>
            <p className={`text-xs uppercase tracking-wide ${theme.muted}`}>
              Target Penelitian
            </p>

            <p className="text-3xl font-bold text-cyan-400 mt-2">
              &lt; 10000 ms
            </p>

            <p className={`text-xs mt-2 ${theme.muted}`}>
              Setara kurang dari 10 detik
            </p>
          </div>

          <div className={`${theme.cardSoft} p-5 rounded-xl text-center`}>
            <p className={`text-xs uppercase tracking-wide ${theme.muted}`}>
              Status Latensi
            </p>

            <p className={`text-xl font-bold mt-3 ${latencyStatusColor}`}>
              {latencyStatus}
            </p>

            <p className={`text-xs mt-2 ${theme.muted}`}>
              Berdasarkan target realtime sistem IoT
            </p>
          </div>
        </div>

        <p className={`text-sm mt-4 ${theme.muted}`}>
          Latensi pengiriman data digunakan untuk membuktikan bahwa sistem monitoring kualitas udara berbasis IoT mampu mengirim data sensor secara realtime dengan target kurang dari 10 detik.
        </p>
      </div>

      <div className={`${theme.panel} p-6 rounded-xl shadow-md`}>
        <h3 className="text-lg font-semibold text-cyan-400 mb-3">
          Catatan Monitoring
        </h3>

        <p className={theme.muted}>
          {getMonitoringAdvice(data.prediksi)}
        </p>
      </div>
    </>
  )
}

// Mengatur tampilan halaman riwayat, yaitu riwayat data sensor, evaluasi prediksi AI, dan riwayat notifikasi.
function HistoryPage({
  riwayatTab,
  setRiwayatTab,
  historyData,
  historyChartData,
  notificationHistory,
  predictionEvaluationHistory,
  settings,
  setSettings,
  evaluationStats,
  accuracyChartData,
  suhuUnit,
  tekananUnit,
  theme
}) {
  return (
    <>
      <h2 className="text-3xl font-bold mb-6">Riwayat</h2>

      <div className="flex flex-wrap gap-3 mb-6">
        <TabButton
          active={riwayatTab === 'data'}
          onClick={() => setRiwayatTab('data')}
          theme={theme}
        >
          Riwayat Data
        </TabButton>

        <TabButton
          active={riwayatTab === 'evaluasi'}
          onClick={() => setRiwayatTab('evaluasi')}
          theme={theme}
        >
          <BoltIcon className="w-5 h-5" />
          <span>Evaluasi Prediksi AI</span>
        </TabButton>

        <TabButton
          active={riwayatTab === 'notifikasi'}
          onClick={() => setRiwayatTab('notifikasi')}
          theme={theme}
        >
          <BellAlertIcon className={`w-5 h-5 ${notificationHistory.length > 0 ? 'text-red-400' : ''}`} />
          <span>Riwayat Notifikasi</span>

          {notificationHistory.length > 0 && (
            <span className="min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
              {notificationHistory.length > 99 ? '99+' : notificationHistory.length}
            </span>
          )}
        </TabButton>
      </div>

      {riwayatTab === 'data' && (
        <SensorHistorySection
          historyData={historyData}
          historyChartData={historyChartData}
          settings={settings}
          suhuUnit={suhuUnit}
          tekananUnit={tekananUnit}
          theme={theme}
        />
      )}

      {riwayatTab === 'evaluasi' && (
        <PredictionEvaluationSection
          history={predictionEvaluationHistory}
          stats={evaluationStats}
          accuracyChartData={accuracyChartData}
          evaluationEnabled={settings.evaluationEnabled}
          maxEvaluationHistory={settings.maxEvaluationHistory}
          setSettings={setSettings}
          theme={theme}
        />
      )}

      {riwayatTab === 'notifikasi' && (
        <NotificationHistorySection
          notificationHistory={notificationHistory}
          theme={theme}
        />
      )}
    </>
  )
}

// Menampilkan grafik riwayat sensor seperti suhu, kelembapan, tekanan, PM2.5, PM10, CO, aktual polusi, prediksi AI, latensi, dan waktu TinyML.
function SensorHistorySection({
  historyData,
  historyChartData,
  settings,
  suhuUnit,
  tekananUnit,
  theme
}) {
  return (
    <>
      <div className={`${theme.panel} p-4 rounded-xl mb-6 shadow-md`}>
        <p className={`text-sm ${theme.muted}`}>
          📈 {historyData.length} titik data • Data riwayat disimpan setiap {settings.interval} menit •
          Auto reset: {settings.autoReset ? 'Ya' : 'Tidak'}
        </p>
      </div>

      <ChartBox title="Suhu & Kelembapan" theme={theme}>
        <LineChart data={historyChartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
          <XAxis dataKey="time" stroke={theme.chartAxis} />
          <YAxis stroke={theme.chartAxis} />
          <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder }} />
          <Legend />
          <Line type="monotone" dataKey="suhuGrafik" stroke="#f97316" strokeWidth={3} name={`Suhu (${suhuUnit})`} />
          <Line type="monotone" dataKey="kelembapan" stroke="#06b6d4" strokeWidth={3} name="RH (%)" />
        </LineChart>
      </ChartBox>

      <ChartBox title="Tekanan Udara" theme={theme}>
        <LineChart data={historyChartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
          <XAxis dataKey="time" stroke={theme.chartAxis} />
          <YAxis stroke={theme.chartAxis} />
          <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder }} />
          <Legend />
          <Line type="monotone" dataKey="tekananGrafik" stroke="#22c55e" strokeWidth={3} name={`Tekanan (${tekananUnit})`} />
        </LineChart>
      </ChartBox>

      <ChartBox title="Partikel Udara PM2.5 & PM10" theme={theme}>
        <LineChart data={historyChartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
          <XAxis dataKey="time" stroke={theme.chartAxis} />
          <YAxis stroke={theme.chartAxis} />
          <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder }} />
          <Legend />
          <Line type="monotone" dataKey="pm25" stroke="#eab308" strokeWidth={3} name="PM2.5 (µg/m³)" />
          <Line type="monotone" dataKey="pm10" stroke="#ef4444" strokeWidth={3} name="PM10 (µg/m³)" />
        </LineChart>
      </ChartBox>

      <ChartBox title="Gas CO" theme={theme}>
        <LineChart data={historyChartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
          <XAxis dataKey="time" stroke={theme.chartAxis} />
          <YAxis stroke={theme.chartAxis} />
          <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder }} />
          <Legend />
          <Line type="monotone" dataKey="co" stroke="#a855f7" strokeWidth={3} name="CO (ppm)" />
        </LineChart>
      </ChartBox>

      <ChartBox title="Aktual Polusi Sensor" theme={theme}>
        <LineChart data={historyChartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
          <XAxis dataKey="time" stroke={theme.chartAxis} />
          <YAxis stroke={theme.chartAxis} />
          <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder }} />
          <Legend />
          <Line type="monotone" dataKey="aktualPolusi" stroke="#22c55e" strokeWidth={3} name="Aktual Polusi Sensor" />
        </LineChart>
      </ChartBox>

      <ChartBox title="Prediksi Polusi AI ESP32-S3" theme={theme}>
        <LineChart data={historyChartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
          <XAxis dataKey="time" stroke={theme.chartAxis} />
          <YAxis stroke={theme.chartAxis} />
          <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder }} />
          <Legend />
          <Line
  type="linear"
  dataKey="prediksi"
  stroke="#14b8a6"
  strokeWidth={3}
  dot={{ r: 3 }}
  activeDot={{ r: 5 }}
  name="Prediksi Polusi AI ESP32-S3"
/>
        </LineChart>
      </ChartBox>

      <ChartBox title="Latensi Monitoring dan TinyML" theme={theme}>
        <LineChart data={historyChartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
          <XAxis dataKey="time" stroke={theme.chartAxis} />
          <YAxis stroke={theme.chartAxis} />
          <Tooltip contentStyle={{ backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder }} />
          <Legend />
          <Line type="monotone" dataKey="latencyLocalMs" stroke="#38bdf8" strokeWidth={3} name="Latensi Pengiriman (ms)" />
          <Line type="monotone" dataKey="inferenceTimeMs" stroke="#a78bfa" strokeWidth={3} name="Waktu TinyML (ms)" />
        </LineChart>
      </ChartBox>
    </>
  )
}

// Menampilkan halaman pengaturan dashboard, termasuk reset riwayat, tema, satuan, interval penyimpanan, notifikasi, dan pengaturan evaluasi AI.
function SettingsPage({
  settings,
  setSettings,
  setHistoryData,
  setNotificationHistory,
  setPredictionEvaluationHistory,
  theme
}) {
  const updateSetting = (key, value) => {
    if (key === 'interval') {
      setSettings(prev => ({
        ...prev,
        interval: value,
        maxHistory: hitungMaxHistoryOtomatis(value)
      }))

      return
    }

    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const resetSensorHistory = () => {
    if (window.confirm('Reset hanya riwayat data sensor?')) {
      setHistoryData([])
      alert('Riwayat data sensor berhasil direset.')
    }
  }

  const resetEvaluationOnly = () => {
    if (window.confirm('Reset hanya riwayat evaluasi prediksi AI?')) {
      setPredictionEvaluationHistory([])
      alert('Riwayat evaluasi prediksi berhasil direset.')
    }
  }

  const resetNotificationHistory = () => {
    if (window.confirm('Reset hanya riwayat notifikasi?')) {
      setNotificationHistory([])
      alert('Riwayat notifikasi berhasil direset.')
    }
  }

  const resetDefaultSettings = () => {
  if (window.confirm('Kembalikan pengaturan dashboard ke default?')) {
    const defaultInterval = Number(DEFAULT_SETTINGS.interval ?? 2)

    setSettings({
      ...DEFAULT_SETTINGS,
      interval: defaultInterval,
      maxHistory: hitungMaxHistoryOtomatis(defaultInterval),
      maxEvaluationHistory: Number(DEFAULT_SETTINGS.maxEvaluationHistory ?? 30)
    })

    alert('Pengaturan berhasil dikembalikan ke default.')
  }
}
  return (
    <>
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 mb-4">
        <div>
          <h2 className="text-3xl font-bold">Pengaturan</h2>
          <p className={`text-sm mt-1 ${theme.muted}`}>
            Atur data, sistem, evaluasi prediksi, dan metode akurasi.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center space-x-2 bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg transition-all text-white"
          >
            <ArrowPathIcon className="w-5 h-5" />
            <span>Refresh</span>
          </button>

          <button
            onClick={resetSensorHistory}
            className="flex items-center space-x-2 bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg transition-all text-white"
          >
            <XMarkIcon className="w-5 h-5" />
            <span>Reset Sensor</span>
          </button>

          <button
            onClick={resetEvaluationOnly}
            className="flex items-center space-x-2 bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg transition-all text-white"
          >
            <BoltIcon className="w-5 h-5" />
            <span>Reset Evaluasi</span>
          </button>

          <button
            onClick={resetNotificationHistory}
            className="flex items-center space-x-2 bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg transition-all text-white"
          >
            <BellAlertIcon className="w-5 h-5" />
            <span>Reset Notifikasi</span>
          </button>

          <button
  onClick={resetDefaultSettings}
  className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-all text-white"
>
  <Cog6ToothIcon className="w-5 h-5" />
  <span>Default</span>
</button>
        </div>
      </div>

      <div className={`${theme.panel} p-4 rounded-xl shadow-md mb-4`}>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <InfoCard title="Interval" value={`${settings.interval} menit`} theme={theme} />
          <InfoCard title="Riwayat" value={`${settings.maxHistory} titik`} theme={theme} />
          <InfoCard title="Evaluasi AI" value={settings.evaluationEnabled ? 'Aktif' : 'Nonaktif'} theme={theme} />
          <InfoCard title="Tabel Evaluasi" value={`${settings.maxEvaluationHistory} data`} theme={theme} />
          <InfoCard title="Auto Reset" value={settings.autoReset ? 'Aktif' : 'Nonaktif'} theme={theme} />
          <InfoCard title="Notifikasi" value={settings.notifications ? 'Aktif' : 'Nonaktif'} theme={theme} />
          <InfoCard title="Satuan" value={settings.units === 'metric' ? 'Metric' : 'Imperial'} theme={theme} />
        </div>
      </div>

      <div className={`${theme.panel} p-5 rounded-xl shadow-md`}>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          <div>
            <h3 className="text-lg font-semibold mb-4 text-cyan-400 flex items-center">
              <Cog6ToothIcon className="w-5 h-5 mr-2" />
              Pengaturan Data
            </h3>

            <div className="space-y-3">
              <SettingSwitch
                title="Auto Reset Harian"
                desc="Riwayat kosong saat berganti hari."
                active={settings.autoReset}
                onClick={() => updateSetting('autoReset', !settings.autoReset)}
                theme={theme}
              />

              <SettingSelect
                label="Interval Penyimpanan"
                desc="Riwayat sensor dan target evaluasi."
                value={settings.interval}
                options={[
                  { value: 1, label: '1 menit' },
                  { value: 2, label: '2 menit' },
                  { value: 5, label: '5 menit' },
                  { value: 10, label: '10 menit' },
                  { value: 15, label: '15 menit' },
                  { value: 30, label: '30 menit' }
                ]}
                onChange={value => updateSetting('interval', value)}
                theme={theme}
              />

              <div className={`${theme.cardSoft} p-3 rounded-lg flex items-center justify-between gap-3`}>
                <div>
                  <p className="text-sm font-semibold">Panjang Riwayat</p>
                  <p className={`text-xs mt-1 ${theme.muted}`}>
                    Otomatis mengikuti interval.
                  </p>
                </div>

                <div className={`${theme.input} border rounded-lg px-4 py-2 text-right min-w-\[120px]`}>
                  <p className="font-semibold text-cyan-400">
                    {settings.maxHistory} titik
                  </p>
                  <p className={`text-xs ${theme.muted}`}>
                    ± {formatDurasiRiwayat(settings.maxHistory, settings.interval)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4 text-cyan-400 flex items-center">
              <CloudIcon className="w-5 h-5 mr-2" />
              Pengaturan Sistem
            </h3>

            <div className="space-y-3">
              <SettingSwitch
                title="Notifikasi Polusi"
                desc="Aktif saat Tidak Sehat ke atas."
                active={settings.notifications}
                onClick={() => updateSetting('notifications', !settings.notifications)}
                theme={theme}
              />

              <SettingSwitch
                title={settings.theme === 'dark' ? 'Tema Gelap' : 'Tema Terang'}
                desc="Mengubah tampilan dashboard."
                active={settings.theme === 'dark'}
                onClick={() => updateSetting('theme', settings.theme === 'dark' ? 'light' : 'dark')}
                theme={theme}
              />

              <SettingSelect
                label="Satuan"
                desc="Metric °C/hPa atau Imperial °F/inHg."
                value={settings.units}
                options={[
                  { value: 'metric', label: 'Metric / Metrik (°C, hPa)' },
                  { value: 'imperial', label: 'Imperial (°F, inHg)' }
                ]}
                onChange={value => updateSetting('units', value)}
                theme={theme}
              />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4 text-cyan-400 flex items-center">
              <BoltIcon className="w-5 h-5 mr-2" />
              Riwayat Evaluasi
            </h3>

            <div className="space-y-3">
              <SettingSelect
  label="Data Uji Evaluasi"
  desc="Sistem akan berhenti membuat data evaluasi baru jika jumlah data sudah mencapai batas yang dipilih."
  value={settings.maxEvaluationHistory}
  options={[
    { value: 30, label: '30 data' },
    { value: 50, label: '50 data' },
    { value: 100, label: '100 data' }
  ]}
  onChange={value => updateSetting('maxEvaluationHistory', value)}
  theme={theme}
/>
<SettingSwitch
  title="Auto Stop Evaluasi"
  desc={`Akan Berhenti   setelah mencapai ${settings.maxEvaluationHistory} data.`}
  active={settings.autoStopEvaluationAfterLimit}
  onClick={() =>
    updateSetting(
      'autoStopEvaluationAfterLimit',
      !settings.autoStopEvaluationAfterLimit
    )
  }
  theme={theme}
/>

              <SettingSwitch
                title="Status Evaluasi"
                desc="Pembuatan target evaluasi baru."
                active={settings.evaluationEnabled}
                onClick={() => updateSetting('evaluationEnabled', !settings.evaluationEnabled)}
                theme={theme}
              />
            </div>
          </div>
        </div>

        <AccuracyMethodInfo theme={theme} />
      </div>
    </>
  )
}

// Menampilkan informasi metode akurasi yang digunakan, yaitu MAE, MAPE, NMAE, dan Akurasi = 100% - NMAE.
function AccuracyMethodInfo({ theme }) {
  return (
    <div className={`mt-4 ${theme.cardSoft} p-4 rounded-xl`}>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-stretch">
        <div className="md:col-span-2 flex flex-col justify-center">
          <h3 className="text-lg font-semibold text-cyan-400 flex items-center mb-2">
            <ChartBarIcon className="w-5 h-5 mr-2" />
            Metode Akurasi
          </h3>

          <p className={`text-xs leading-relaxed ${theme.muted}`}>
            Prediksi AI dari ESP32-S3 dibandingkan dengan nilai aktual sensor setelah +2 jam.
            Sistem menghitung MAE, MAPE, NMAE, dan akurasi utama menggunakan NMAE.
          </p>
        </div>

        <div className={`${theme.input} border rounded-lg px-3 py-3 text-center flex items-center justify-center`}>
          <p className="text-xs font-bold text-cyan-400">
            MAE = rata-rata |Aktual - Prediksi|
          </p>
        </div>

        <div className={`${theme.input} border rounded-lg px-3 py-3 text-center flex flex-col items-center justify-center`}>
          <p className="text-xs font-bold text-cyan-400">
            MAPE = Error / Aktual × 100%
          </p>

          <p className={`text-\[10px] mt-1 ${theme.muted}`}>
            Metrik tambahan
          </p>
        </div>

        <div className={`${theme.input} border rounded-lg px-3 py-3 text-center flex items-center justify-center`}>
          <p className="text-xs font-bold text-cyan-400">
            NMAE = MAE / {POLLUTION_RANGE} × 100%
          </p>
        </div>

        <div className="md:col-span-5">
          <div className={`${theme.input} border rounded-lg px-4 py-3 text-center`}>
            <p className="text-sm font-bold text-green-400">
              Akurasi Utama = 100% - NMAE
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Menampilkan tabel dan grafik evaluasi prediksi AI. Prediksi dibandingkan dengan nilai aktual sensor saat target +2 jam tercapai.
function PredictionEvaluationSection({
  history,
  stats,
  accuracyChartData,
  evaluationEnabled,
  maxEvaluationHistory,
  setSettings,
  theme
}) {
  const toggleEvaluation = () => {
    setSettings(prev => ({
      ...prev,
      evaluationEnabled: !prev.evaluationEnabled
    }))
  }

  return (
    <div className={`${theme.panel} p-6 rounded-xl shadow-md`}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-semibold text-cyan-400 flex items-center gap-2">
            <BoltIcon className="w-6 h-6" />
            Evaluasi Prediksi AI ESP32-S3 +2 Jam
          </h3>

          <p className={`text-sm mt-1 ${theme.muted}`}>
            Sistem menyimpan prediksi dari ESP32-S3, lalu membandingkan nilai prediksi dengan nilai aktual sensor saat waktu target +2 jam tercapai.
          </p>

          <p className={`text-xs mt-2 ${theme.muted}`}>
            Status evaluasi: {evaluationEnabled ? 'Aktif' : 'Nonaktif'} •
            Tabel menampilkan {maxEvaluationHistory} data terakhir
          </p>
        </div>

        <div className={`${theme.cardSoft} px-4 py-3 rounded-xl flex items-center gap-4`}>
          <div className="text-right">
            <p className="text-sm font-semibold">
              Evaluasi Prediksi AI
            </p>

            <p className={`text-xs ${theme.muted}`}>
              {evaluationEnabled ? 'Aktif membuat data evaluasi baru' : 'Nonaktif membuat data evaluasi baru'}
            </p>
          </div>

          <button
            type="button"
            onClick={toggleEvaluation}
            className={`w-14 h-7 rounded-full transition-all duration-300 relative flex-shrink-0 ${
              evaluationEnabled ? 'bg-cyan-500' : 'bg-slate-500'
            }`}
          >
            <span
              className={`w-6 h-6 bg-white rounded-full absolute top-0.5 transition-all duration-300 shadow-md ${
                evaluationEnabled ? 'left-7' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
        <InfoCard title="Akurasi" value={`${stats.accuracy}%`} theme={theme} />
        <InfoCard title="MAE" value={stats.mae} theme={theme} />
        <InfoCard title="NMAE" value={`${stats.nmae}%`} theme={theme} />
        <InfoCard title="MAPE" value={`${stats.mape}%`} theme={theme} />
        <InfoCard title="Total Dinilai" value={stats.evaluated} theme={theme} />
        <InfoCard title="Menunggu" value={stats.pending} theme={theme} />
      </div>

      <div className={`${theme.panelSoft} p-4 rounded-lg mb-6`}>
        <p className={`text-sm ${theme.muted}`}>
          Evaluasi prediksi dilakukan dengan membandingkan nilai prediksi AI dari ESP32-S3 terhadap nilai aktual sensor pada waktu target +2 jam.
          Nilai <span className="font-semibold text-cyan-400"> MAE </span>
          menunjukkan rata-rata selisih prediksi dan aktual.
          Nilai <span className="font-semibold text-cyan-400"> NMAE </span>
          menunjukkan error yang dinormalisasi berdasarkan rentang target polusi.
          Nilai <span className="font-semibold text-cyan-400"> MAPE </span>
          ditampilkan sebagai metrik tambahan.
          Akurasi dihitung menggunakan rumus
          <span className="font-semibold text-green-400"> 100% - NMAE</span>.
        </p>
      </div>

      <div className={`${theme.panelSoft} p-5 rounded-xl mb-6`}>
        <h4 className="text-lg font-semibold text-cyan-400 mb-3">
          Grafik Akurasi Prediksi AI
        </h4>

        {accuracyChartData.length === 0 ? (
          <div className={`p-5 rounded-lg text-center ${theme.muted}`}>
            Grafik akurasi akan muncul setelah ada prediksi yang selesai dievaluasi.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={accuracyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.chartGrid} />
              <XAxis dataKey="time" stroke={theme.chartAxis} />
              <YAxis stroke={theme.chartAxis} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme.tooltipBg,
                  borderColor: theme.tooltipBorder
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="accuracy"
                stroke="#22d3ee"
                strokeWidth={3}
                name="Akurasi (%)"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {history.length === 0 ? (
        <div className={`${theme.panelSoft} p-5 rounded-lg text-center ${theme.muted}`}>
          Belum ada data evaluasi prediksi. Data akan muncul setelah sistem menyimpan riwayat pertama.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className={`border-b ${theme.sidebarBorder}`}>
                <th className="text-left p-3">Dibuat</th>
                <th className="text-left p-3">Target +2 Jam</th>
                <th className="text-left p-3">Prediksi ESP</th>
                <th className="text-left p-3">Aktual Sensor</th>
                <th className="text-left p-3">Selisih</th>
                <th className="text-left p-3">MAPE (%)</th>
                <th className="text-left p-3">NMAE (%)</th>
                <th className="text-left p-3">Akurasi NMAE (%)</th>
                <th className="text-left p-3">Kategori Prediksi</th>
                <th className="text-left p-3">Kategori Aktual</th>
              </tr>
            </thead>

            <tbody>
              {[...history].slice(-maxEvaluationHistory).reverse().map(item => {
                const metrics =
                  item.actualValue === null || item.actualValue === undefined
                    ? null
                    : calculateEvaluationMetrics(item.prediksi2Jam, item.actualValue)

                return (
                  <tr
                    key={item.id}
                    className={`border-b ${theme.sidebarBorder} hover:opacity-90`}
                  >
                    <td className="p-3">
                      <p className="font-semibold">{item.createdTime}</p>
                      <p className={`text-xs ${theme.muted}`}>{item.createdDate}</p>
                    </td>

                    <td className="p-3">
                      <p className="font-semibold">{item.targetTime}</p>
                      <p className={`text-xs ${theme.muted}`}>{item.targetDate}</p>
                    </td>

                    <td className="p-3">
                      <p className="font-bold">{item.prediksi2Jam}</p>
                    </td>

                    <td className="p-3">
                      {item.actualValue === null || item.actualValue === undefined ? (
                        <span className={theme.muted}>-</span>
                      ) : (
                        <p className="font-bold">{item.actualValue}</p>
                      )}
                    </td>

                    <td className="p-3">
                      {metrics ? (
                        <span>{metrics.difference}</span>
                      ) : (
                        <span className={theme.muted}>-</span>
                      )}
                    </td>

                    <td className="p-3">
                      {metrics ? (
                        <span>{metrics.mapePercentage}%</span>
                      ) : (
                        <span className={theme.muted}>-</span>
                      )}
                    </td>

                    <td className="p-3">
                      {metrics ? (
                        <span>{metrics.nmaePercentage}%</span>
                      ) : (
                        <span className={theme.muted}>-</span>
                      )}
                    </td>

                    <td className="p-3">
                      {metrics ? (
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${getAccuracyStyle(metrics.accuracyPercentage)}`}>
                          {metrics.accuracyPercentage}%
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400">
                          Menunggu
                        </span>
                      )}
                    </td>

                    <td className="p-3">
                      {item.predictedStatus}
                    </td>

                    <td className="p-3">
                      {item.actualStatus || <span className={theme.muted}>-</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Menampilkan daftar riwayat notifikasi ketika prediksi AI masuk kategori Tidak Sehat ke atas.
function NotificationHistorySection({ notificationHistory, theme }) {
  return (
    <div className={`${theme.panel} p-6 rounded-xl shadow-md`}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
        <div>
          <h3 className="text-xl font-semibold text-cyan-400 flex items-center gap-2">
            <BellAlertIcon className={`w-6 h-6 ${
              notificationHistory.length > 0 ? 'text-red-400' : 'text-cyan-400'
            }`} />

            Riwayat Notifikasi Polusi Tinggi

            {notificationHistory.length > 0 && (
              <span className="ml-2 min-w-6 h-6 px-2 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
                {notificationHistory.length > 99 ? '99+' : notificationHistory.length}
              </span>
            )}
          </h3>

          <p className={`text-sm mt-1 ${theme.muted}`}>
            Riwayat peringatan saat prediksi AI masuk kategori Tidak Sehat ke atas.
          </p>
        </div>
      </div>

      {notificationHistory.length === 0 ? (
        <div className={`${theme.panelSoft} p-5 rounded-lg text-center ${theme.muted}`}>
          Belum ada notifikasi polusi tinggi.
        </div>
      ) : (
        <div className="space-y-4">
          {notificationHistory.map(item => (
            <div
              key={item.id}
              className={`p-4 rounded-xl shadow-md bg-gradient-to-r ${getGradientColor(item.prediksi)}`}
            >
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold opacity-80">
                    {item.date} • {item.time}
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    Prediksi AI {item.prediksi}
                  </p>

                  <p className="text-sm mt-1">
                    Status: <span className="font-semibold">{item.status}</span>
                  </p>

                  <p className="text-sm mt-2">
                    {item.message}
                  </p>
                </div>

                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-black/20">
                  Notifikasi
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Menampilkan legenda kategori ISPU pada sidebar.
function SidebarISPU({ theme }) {
  return (
    <div className={`mt-8 pt-5 border-t ${theme.sidebarBorder}`}>
      <h3 className="text-sm font-bold text-cyan-400 mb-4">
        Kategori ISPU
      </h3>

      <div className="space-y-3">
        <SidebarISPUItem color="bg-green-500" title="Baik" range="1–50" desc="Udara sangat baik" theme={theme} />
        <SidebarISPUItem color="bg-blue-500" title="Sedang" range="51–100" desc="Masih aman" theme={theme} />
        <SidebarISPUItem color="bg-yellow-400" title="Tidak Sehat" range="101–200" desc="Berisiko" theme={theme} />
        <SidebarISPUItem color="bg-red-500" title="Sangat Tidak Sehat" range="201–300" desc="Berbahaya" theme={theme} />
        <SidebarISPUItem color="bg-black border border-white" title="Berbahaya" range=">300" desc="Sangat berbahaya" theme={theme} />
      </div>
    </div>
  )
}

// Komponen kecil untuk menampilkan satu item kategori ISPU beserta warna, rentang, dan deskripsinya.
function SidebarISPUItem({ color, title, range, desc, theme }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-3.5 h-3.5 mt-1 rounded ${color}`}></div>

      <div>
        <p className="text-sm font-semibold leading-tight">
          {title}
        </p>

        <p className={`text-xs ${theme.muted}`}>
          {range} • {desc}
        </p>
      </div>
    </div>
  )
}

// Komponen dropdown pilihan pengaturan, misalnya interval penyimpanan, satuan, atau jumlah data evaluasi.
function SettingSelect({ label, desc, value, options, onChange, theme }) {
  return (
    <div className={`p-4 ${theme.cardSoft} rounded-lg`}>
      <label className="block text-sm font-semibold mb-1">
        {label}
      </label>

      {desc && (
        <p className={`text-xs mb-3 ${theme.muted}`}>
          {desc}
        </p>
      )}

      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || e.target.value)}
        className={`w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all ${theme.input}`}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// Komponen tombol aktif/nonaktif untuk pengaturan seperti notifikasi, tema, auto reset, dan evaluasi.
function SettingSwitch({ title, desc, active, onClick, theme }) {
  return (
    <div className={`${theme.cardSoft} p-3 rounded-lg flex items-center justify-between gap-3`}>
      <div>
        <p className="text-sm font-semibold">
          {title}
        </p>

        <p className={`text-xs mt-1 ${theme.muted}`}>
          {desc}
        </p>
      </div>

      <button
        type="button"
        onClick={onClick}
        className={`w-12 h-6 rounded-full transition-all duration-300 relative flex-shrink-0 ${
          active ? 'bg-cyan-500' : 'bg-slate-500'
        }`}
      >
        <span
          className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all duration-300 shadow-md ${
            active ? 'left-6' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}

// Komponen kartu informasi ringkas untuk menampilkan nilai statistik atau pengaturan.
function InfoCard({ title, value, theme }) {
  return (
    <div className={`${theme.cardSoft} p-4 rounded-lg text-center`}>
      <p className={`text-xs uppercase tracking-wide ${theme.muted}`}>
        {title}
      </p>

      <p className="text-lg font-bold text-cyan-400">
        {value}
      </p>
    </div>
  )
}

// Komponen tombol tab untuk berpindah antara riwayat data, evaluasi, dan notifikasi.
function TabButton({ active, onClick, theme, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
        active
          ? 'bg-cyan-600 text-white'
          : `${theme.panel} ${theme.muted} hover:opacity-80`
      }`}
    >
      {children}
    </button>
  )
}

// Komponen item menu sidebar untuk berpindah halaman dashboard.
function MenuItem({ title, icon, active, onClick, theme, badge = 0 }) {
  const hasBadge = Number(badge) > 0

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between p-3 rounded cursor-pointer transition duration-200 ease-in-out ${
        active ? theme.menuActive : theme.menuInactive
      }`}
    >
      <div className="flex items-center space-x-3">
        {icon}
        <span>{title}</span>
      </div>

      {hasBadge && (
        <div className="flex items-center gap-1">
          <BellAlertIcon className="w-4 h-4 text-red-400" />

          <span className="min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
            {badge > 99 ? '99+' : badge}
          </span>
        </div>
      )}
    </div>
  )
}

// Komponen kartu prediksi per 2 jam yang menampilkan waktu, nilai prediksi, dan status kualitas udara.
function PrediksiJamCard({ waktu, jamKeDepan, value }) {
  return (
    <div className={`p-4 rounded-xl shadow-md bg-gradient-to-r ${getGradientColor(value)}`}>
      <p className="text-sm font-semibold opacity-80">
        Jam {waktu}
      </p>

      <p className="text-xs opacity-75 mt-1">
        +{jamKeDepan} jam dari sekarang
      </p>

      <p className="text-3xl font-bold mt-2">
        {value}
      </p>

      <p className="text-sm mt-1">
        Status: <span className="font-semibold">{getStatus(value)}</span>
      </p>
    </div>
  )
}

// Wrapper grafik Recharts agar tampilan grafik konsisten di semua bagian riwayat.
function ChartBox({ title, children, theme }) {
  return (
    <div className={`${theme.panel} p-6 rounded-xl mb-6 shadow-md`}>
      <h3 className="mb-4 text-lg font-semibold text-cyan-400">
        {title}
      </h3>

      <ResponsiveContainer width="100%" height={300}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

// Komponen kartu kecil untuk menampilkan nilai sensor utama seperti suhu, RH, tekanan, PM2.5, PM10, dan CO.
function MiniCard({ title, value, unit, theme }) {
  return (
    <div className={`${theme.card} p-4 rounded-xl text-center shadow-md hover:shadow-xl transition-transform transform hover:scale-105`}>
      <p className={`text-xs ${theme.muted}`}>
        {title}
      </p>

      <p className="text-lg md:text-xl font-bold mt-1">
        {value} {unit}
      </p>
    </div>
  )
}

// Mengelompokkan kartu monitoring berdasarkan jenis sensor, misalnya BME280, PMS5003, dan sensor CO.
function MonitoringGroup({ title, subtitle, desc, children, theme }) {
  return (
    <div className={`${theme.panel} p-6 rounded-xl mb-6 shadow-md`}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-5">
        <div>
          <h3 className="text-xl font-semibold text-cyan-400">
            {title}
          </h3>

          <p className={`text-sm mt-1 ${theme.muted}`}>
            {desc}
          </p>
        </div>

        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-400">
          {subtitle}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {children}
      </div>
    </div>
  )
}

// Menampilkan satu parameter sensor lengkap dengan nilai, satuan, kondisi, deskripsi, dan progress bar.
function MonitoringMetricCard({ title, sensor, value, unit, condition, progress, theme }) {
  const style = getConditionStyle(condition.status)

  return (
    <div className={`${theme.cardSoft} p-5 rounded-xl shadow-md`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className={`text-xs ${theme.muted}`}>
            {sensor}
          </p>

          <h4 className="text-lg font-semibold mt-1">
            {title}
          </h4>
        </div>

        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${style.badge}`}>
          {condition.status}
        </span>
      </div>

      <p className="text-4xl font-bold">
        {value}
        <span className="text-base ml-1 font-semibold opacity-80">
          {unit}
        </span>
      </p>

      <p className={`text-sm mt-3 ${theme.muted}`}>
        {condition.desc}
      </p>

      <div className="mt-4">
        <div className={`w-full h-2 rounded-full overflow-hidden ${theme.card}`}>
          <div
            className={`h-full rounded-full ${style.bar}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className={`flex justify-between text-xs mt-2 ${theme.muted}`}>
          <span>Rendah</span>
          <span>Tinggi</span>
        </div>
      </div>
    </div>
  )
}

// Mencoba mengambil data sensor dari beberapa endpoint backend. Jika endpoint pertama gagal, endpoint berikutnya dicoba sampai berhasil.
async function fetchSensorBackend() {
  let lastError = null

  for (const endpoint of BACKEND_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status} dari ${endpoint}`)
      }

      return await response.json()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Backend tidak dapat diakses.')
}

// Membaca data array dari localStorage. Jika data tidak ada atau rusak, fungsi mengembalikan array kosong.
function loadArrayFromLocalStorage(key) {
  try {
    const saved = localStorage.getItem(key)
    const parsed = saved ? JSON.parse(saved) : []

    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Menentukan batas penyimpanan evaluasi. Minimal penyimpanan dibuat 200 data agar data evaluasi tidak cepat terhapus.
function getEvaluationStorageLimit(displayLimit) {
  const limit = Number(displayLimit) || 30
  return Math.max(MIN_EVALUATION_STORAGE, limit)
}

// Menghitung jumlah maksimal titik riwayat berdasarkan interval menit. Rumus: 1440 menit per hari dibagi interval penyimpanan.
function hitungMaxHistoryOtomatis(intervalMenit) {
  const interval = Number(intervalMenit) || 2
  const menitPerHari = 24 * 60

  return Math.round(menitPerHari / interval)
}

// Mengubah jumlah titik data dan interval menjadi estimasi durasi riwayat, misalnya menit, jam, atau hari.
function formatDurasiRiwayat(titikData, intervalMenit) {
  const totalMenit = Number(titikData) * Number(intervalMenit)
  const totalJam = totalMenit / 60

  if (totalJam < 1) {
    return `${totalMenit} menit`
  }

  if (totalJam < 24) {
    return `${Number(totalJam.toFixed(1))} jam`
  }

  const totalHari = totalJam / 24

  if (totalHari === 1) {
    return '1 hari'
  }

  return `${Number(totalHari.toFixed(1))} hari`
}

// Memutar suara beep notifikasi saat prediksi AI menunjukkan polusi tinggi.
function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext

    if (!AudioContext) return

    const audioCtx = new AudioContext()

    const playBeep = (startTime, frequency) => {
      const oscillator = audioCtx.createOscillator()
      const gainNode = audioCtx.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime + startTime)

      gainNode.gain.setValueAtTime(0, audioCtx.currentTime + startTime)
      gainNode.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + startTime + 0.02)
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + startTime + 0.35)

      oscillator.connect(gainNode)
      gainNode.connect(audioCtx.destination)

      oscillator.start(audioCtx.currentTime + startTime)
      oscillator.stop(audioCtx.currentTime + startTime + 0.35)
    }

    playBeep(0, 880)
    playBeep(0.45, 660)
  } catch (error) {
    console.log('Suara notifikasi tidak dapat diputar:', error)
  }
}

// Menghitung fallback nilai aktual polusi dari PM2.5, PM10, dan CO jika backend tidak mengirim aktualPolusi.
function hitungNilaiAktualPolusi(data) {
  // Mengambil nilai sensor dan memastikan formatnya angka.
  const pm25 = Number(data.pm25 ?? 0)
  const pm10 = Number(data.pm10 ?? 0)
  const co = Number(data.co ?? 0)

  // Rumus fallback aktual polusi:
  // aktualPolusi = PM2.5 × 1.2 + PM10 × 0.08 + CO × 2.5
  // PM2.5 diberi bobot lebih besar karena partikel halus lebih sensitif
  // terhadap perubahan kualitas udara. PM10 tetap dihitung dengan bobot kecil,
  // sedangkan CO diperkuat agar kontribusi gas tetap terlihat.
  const hasil =
    pm25 * 1.2 +
    pm10 * 0.08 +
    co * 2.5

  // Hasil dibulatkan dan dibatasi pada rentang 1 sampai 500.
  return Math.round(Math.min(500, Math.max(1, hasil)))
}

// Membuat daftar prediksi setiap 2 jam sampai 24 jam. Nilai +2 jam memakai prediksi ESP32, sedangkan jam berikutnya berupa estimasi tampilan.
function generatePrediksiPer2Jam(nilaiSaatIni, timestamp) {
  const nilaiDasar = Number(nilaiSaatIni) || 1
  const waktuAcuan = timestamp ? new Date(timestamp) : new Date()

  return Array.from({ length: 12 }, (_, index) => {
    const jamKeDepan = (index + 1) * 2

    const waktuPrediksi = new Date(
      waktuAcuan.getTime() + jamKeDepan * 60 * 60 * 1000
    )

    const waktu = waktuPrediksi.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    })

    if (jamKeDepan === 2) {
      return {
        jamKeDepan,
        waktu,
        prediksi: Math.min(500, Math.max(1, Math.round(nilaiDasar)))
      }
    }

    const polaPerubahan = Math.sin(jamKeDepan * 0.7) * 5
    const trenWaktu = jamKeDepan * 0.25
    const hasilPrediksi = Math.round(nilaiDasar + polaPerubahan + trenWaktu)

    return {
      jamKeDepan,
      waktu,
      prediksi: Math.min(500, Math.max(1, hasilPrediksi))
    }
  })
}

// Membuat record evaluasi prediksi. Record ini menunggu selama 2 jam sebelum dibandingkan dengan nilai aktual sensor.
function createPredictionEvaluationRecord(latestData, timestamp) {
  const now = new Date(timestamp)
  const targetTimestamp = timestamp + 2 * 60 * 60 * 1000
  const targetDate = new Date(targetTimestamp)

  const prediksi2Jam = Number(latestData.prediksi ?? 0)

  return {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    createdTimestamp: timestamp,
    createdDate: now.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }),
    createdTime: now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    targetTimestamp,
    targetDate: targetDate.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }),
    targetTime: targetDate.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    prediksiSaatIni: latestData.aktualPolusi,
    prediksi2Jam,
    predictedStatus: getStatus(prediksi2Jam),
    actualValue: null,
    actualStatus: null,
    difference: null,
    errorPercentage: null,
    mapePercentage: null,
    nmaePercentage: null,
    accuracyPercentage: null,
    status: 'Menunggu',
    isCorrect: null,
    evaluatedAt: null,
    evaluatedDate: null,
    evaluatedTime: null
  }
}

// Menghitung selisih, MAPE, NMAE, dan akurasi. Rumus utama: akurasi = 100% - NMAE.
function calculateEvaluationMetrics(predictedValue, actualValue) {
  const predicted = Number(predictedValue) || 0
  const actual = Number(actualValue) || 0

  // Selisih absolut antara nilai prediksi dan nilai aktual.
  // Rumus: difference = |prediksi - aktual|
  const difference = Math.abs(predicted - actual)

  // MAPE menghitung persentase error terhadap nilai aktual.
  // Rumus: MAPE = (difference / aktual) × 100%
  // Jika aktual = 0, pembagi dibuat 1 agar tidak terjadi pembagian nol.
  const mapeDenominator = Math.abs(actual) > 0 ? Math.abs(actual) : 1
  const mapePercentage = (difference / mapeDenominator) * 100

  // NMAE menghitung error yang dinormalisasi terhadap rentang nilai polusi.
  // Rumus: NMAE = (difference / POLLUTION_RANGE) × 100%
  const range = Number(POLLUTION_RANGE) > 0 ? Number(POLLUTION_RANGE) : 1
  const nmaePercentage = (difference / range) * 100

  // Akurasi utama dihitung dari NMAE.
  // Rumus: Akurasi = 100% - NMAE
  // Math.max digunakan agar nilai akurasi tidak negatif.
  const accuracyPercentage = Math.max(0, 100 - nmaePercentage)

  return {
    difference: Number(difference.toFixed(2)),
    mapePercentage: Number(mapePercentage.toFixed(2)),
    nmaePercentage: Number(nmaePercentage.toFixed(2)),
    accuracyPercentage: Number(accuracyPercentage.toFixed(2)),
    errorPercentage: Number(mapePercentage.toFixed(2))
  }
}

// Memperbarui record evaluasi yang sudah mencapai target +2 jam dengan nilai aktual sensor dan metrik error.
function updatePredictionEvaluations(records, actualData, nowTimestamp) {
  if (!Array.isArray(records)) return []

  const actualValue = Number(
    actualData?.aktualPolusi ??
    hitungNilaiAktualPolusi(actualData ?? {})
  )

  if (!Number.isFinite(actualValue)) return records

  return records.map(item => {
    if (item.status !== 'Menunggu') {
      if (
        item.actualValue !== null &&
        item.actualValue !== undefined &&
        (
          item.errorPercentage === undefined ||
          item.accuracyPercentage === undefined ||
          item.status === 'Benar' ||
          item.status === 'Salah'
        )
      ) {
        const metrics = calculateEvaluationMetrics(
          item.prediksi2Jam,
          item.actualValue
        )

        return {
          ...item,
          ...metrics,
          status: 'Selesai',
          isCorrect: null
        }
      }

      return item
    }

    if (Number(item.targetTimestamp) > nowTimestamp) return item

    const predictedValue = Number(item.prediksi2Jam ?? 0)
    const predictedStatus = item.predictedStatus || getStatus(predictedValue)
    const actualStatus = getStatus(actualValue)

    const metrics = calculateEvaluationMetrics(predictedValue, actualValue)

    const evaluatedDate = new Date(nowTimestamp)

    return {
      ...item,
      actualValue,
      actualStatus,
      predictedStatus,
      ...metrics,
      status: 'Selesai',
      isCorrect: null,
      evaluatedAt: nowTimestamp,
      evaluatedDate: evaluatedDate.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      }),
      evaluatedTime: evaluatedDate.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  })
}

// Menghitung statistik rata-rata evaluasi, seperti MAE, MAPE, NMAE, akurasi, jumlah data selesai, dan data menunggu.
function getEvaluationStats(records) {
  const list = Array.isArray(records) ? records : []

  const evaluatedItems = list.filter(item =>
    item.status !== 'Menunggu' &&
    item.actualValue !== null &&
    item.actualValue !== undefined
  )

  const pending = list.filter(item => item.status === 'Menunggu').length
  const evaluated = evaluatedItems.length

  if (evaluated === 0) {
    return {
      total: list.length,
      evaluated: 0,
      pending,
      mae: 0,
      mape: 0,
      nmae: 0,
      accuracy: 0
    }
  }

  const metricsList = evaluatedItems.map(item =>
    calculateEvaluationMetrics(item.prediksi2Jam, item.actualValue)
  )

  const totalDifference = metricsList.reduce((sum, item) => {
    return sum + item.difference
  }, 0)

  const totalMape = metricsList.reduce((sum, item) => {
    return sum + item.mapePercentage
  }, 0)

  const mae = Number((totalDifference / evaluated).toFixed(2))
  const mape = Number((totalMape / evaluated).toFixed(2))

  const range = Number(POLLUTION_RANGE) > 0 ? Number(POLLUTION_RANGE) : 1
  const nmae = Number(((mae / range) * 100).toFixed(2))
  const accuracy = Number(Math.max(0, 100 - nmae).toFixed(2))

  return {
    total: list.length,
    evaluated,
    pending,
    mae,
    mape,
    nmae,
    accuracy
  }
}

// Membangun data grafik akurasi kumulatif berdasarkan evaluasi yang sudah selesai.
function buildAccuracyChartData(records) {
  const evaluatedRecords = Array.isArray(records)
    ? records
        .filter(item =>
          item.status !== 'Menunggu' &&
          item.actualValue !== null &&
          item.actualValue !== undefined
        )
        .sort((a, b) => Number(a.evaluatedAt || 0) - Number(b.evaluatedAt || 0))
    : []

  let totalDifference = 0
  let totalMape = 0
  let total = 0

  return evaluatedRecords.map(item => {
    const metrics = calculateEvaluationMetrics(
      item.prediksi2Jam,
      item.actualValue
    )

    total += 1
    totalDifference += metrics.difference
    totalMape += metrics.mapePercentage

    const mae = Number((totalDifference / total).toFixed(2))
    const mape = Number((totalMape / total).toFixed(2))

    const range = Number(POLLUTION_RANGE) > 0 ? Number(POLLUTION_RANGE) : 1
    const nmae = Number(((mae / range) * 100).toFixed(2))
    const accuracy = Number(Math.max(0, 100 - nmae).toFixed(2))

    return {
      time: item.evaluatedTime || item.targetTime || '-',
      accuracy,
      nmae,
      mape,
      mae,
      total
    }
  })
}

// Menentukan warna tampilan akurasi berdasarkan nilai persentase akurasi.
function getAccuracyStyle(value) {
  const accuracy = Number(value) || 0

  if (accuracy >= 85) {
    return 'bg-green-500/20 text-green-400'
  }

  if (accuracy >= 70) {
    return 'bg-yellow-500/20 text-yellow-400'
  }

  return 'bg-red-500/20 text-red-400'
}

// Mengubah suhu dari Celcius ke Fahrenheit jika satuan imperial dipilih.
function formatTemperature(value, units) {
  if (units === 'imperial') {
    return {
      value: Number(((value * 9) / 5 + 32).toFixed(1)),
      unit: '°F'
    }
  }

  return {
    value,
    unit: '°C'
  }
}

// Mengubah tekanan dari hPa ke inHg jika satuan imperial dipilih.
function formatPressure(value, units) {
  if (units === 'imperial') {
    return {
      value: Number((value * 0.02953).toFixed(2)),
      unit: 'inHg'
    }
  }

  return {
    value,
    unit: 'hPa'
  }
}

// Mengubah nilai sensor menjadi persentase progress bar berdasarkan nilai maksimum.
function getProgressValue(value, max) {
  const result = (Number(value) / max) * 100
  return Math.min(100, Math.max(0, result))
}

// Mengubah tekanan udara menjadi persentase progress bar dengan acuan rentang 950 sampai 1050 hPa.
function getPressureProgress(value) {
  const result = ((Number(value) - 950) / 100) * 100
  return Math.min(100, Math.max(0, result))
}

// Menentukan kondisi suhu, seperti rendah, normal, hangat, atau tinggi.
function getTemperatureCondition(value) {
  if (value < 18) {
    return {
      status: 'Rendah',
      desc: 'Suhu cukup rendah dari kondisi ideal.'
    }
  }

  if (value <= 30) {
    return {
      status: 'Normal',
      desc: 'Suhu berada dalam kondisi nyaman.'
    }
  }

  if (value <= 35) {
    return {
      status: 'Hangat',
      desc: 'Suhu mulai meningkat, kondisi masih perlu dipantau.'
    }
  }

  return {
    status: 'Tinggi',
    desc: 'Suhu cukup tinggi, lingkungan terasa panas.'
  }
}

// Menentukan kondisi kelembapan, seperti rendah, normal, tinggi, atau sangat tinggi.
function getHumidityCondition(value) {
  if (value < 40) {
    return {
      status: 'Rendah',
      desc: 'Kelembapan udara cukup rendah.'
    }
  }

  if (value <= 70) {
    return {
      status: 'Normal',
      desc: 'Kelembapan berada pada rentang ideal.'
    }
  }

  if (value <= 85) {
    return {
      status: 'Tinggi',
      desc: 'Kelembapan udara mulai tinggi.'
    }
  }

  return {
    status: 'Sangat Tinggi',
    desc: 'Kelembapan sangat tinggi dan perlu diperhatikan.'
  }
}

// Menentukan kondisi tekanan udara, seperti rendah, normal, atau tinggi.
function getPressureCondition(value) {
  if (value < 1000) {
    return {
      status: 'Rendah',
      desc: 'Tekanan udara berada di bawah kondisi normal.'
    }
  }

  if (value <= 1020) {
    return {
      status: 'Normal',
      desc: 'Tekanan udara berada pada kondisi stabil.'
    }
  }

  return {
    status: 'Tinggi',
    desc: 'Tekanan udara berada di atas kondisi normal.'
  }
}

// Menentukan kondisi polutan PM berdasarkan rentang kategori ISPU.
function getPollutantCondition(value) {
  if (value <= 50) {
    return {
      status: 'Baik',
      desc: 'Konsentrasi partikel masih rendah.'
    }
  }

  if (value <= 100) {
    return {
      status: 'Sedang',
      desc: 'Konsentrasi partikel mulai meningkat.'
    }
  }

  if (value <= 200) {
    return {
      status: 'Tidak Sehat',
      desc: 'Konsentrasi partikel tidak sehat untuk aktivitas luar.'
    }
  }

  if (value <= 300) {
    return {
      status: 'Sangat Tidak Sehat',
      desc: 'Konsentrasi partikel sangat tinggi.'
    }
  }

  return {
    status: 'Berbahaya',
    desc: 'Konsentrasi partikel sangat berbahaya.'
  }
}

// Menentukan kondisi kadar CO, seperti aman, sedang, tinggi, atau berbahaya.
function getCOCondition(value) {
  if (value <= 5) {
    return {
      status: 'Aman',
      desc: 'Kadar CO sangat rendah dan aman.'
    }
  }

  if (value <= 15) {
    return {
      status: 'Sedang',
      desc: 'Kadar CO mulai meningkat.'
    }
  }

  if (value <= 30) {
    return {
      status: 'Tinggi',
      desc: 'Kadar CO cukup tinggi.'
    }
  }

  return {
    status: 'Berbahaya',
    desc: 'Kadar CO sangat berbahaya.'
  }
}

// Menentukan warna badge dan progress bar berdasarkan status kondisi sensor.
function getConditionStyle(status) {
  if (status === 'Baik' || status === 'Normal' || status === 'Aman') {
    return {
      badge: 'bg-green-500/20 text-green-400',
      bar: 'bg-green-500'
    }
  }

  if (status === 'Sedang' || status === 'Hangat' || status === 'Waspada') {
    return {
      badge: 'bg-blue-500/20 text-blue-400',
      bar: 'bg-blue-500'
    }
  }

  if (status === 'Rendah' || status === 'Tinggi' || status === 'Tidak Sehat') {
    return {
      badge: 'bg-yellow-500/20 text-yellow-400',
      bar: 'bg-yellow-400'
    }
  }

  if (status === 'Sangat Tinggi' || status === 'Sangat Tidak Sehat') {
    return {
      badge: 'bg-red-500/20 text-red-400',
      bar: 'bg-red-500'
    }
  }

  return {
    badge: 'bg-slate-900 text-white',
    bar: 'bg-slate-900'
  }
}

// Memberikan saran monitoring berdasarkan nilai prediksi kualitas udara.
function getMonitoringAdvice(aqi) {
  if (aqi <= 100) {
    return 'Semua parameter masih dapat dipantau secara normal. Kualitas udara relatif aman untuk aktivitas harian.'
  }

  if (aqi <= 200) {
    return 'Kualitas udara mulai tidak sehat. Disarankan menggunakan masker saat beraktivitas di luar ruangan.'
  }

  if (aqi <= 300) {
    return 'Kualitas udara sangat tidak sehat. Kurangi aktivitas luar ruangan dan gunakan masker jika harus keluar.'
  }

  return 'Kualitas udara berbahaya. Tidak disarankan keluar rumah kecuali untuk keperluan mendesak.'
}

// Mengubah nilai indeks polusi menjadi kategori ISPU: Baik, Sedang, Tidak Sehat, Sangat Tidak Sehat, atau Berbahaya.
function getStatus(aqi) {
  if (aqi <= 50) return 'Baik'
  if (aqi <= 100) return 'Sedang'
  if (aqi <= 200) return 'Tidak Sehat'
  if (aqi <= 300) return 'Sangat Tidak Sehat'
  return 'Berbahaya'
}

// Menentukan warna gradient tampilan berdasarkan kategori nilai polusi.
function getGradientColor(aqi) {
  if (aqi <= 50) return 'from-green-500 to-green-400 text-black'
  if (aqi <= 100) return 'from-blue-500 to-blue-400 text-white'
  if (aqi <= 200) return 'from-yellow-400 to-yellow-300 text-black'
  if (aqi <= 300) return 'from-red-600 to-red-500 text-white'
  return 'from-gray-950 to-black text-white'
}