// Server for the demo-collection test.
//
// Builds the scene around the real bot (the bridge bot): waits server-side for
// that player to connect and land, then clears a flat platform around it and
// plants trees. Replants chopped trees periodically.
const { sunucuBaslat, oyuncuyuBekle, platformKur, agacDik } = require('./sahne')

const VERSION = process.env.TEST_VERSION || '1.20.2'
const PORT = parseInt(process.env.TEST_PORT || '25605', 10)
const BOT_ADI = process.env.TEST_BOT || 'Ajan'

// Keep >=2 blocks between them or flood-fill counts them as one tree
const AGAC_YERLERI = [
  [-6, -3], [-3, -6], [3, -6], [6, -3],
  [-6, 3], [-3, 6], [3, 6], [6, 3],
  [-8, 0], [8, 0], [0, -8], [0, 8]
]

async function main () {
  const server = await sunucuBaslat(PORT, VERSION)
  console.log(`DEMOSERVER: hazir ${PORT}, "${BOT_ADI}" bekleniyor`)

  const { merkez } = await oyuncuyuBekle(server, BOT_ADI)
  console.log(`DEMOSERVER: ${BOT_ADI} yere indi @ ${merkez}`)

  platformKur(server, VERSION, merkez, { yaricap: 10, yukseklik: 6 })
  await new Promise((r) => setTimeout(r, 800))

  const dik = () => AGAC_YERLERI.forEach(([dx, dz]) =>
    agacDik(server, VERSION, merkez, dx, dz, 4))

  dik()
  console.log(`DEMOSERVER: ${AGAC_YERLERI.length} agac dikildi`)
  setInterval(() => { try { dik() } catch (e) {} }, 10000)
}

main().catch((e) => { console.error('DEMOSERVER HATA:', e.message); process.exit(1) })
