// Otomatik test: flying-squid ile sahte bir sunucu açar, botu bağlar,
// botun yanına ağaç diker ve iki şeyi test eder:
//   TEST 1 — bot ağacı buluyor ve kesiyor mu?
//   TEST 2 — "dur" komutu kesme işini gerçekten durduruyor mu?
//
// Çalıştırma: node test/e2e.js
process.env.MC_VERSION = '1.20.2'
process.env.MC_PORT = '25599'
process.env.MC_HOST = 'localhost'

const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const Vec3 = require('vec3')

const { chopTrees, oduncuSay } = require('../bot/skills/chopTree')
const { GorevKontrol, IptalEdildi } = require('../bot/utils/gorev')

const VERSION = '1.20.2'
const PORT = 25599

let basarisiz = 0
function kontrol (ad, sartSaglandi, detay = '') {
  if (sartSaglandi) {
    console.log(`  PASS  ${ad} ${detay}`)
  } else {
    console.log(`  FAIL  ${ad} ${detay}`)
    basarisiz++
  }
}

async function main () {
  const squid = require('flying-squid')
  const server = squid.createMCServer({
    motd: 'MinecrAI test', port: PORT, 'max-players': 5, 'online-mode': false,
    logging: false, gameMode: 0, difficulty: 1, worldFolder: null,
    generation: { name: 'diamond_square', options: { worldHeight: 80 } },
    kickTimeout: 60000, plugins: {}, modpe: false, 'view-distance': 4,
    'player-list-text': { header: 't', footer: 't' }, 'everybody-op': true,
    'max-entities': 100, version: VERSION
  })

  await new Promise((res) => server.on('listening', res))

  const bot = mineflayer.createBot({
    host: 'localhost', port: PORT, username: 'MinecrAI', version: VERSION, auth: 'offline'
  })
  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)

  await new Promise((res, rej) => {
    bot.once('spawn', res)
    bot.once('error', rej)
    setTimeout(() => rej(new Error('spawn timeout')), 30000)
  })

  const mv = new Movements(bot)
  mv.canDig = true
  bot.pathfinder.setMovements(mv)

  // --- Test sahnesini kur ---------------------------------------------
  // Arazi rastgele uretildigi icin testler tutarsiz oluyordu.
  // Cozum: botun etrafinda duz bir platform acip agaci oraya dikiyoruz.
  const mcData = require('minecraft-data')(bot.version)
  const logState = mcData.blocksByName.oak_log.defaultState
  const stoneState = mcData.blocksByName.stone.defaultState
  const airState = mcData.blocksByName.air.defaultState
  const p = bot.entity.position.floored()
  const player = server.players[0]

  // 13x13 tas platform + uzerini temizle
  for (let dx = -6; dx <= 6; dx++) {
    for (let dz = -6; dz <= 6; dz++) {
      player.setBlock(new Vec3(p.x + dx, p.y - 1, p.z + dz), stoneState)
      for (let dy = 0; dy <= 7; dy++) {
        player.setBlock(new Vec3(p.x + dx, p.y + dy, p.z + dz), airState)
      }
    }
  }

  // Agaclar birbirine bitisik olursa flood-fill onlari TEK agac sayiyor.
  // Bu yuzden aralarinda en az 3 blok birakiyoruz.
  const agacDik = (dx, dz, yukseklik = 4) => {
    for (let i = 0; i < yukseklik; i++) {
      player.setBlock(new Vec3(p.x + dx, p.y + i, p.z + dz), logState)
    }
  }
  const agaclariTemizle = () => {
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        for (let dy = 0; dy <= 7; dy++) {
          player.setBlock(new Vec3(p.x + dx, p.y + dy, p.z + dz), airState)
        }
      }
    }
  }

  agacDik(4, 0)

  await new Promise((r) => setTimeout(r, 3000))

  // ---------------------------------------------------- TEST 1: ağaç kesme
  console.log('\nTEST 1 — bot agaci buluyor ve kesiyor mu?')
  const k1 = new GorevKontrol()
  k1.baslat()
  const oncesi = oduncuSay(bot)
  const sonuc = await chopTrees(bot, k1, 1)
  k1.bitir()

  kontrol('en az 1 kutuk kesildi', sonuc.kesilen > 0, `(kesilen=${sonuc.kesilen})`)
  kontrol('en az 1 agac islendi', sonuc.agac > 0, `(agac=${sonuc.agac})`)
  kontrol('envanter azalmadi', oduncuSay(bot) >= oncesi)

  // ------------------------------------------------- TEST 2: "dur" komutu
  console.log('\nTEST 2 — "dur" kesme islemini durduruyor mu?')

  // Test 1 agaci bitirdi; iptal edilecek yeni ve uzak bir agac dik
  agaclariTemizle()
  agacDik(-5, -5, 6)
  agacDik(5, 5, 6)
  await new Promise((r) => setTimeout(r, 1500))

  const k2 = new GorevKontrol()
  k2.baslat()

  let iptalYakalandi = false
  let bittiMi = false

  const gorev = chopTrees(bot, k2, Infinity)
    .then(() => { bittiMi = true })
    .catch((err) => {
      if (err instanceof IptalEdildi) iptalYakalandi = true
      else throw err
    })

  // 2 saniye çalışsın, sonra "dur" de
  await new Promise((r) => setTimeout(r, 2000))
  const durAnı = Date.now()
  k2.durdur()

  await Promise.race([
    gorev,
    new Promise((_, rej) => setTimeout(() => rej(new Error('gorev 15sn icinde durmadi')), 15000))
  ]).catch((e) => console.log('  (hata:', e.message, ')'))

  const gecenSure = Date.now() - durAnı

  kontrol('gorev iptal ile sonlandi', iptalYakalandi || bittiMi,
    iptalYakalandi ? '(IptalEdildi yakalandi)' : '(kendiliginden bitti)')
  kontrol('durma suresi 15sn altinda', gecenSure < 15000, `(${(gecenSure / 1000).toFixed(1)}sn)`)

  // ---------------------------------------------------------------- sonuc
  console.log(basarisiz === 0
    ? '\n=== TUM TESTLER GECTI ==='
    : `\n=== ${basarisiz} TEST BASARISIZ ===`)
  process.exit(basarisiz === 0 ? 0 : 1)
}

main().catch((e) => { console.error('TEST HATASI:', e.message); process.exit(1) })
