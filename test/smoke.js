// HIZLI KONTROL — Minecraft gerekmez, ~1 saniye surer.
//
// Neden var: `node -e "require(...)"` sadece SOZDIZIMI hatasi yakalar.
// "bot is not defined" gibi calisma zamani hatalari ancak kod calistiginda
// ortaya cikiyor ve biz bunu ilk kez veri toplarken fark ettik — yani
// kullanici 40 turluk isi baslattiktan sonra.
//
// Bu dosya sahte bir bot nesnesiyle butun kritik yollari bir kez calistirir.
// Kod degistirdikten sonra:  node test/smoke.js
'use strict'

const Vec3 = require('vec3')

function sahteBot () {
  return {
    username: 'SmokeBot',
    entity: {
      position: new Vec3(0, 64, 0), yaw: 0, pitch: 0,
      onGround: true, height: 1.62
    },
    health: 20,
    food: 20,
    heldItem: null,
    players: {},
    entities: {},
    inventory: { items: () => [] },
    blockAt: () => ({ name: 'air', boundingBox: 'empty', position: new Vec3(0, 0, 0) }),
    findBlocks: () => [],
    findBlock: () => null,
    blockAtCursor: () => null,
    canDigBlock: () => false,
    recipesFor: () => [],
    world: {},
    pathfinder: {
      stop () {}, setGoal () {}, goto: async () => {}, isMoving: () => false,
      getPathTo: () => ({ path: [], status: 'noPath' }),
      movements: {}
    },
    chat () {},
    look: async () => {},
    lookAt: async () => {},
    dig: async () => {},
    equip: async () => {},
    toss: async () => {},
    craft: async () => {},
    placeBlock: async () => {},
    stopDigging () {},
    clearControlStates () {},
    setControlState () {},
    // Olay dinleyicileri — environment 'death' olayina abone oluyor
    _dinleyiciler: {},
    on (olay, fn) { (this._dinleyiciler[olay] ||= []).push(fn) },
    once (olay, fn) { this.on(olay, fn) },
    removeListener (olay, fn) {
      const l = this._dinleyiciler[olay]
      if (l) this._dinleyiciler[olay] = l.filter((x) => x !== fn)
    },
    emit (olay, ...a) { (this._dinleyiciler[olay] || []).forEach((f) => f(...a)) }
  }
}

let hata = 0
async function dene (ad, fn) {
  try {
    await fn()
    console.log(`  PASS  ${ad}`)
  } catch (err) {
    console.log(`  FAIL  ${ad} -> ${err.message}`)
    hata++
  }
}

