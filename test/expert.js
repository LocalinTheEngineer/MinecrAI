// Expert policy test: can the bot find and chop a tree with only the 5
// actions, no pathfinder shortcut?
//
// Run: node test/expert.js
process.env.MC_VERSION = '1.20.2'

const {
  sunucuBaslat, botBaglat, botuBeklet, platformKur, agacDik, yaprakSar, sahneyiDogrula
} = require('./sahne')
const { MinecraftEnvironment } = require('../bot/bridge/environment')

const VERSION = '1.20.2'
const PORT = 25601
const MAKS_ADIM = 150
const ADLAR = ['ileri', 'sag', 'sol', 'kir', 'bekle']

async function main () {
  const server = await sunucuBaslat(PORT, VERSION)
  const bot = await botBaglat(PORT, VERSION, 'Uzman')

  // Let the bot land first, then build the scene
  const merkez = await botuBeklet(bot)
  platformKur(server, VERSION, merkez, { yaricap: 7, yukseklik: 6 })
  await new Promise((r) => setTimeout(r, 1000))

  // Plant the trees behind the bot so it has to learn to turn first.
  // Spaced apart: adjacent trunks get counted as one tree.
  const agac = agacDik(server, VERSION, merkez, -5, -2, 4)
  agacDik(server, VERSION, merkez, 4, -4, 4)
  // Leaves on the trunk: a realistic obstacle in the bot's path
  yaprakSar(server, VERSION, merkez, -5, -2, 4)
  yaprakSar(server, VERSION, merkez, 4, -4, 4)
  const gorunuyor = await sahneyiDogrula(bot, agac)

  console.log(`Bot: ${merkez}  |  Agac: ${agac}  |  bot agaci goruyor mu: ${gorunuyor}`)
  if (!gorunuyor) { console.log('*** SAHNE KURULAMADI ***'); process.exit(1) }

  const env = new MinecraftEnvironment(bot)
  await env.reset()

  const sayac = [0, 0, 0, 0, 0]
  let toplamOdul = 0
  let bittiAdim = null

  console.log('\nAdim  Aksiyon  Odul     Odun  Mesafe  Sebep')
  for (let adim = 0; adim < MAKS_ADIM; adim++) {
    const mesafeOnce = env.hamMesafe()
    const { action, sebep } = env.uzmanAksiyonu()
    sayac[action]++
    const r = await env.step(action)
    toplamOdul += r.reward

    if (adim < 10 || r.info.kirilanKutuk > 0 || r.info.yeniOdun > 0) {
      console.log(
        `${String(adim).padStart(4)}  ${ADLAR[action].padEnd(7)}` +
        `  ${r.reward >= 0 ? '+' : ''}${r.reward.toFixed(3)}  ` +
        `${String(r.info.odun).padStart(4)}  ` +
        `${(mesafeOnce ?? 0).toFixed(1).padStart(6)}  ${sebep}`)
    }
    if (r.terminated || r.truncated) { bittiAdim = adim + 1; break }
  }

  console.log('\n--- SONUC ---')
  console.log('Aksiyon dagilimi:', ADLAR.map((a, i) => `${a}=${sayac[i]}`).join('  '))
  console.log('Toplanan odun   :', env.oncekiOdun)
  console.log('Toplam odul     :', toplamOdul.toFixed(2))
  console.log('Biten adim      :', bittiAdim ?? `${MAKS_ADIM} (limit)`)

  const basarili = env.oncekiOdun > 0
  console.log(basarili
    ? '\n*** BASARILI: uzman 5 aksiyonla odun topladi ***'
    : '\n*** BASARISIZ: uzman odun toplayamadi ***')
  process.exit(basarili ? 0 : 1)
}

main().catch((e) => { console.error('HATA:', e.message); process.exit(1) })