async function main () {
  console.log('Modul yukleme')
  await dene('bot/index.js', () => require('../bot/index.js'))
  await dene('bot/bridge/server.js', () => require('../bot/bridge/server.js'))
  await dene('bot/skills/index.js', () => require('../bot/skills/index.js'))
  await dene('bot/utils/chat.js', () => require('../bot/utils/chat.js'))
  await dene('bot/utils/koruma.js', () => require('../bot/utils/koruma.js'))

  const { MinecraftEnvironment } = require('../bot/bridge/environment')
  const skills = require('../bot/skills')
  const { GorevKontrol } = require('../bot/utils/gorev')

  console.log('\nEnvironment (RL tarafi)')
  const bot = sahteBot()
  const env = new MinecraftEnvironment(bot)

  await dene('reset()', async () => {
    const r = await env.reset()
    if (r.obs.length !== 16) throw new Error(`gozlem boyutu ${r.obs.length}, beklenen 16`)
  })
  await dene('step() tum aksiyonlar', async () => {
    for (let a = 0; a < 5; a++) await env.step(a)
  })
  await dene('uzmanAksiyonu()', () => {
    const u = env.uzmanAksiyonu()
    if (typeof u.action !== 'number') throw new Error('aksiyon sayi degil')
  })
  await dene('yuzeyeCik()', () => env.yuzeyeCik())
  await dene('onundekiKutuk()', () => env.onundekiKutuk())
  await dene('onumuKapatan()', () => env.onumuKapatan())

  console.log('\nOlum (envanter kaybi buyuk negatif odule donusmemeli)')
  await dene('olum sonrasi odul makul', async () => {
    const b2 = sahteBot()
    let odun = 451
    b2.inventory = { items: () => [{ name: 'oak_log', count: odun, type: 1 }] }
    const e2 = new MinecraftEnvironment(b2)
    await e2.reset()
    b2.emit('death')
    odun = 0
    const r = await e2.step(4)
    if (r.reward < -10) throw new Error(`odul ${r.reward} — envanter kaybi cezaya yazilmis`)
    if (r.info.odun < 0) throw new Error(`odun ${r.info.odun} negatif`)
    if (!r.terminated) throw new Error('olumde bolum bitmedi')
  })

  console.log('\nSkill\'ler')
  const k = new GorevKontrol()
  k.baslat()
  await dene('chopTree()', () => skills.chopTree(bot, k))
  await dene('gel() - oyuncu yok', () => skills.gel(bot, k, 'YokBoyleBiri'))
  await dene('baltaYap() - odun yok', () => skills.baltaYap(bot))
  await dene('ver() - esya yok', () => skills.ver(bot, 'Biri', 'odun'))
  await dene('uygunAlet()', () => skills.uygunAlet(bot, { name: 'oak_log' }))

  console.log('\nSutun (agacin tepesine cikma)')
  const sutun = require('../bot/skills/sutun')

  await dene('sutunBlogu() - envanter bos ise null', () => {
    if (sutun.sutunBlogu(bot) !== null) throw new Error('bos envanterde blok buldu')
  })

  await dene('sutunBlogu() - topragi odundan once secer', () => {
    const b = sahteBot()
    b.inventory = { items: () => [
      { name: 'oak_log', count: 5, type: 1 },
      { name: 'dirt', count: 3, type: 2 }
    ] }
    const secilen = sutun.sutunBlogu(b)
    if (!secilen || secilen.name !== 'dirt') {
      throw new Error(`odun yerine toprak secmeliydi, secti: ${secilen && secilen.name}`)
    }
  })

  await dene('sutunaCik() - blok yoksa cokmeden doner', async () => {
    const r = await sutun.sutunaCik(bot, 70, k)
    if (r.cikilan !== 0) throw new Error('bloksuz yukseldigini iddia etti')
    if (r.sebep !== 'blok_yok') throw new Error(`beklenmedik sebep: ${r.sebep}`)
  })

  await dene('sutundanIn() - zeminde ise hic kazmaz', async () => {
    const inilen = await sutun.sutundanIn(bot, 64, k)
    if (inilen !== 0) throw new Error(`zeminde ${inilen} kat indigini iddia etti`)
  })

  await dene('govdeninDibi() - govdenin altina yuruyor', () => {
    // y=64..67 arasi kutuk, y=63 toprak. Ortadaki kutukten baslayip
    // 64'e inmeli — "agacin ortasini kesip gitme" bugunun testi.
    const b = sahteBot()
    b.blockAt = (p) => {
      const y = Math.floor(p.y)
      const isim = (y >= 64 && y <= 67) ? 'oak_log' : 'dirt'
      return { name: isim, position: new Vec3(0, y, 0), boundingBox: 'block' }
    }
    const orta = b.blockAt(new Vec3(0, 66, 0))
    const dip = skills.govdeninDibi ? skills.govdeninDibi(b, orta)
      : require('../bot/skills/chopTree').govdeninDibi(b, orta)
    if (dip.position.y !== 64) throw new Error(`dip y=${dip.position.y}, 64 olmaliydi`)
  })

  console.log(hata === 0 ? '\n=== HEPSI GECTI ===' : `\n=== ${hata} HATA ===`)
  process.exit(hata === 0 ? 0 : 1)
}

main().catch((e) => { console.error('TEST COKTU:', e.message); process.exit(1) })
