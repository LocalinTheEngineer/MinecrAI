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

const fs = require('fs')
const path = require('path')
const Vec3 = require('vec3')

function sahteBot () {
  return {
    username: 'SmokeBot',
    entity: {
      position: new Vec3(0, 64, 0),
      yaw: 0,
      pitch: 0,
      onGround: true,
      height: 1.62
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
    recipesAll: () => [],
    registry: { blocksByName: {} },
    version: '1.20.4',
    world: {},
    pathfinder: {
      stop () {},
      setGoal () {},
      goto: async () => {},
      isMoving: () => false,
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
  const env = new MinecraftEnvironment(bot, { zamanCarpani: 0 })

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
    const e2 = new MinecraftEnvironment(b2, { zamanCarpani: 0 })
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

  console.log('\nUretim (tarif agaci)')
  const uretModul = require('../bot/skills/uret')

  await dene('adiCoz() - turkce isimler', () => {
    const beklenen = {
      'tas kazma': 'stone_pickaxe',
      'demir kazma': 'iron_pickaxe',
      'tahta balta': 'wooden_axe',
      cubuk: 'stick',
      tezgah: 'crafting_table',
      stone_pickaxe: 'stone_pickaxe'
    }
    for (const [girdi, cikti] of Object.entries(beklenen)) {
      const v = uretModul.adiCoz(girdi)
      if (v !== cikti) throw new Error(`"${girdi}" -> ${v}, beklenen ${cikti}`)
    }
  })

  await dene('uret() - tanimadigi esyada durust hata', async () => {
    const r = await uretModul.uret(bot, k, 'zurna borusu')
    if (r.basarili) throw new Error('olmayan esyayi yaptigini iddia etti')
    if (!/bilmiyorum/.test(r.mesaj)) throw new Error(`belirsiz mesaj: ${r.mesaj}`)
  })

  await dene('uret() - malzeme yoksa EKSIGI soyler', async () => {
    const r = await uretModul.uret(bot, k, 'cubuk')
    if (r.basarili) throw new Error('bos envanterle uretim iddia etti')
    if (!r.mesaj.includes('Eksik olan')) throw new Error(`eksigi soylemedi: ${r.mesaj}`)
  })

  await dene('uret() - tarif agacini cozuyor (gercek tarif tablosu)', async () => {
    // Bu test Minecraft'siz calisiyor ama GERCEK tarif tablosunu kullaniyor.
    // 3 kutuk + 3 tas verip "tas kazma" istiyoruz; kodun kendi basina
    // tahta -> cubuk -> tezgah -> kazma zincirini kurmasi gerekiyor.
    const mcData = require('minecraft-data')('1.20.4')
    const Recipe = require('prismarine-recipe')('1.20.4').Recipe

    const env = { oak_log: 3, cobblestone: 3 } // masa YOK - kendi yapmali
    let masaYerde = false
    const yerlesen = {}
    let sonEquip = null
    const b = {
      version: '1.20.4',
      inventory: {
        items: () => Object.entries(env).filter(([, c]) => c > 0)
          .map(([name, count], i) => ({ name, count, type: mcData.itemsByName[name].id, slot: i }))
      },
      // Baslangicta ORTALIKTA MASA YOK. Bot once masayi uretip yere
      // koymak zorunda. Bu satir onceden her zaman masa donduruyordu,
      // o yuzden "masam yokken 3x3 tarifi goremiyorum" bugu testte
      // hic gorunmedi -- sahte dunya gercekten daha kolaydi.
      findBlock: () => (masaYerde ? { name: 'crafting_table', position: new Vec3(1, 64, 0) } : null),
      // Konan bloklari HATIRLIYOR: blokKoy() koydugu blogu blockAt ile
      // dogruluyor. Sahte dunya unutursa "koyamadim" sanip pes ediyor.
      blockAt: (p) => {
        const anahtar = `${p.x},${Math.floor(p.y)},${p.z}`
        if (yerlesen[anahtar]) {
          return { name: yerlesen[anahtar], boundingBox: 'block', position: p }
        }
        return {
          name: Math.floor(p.y) < 64 ? 'dirt' : 'air',
          boundingBox: Math.floor(p.y) < 64 ? 'block' : 'empty',
          position: p
        }
      },
      entity: { position: new Vec3(0, 64, 0) },
      equip: async (e) => { sonEquip = e && e.name },
      placeBlock: async (ref) => {
        masaYerde = true
        if (sonEquip) {
          yerlesen[`${ref.position.x},${ref.position.y + 1},${ref.position.z}`] = sonEquip
          env[sonEquip] = (env[sonEquip] || 1) - 1
        }
      },
      // mineflayer'in DAVRANISINI taklit ediyoruz, sadece imzasini degil:
      // masa verilmezse 3x3 tarifleri eliyor. Bu satir onceden sadece
      // Recipe.find(...) idi; test gecti ama oyunda calismadi, cunku sahte
      // bot gercek botun yapmadigi bir seyi yapiyordu (her tarifi doner).
      recipesAll: (id, meta, masa) => Recipe.find(id, null)
        .filter((r) => !r.requiresTable || masa),
      craft: async (tarif, kere) => {
        for (const d of tarif.delta) {
          const n = mcData.items[d.id].name
          env[n] = (env[n] || 0) + d.count * kere
        }
      }
    }

    const r = await uretModul.uret(b, k, 'tas kazma')
    if (!r.basarili) throw new Error(`uretemedi: ${r.mesaj}`)
    if ((env.stone_pickaxe || 0) < 1) throw new Error('kazma envanterde yok')
    if ((env.stick || 0) < 0) throw new Error('cubuk sayisi negatif')
  })

  console.log('\nSutun (agacin tepesine cikma)')
  const sutun = require('../bot/skills/sutun')

  await dene('sutunBlogu() - envanter bos ise null', () => {
    if (sutun.sutunBlogu(bot) !== null) throw new Error('bos envanterde blok buldu')
  })

  await dene('sutunBlogu() - topragi odundan once secer', () => {
    const b = sahteBot()
    b.inventory = {
      items: () => [
        { name: 'oak_log', count: 5, type: 1 },
        { name: 'dirt', count: 3, type: 2 }
      ]
    }
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
    const dip = skills.govdeninDibi
      ? skills.govdeninDibi(b, orta)
      : require('../bot/skills/chopTree').govdeninDibi(b, orta)
    if (dip.position.y !== 64) throw new Error(`dip y=${dip.position.y}, 64 olmaliydi`)
  })

  await dene('uret() SIFIRDAN demir kazma (kes > kaz > erit > uret)', async () => {
    // Ucu uca zincir testi. Envanter TAMAMEN bos basliyor:
    //   demir kazma <- 3 kulce + 2 cubuk
    //     kulce   <- tezgahta YOK -> firin <- ham demir <- kaz
    //     cubuk   <- tahta <- kutuk <- kes
    //     firin   <- 8 tas <- kaz
    // Bot bu agaci kendi kurmali; hicbir adim elle yazilmadi.
    const mcData = require('minecraft-data')('1.20.4')
    const Recipe = require('prismarine-recipe')('1.20.4').Recipe

    const env = {}
    let masaYerde = false
    const yerlesen = {}
    let sonEquip = null
    let pisen = 0
    const istenen = []

    const b = {
      version: '1.20.4',
      entity: { position: new Vec3(0, 64, 0) },
      inventory: {
        items: () => Object.entries(env).filter(([, c]) => c > 0)
          .map(([name, count], i) => ({ name, count, type: mcData.itemsByName[name].id, slot: i }))
      },
      findBlock: () => (masaYerde ? { name: 'crafting_table', position: new Vec3(1, 64, 0) } : null),
      // Konan bloklari HATIRLIYOR: blokKoy() koydugu blogu blockAt ile
      // dogruluyor. Sahte dunya unutursa "koyamadim" sanip pes ediyor.
      blockAt: (p) => {
        const anahtar = `${p.x},${Math.floor(p.y)},${p.z}`
        if (yerlesen[anahtar]) {
          return { name: yerlesen[anahtar], boundingBox: 'block', position: p }
        }
        return {
          name: Math.floor(p.y) < 64 ? 'dirt' : 'air',
          boundingBox: Math.floor(p.y) < 64 ? 'block' : 'empty',
          position: p
        }
      },
      equip: async (e) => { sonEquip = e && e.name },
      placeBlock: async (ref) => {
        masaYerde = true
        if (sonEquip) {
          yerlesen[`${ref.position.x},${ref.position.y + 1},${ref.position.z}`] = sonEquip
        }
      },
      recipesAll: (id, m, masa) => Recipe.find(id, null).filter((r) => !r.requiresTable || masa),
      craft: async (t, kere) => {
        for (const d of t.delta) {
          env[mcData.items[d.id].name] = (env[mcData.items[d.id].name] || 0) + d.count * kere
        }
      },
      openFurnace: async () => ({
        putFuel: async () => {},
        putInput: async (id, m, c) => { pisen = c; env.raw_iron -= c },
        outputItem: () => (pisen > 0 ? { count: pisen } : null),
        takeOutput: async () => {
          const n = pisen; pisen = 0
          env.iron_ingot = (env.iron_ingot || 0) + n
          return { count: n }
        },
        close: () => {}
      })
    }

    const tedarikci = async (bot, kontrol, ad, adet) => {
      istenen.push(ad)
      if (/_log$/.test(ad)) env[ad] = (env[ad] || 0) + 8
      else if (ad === 'cobblestone' || ad === 'stone') env.cobblestone = (env.cobblestone || 0) + 16
      else if (ad === 'raw_iron') env.raw_iron = (env.raw_iron || 0) + 4
      else if (ad === 'coal') env.coal = (env.coal || 0) + 4
      else return false
      return true
    }

    const kk = { kontrolEt () {}, bekle: async () => {} }
    const r = await uretModul.uret(b, kk, 'demir kazma', 1, { tedarikci })
    if (!r.basarili) throw new Error(`zincir koptu: ${r.mesaj}`)
    if ((env.iron_pickaxe || 0) < 1) throw new Error('kazma envanterde yok')
    if (!istenen.includes('raw_iron')) throw new Error('ham demir hic istenmedi')
    if (istenen.some((x) => x.startsWith('stripped_'))) {
      throw new Error(`soyulmus kutuk istedi: ${istenen.join(',')}`)
    }
  })

  await dene('uret() ormanda NE VARSA ona uyuyor (agac turu tahmin etmiyor)', async () => {
    // Gercek hata: bot "spruce_log toplanamiyor" dedi. Cubugun ~12 tarifi
    // var (her agac turu icin bir tahta). Envanter bosken hepsi ayni puani
    // aliyor, bot rastgele ladini secip israr ediyordu -- ormanda mese vardi.
    // Iki tur: 1) tedarikciyi tetikle, 2) eline GECENLE yeniden puanla.
    const mcData = require('minecraft-data')('1.20.4')
    const Recipe = require('prismarine-recipe')('1.20.4').Recipe

    const env = {}
    let masaYerde = false
    const yerlesen = {}
    let sonEquip = null
    const b = {
      version: '1.20.4',
      entity: { position: new Vec3(0, 64, 0) },
      inventory: {
        items: () => Object.entries(env).filter(([, c]) => c > 0)
          .map(([name, count], i) => ({ name, count, type: mcData.itemsByName[name].id, slot: i }))
      },
      findBlock: () => (masaYerde ? { name: 'crafting_table', position: new Vec3(1, 64, 0) } : null),
      // Konan bloklari HATIRLIYOR: blokKoy() koydugu blogu blockAt ile
      // dogruluyor. Sahte dunya unutursa "koyamadim" sanip pes ediyor.
      blockAt: (p) => {
        const anahtar = `${p.x},${Math.floor(p.y)},${p.z}`
        if (yerlesen[anahtar]) {
          return { name: yerlesen[anahtar], boundingBox: 'block', position: p }
        }
        return {
          name: Math.floor(p.y) < 64 ? 'dirt' : 'air',
          boundingBox: Math.floor(p.y) < 64 ? 'block' : 'empty',
          position: p
        }
      },
      equip: async (e) => { sonEquip = e && e.name },
      placeBlock: async (ref) => {
        masaYerde = true
        if (sonEquip) {
          yerlesen[`${ref.position.x},${ref.position.y + 1},${ref.position.z}`] = sonEquip
        }
      },
      recipesAll: (id, m, masa) => Recipe.find(id, null).filter((r) => !r.requiresTable || masa),
      craft: async (t, kere) => {
        for (const d of t.delta) {
          env[mcData.items[d.id].name] = (env[mcData.items[d.id].name] || 0) + d.count * kere
        }
      }
    }

    // ORMANDA SADECE MESE VAR: ne istenirse istensin mese geliyor
    const tedarikci = async (bot, kontrol, ad, adet) => {
      if (/_log$/.test(ad)) { env.oak_log = (env.oak_log || 0) + 8; return true }
      if (ad === 'cobblestone' || ad === 'stone') { env.cobblestone = (env.cobblestone || 0) + 16; return true }
      return false
    }

    const kk = { kontrolEt () {}, bekle: async () => {} }
    const r = await uretModul.uret(b, kk, 'tas kazma', 1, { tedarikci })
    if (!r.basarili) throw new Error(`tur cesidine takildi: ${r.mesaj}`)
    if ((env.stone_pickaxe || 0) < 1) throw new Error('kazma yok')
  })

  await dene('tedarikci AYNI kaynagi iki kez toplamiyor (sonsuz agac kesme)', async () => {
    // Gercek hata: tek bir "uret tas kazma" komutu 4 agac kesti ve hala
    // bitmemisti. Cubugun ~12 tarifi var (her agac turu icin bir tahta);
    // uret sirayla hepsini deniyor, her biri icin tedarikciden o TURDEN
    // kutuk istiyordu -> her istekte yeni agac kesiliyordu.
    const mcData = require('minecraft-data')('1.20.4')
    const Recipe = require('prismarine-recipe')('1.20.4').Recipe

    const env = {}
    let masaYerde = false
    const yerlesen = {}
    let sonEquip = null
    let kesilenAgac = 0
    let kazilanTas = 0

    const b = {
      version: '1.20.4',
      entity: { position: new Vec3(0, 64, 0) },
      inventory: {
        items: () => Object.entries(env).filter(([, c]) => c > 0)
          .map(([name, count], i) => ({ name, count, type: mcData.itemsByName[name].id, slot: i }))
      },
      findBlock: () => (masaYerde ? { name: 'crafting_table', position: new Vec3(1, 64, 0) } : null),
      // Konan bloklari HATIRLIYOR: blokKoy() koydugu blogu blockAt ile
      // dogruluyor. Sahte dunya unutursa "koyamadim" sanip pes ediyor.
      blockAt: (p) => {
        const anahtar = `${p.x},${Math.floor(p.y)},${p.z}`
        if (yerlesen[anahtar]) {
          return { name: yerlesen[anahtar], boundingBox: 'block', position: p }
        }
        return {
          name: Math.floor(p.y) < 64 ? 'dirt' : 'air',
          boundingBox: Math.floor(p.y) < 64 ? 'block' : 'empty',
          position: p
        }
      },
      equip: async (e) => { sonEquip = e && e.name },
      placeBlock: async (ref) => {
        masaYerde = true
        if (sonEquip) {
          yerlesen[`${ref.position.x},${ref.position.y + 1},${ref.position.z}`] = sonEquip
        }
      },
      recipesAll: (id, m, masa) => Recipe.find(id, null).filter((r) => !r.requiresTable || masa),
      craft: async (t, kere) => {
        for (const d of t.delta) {
          env[mcData.items[d.id].name] = (env[mcData.items[d.id].name] || 0) + d.count * kere
        }
      }
    }

    // Gercek tedarikciYap()'in mantigini kullaniyoruz ama sayac koyuyoruz
    const sinif = (ad) => (/_log$/.test(ad) ? 'odun' : (ad === 'cobblestone' || ad === 'stone' ? 'tas' : null))
    const verilen = new Set()
    const tedarikci = async (bot, kontrol, ad, adet) => {
      const s2 = sinif(ad)
      if (!s2 || verilen.has(s2)) return false
      // ORMANDA KIRAZ VAR, MESE YOK.
      // Kiraz bilerek secildi: tarif listesinde ARKALARDA. Ilk denenen
      // tarif mese oluyor; tek turlu bir cozum meseye takilip kalirdi.
      // Botun "elime kiraz gecti, tarifleri yeniden puanlayayim" demesi
      // gerekiyor. Mese verseydik test hicbir sey kanitlamazdi.
      if (s2 === 'odun') { kesilenAgac++; env.cherry_log = (env.cherry_log || 0) + 8 } else { kazilanTas++; env.cobblestone = (env.cobblestone || 0) + 16 }
      verilen.add(s2)
      return true
    }

    const kk = { kontrolEt () {}, bekle: async () => {} }
    const r = await uretModul.uret(b, kk, 'tas kazma', 1, { tedarikci })
    if (!r.basarili) throw new Error(`uretemedi: ${r.mesaj}`)
    if (kesilenAgac !== 1) throw new Error(`${kesilenAgac} kez agac kesti, 1 olmaliydi`)
    if (kazilanTas !== 1) throw new Error(`${kazilanTas} kez tas kazdi, 1 olmaliydi`)
  })

  console.log('\nMadencilik')
  const kazModul = require('../bot/skills/kaz')

  await dene('kazmaSeviyesi() - kazma yoksa null', () => {
    if (kazModul.kazmaSeviyesi(bot) !== null) throw new Error('olmayan kazmayi buldu')
  })

  await dene('kazmaSeviyesi() - en iyisini seciyor', () => {
    const b = sahteBot()
    b.inventory = {
      items: () => [
        { name: 'wooden_pickaxe', count: 1 },
        { name: 'iron_pickaxe', count: 1 },
        { name: 'stone_pickaxe', count: 1 }
      ]
    }
    const s2 = kazModul.kazmaSeviyesi(b)
    if (s2 !== 'iron') throw new Error(`en iyi iron olmaliydi, ${s2} dedi`)
  })

  await dene('ileriYon() - yaw ana yone yuvarlaniyor', () => {
    const b = sahteBot()
    const beklenen = [[0, 0, -1], [Math.PI / 2, -1, 0], [Math.PI, 0, 1], [-Math.PI / 2, 1, 0]]
    for (const [yaw, dx, dz] of beklenen) {
      b.entity.yaw = yaw
      const v = kazModul.ileriYon(b)
      if (v.x !== dx || v.z !== dz) {
        throw new Error(`yaw ${yaw.toFixed(2)} -> (${v.x},${v.z}), beklenen (${dx},${dz})`)
      }
    }
  })

  await dene('kaz() - tanimadigi cevherde durust hata', async () => {
    const r = await kazModul.kaz(bot, k, 'kripton')
    if (r.basarili) throw new Error('olmayan cevheri kazdigini iddia etti')
    if (!/bilmiyorum/.test(r.mesaj)) throw new Error(`belirsiz mesaj: ${r.mesaj}`)
  })

  await dene('kaz() - kazma yoksa once uretmeyi deniyor, sonra durust pes ediyor', async () => {
    const r = await kazModul.kaz(bot, k, 'elmas', 1)
    if (r.basarili) throw new Error('kazmasiz elmas kazdigini iddia etti')
    if (!/kazma/.test(r.mesaj)) throw new Error(`kazma eksigini soylemedi: ${r.mesaj}`)
  })

  await dene('kalanDayaniklilik() - kullanilmis alet', () => {
    const taze = kazModul.kalanDayaniklilik({ maxDurability: 131, durabilityUsed: 0 })
    const yipranmis = kazModul.kalanDayaniklilik({ maxDurability: 131, durabilityUsed: 125 })
    const aletsiz = kazModul.kalanDayaniklilik({ name: 'cobblestone' })
    if (taze !== 131) throw new Error(`taze ${taze}`)
    if (yipranmis !== 6) throw new Error(`yipranmis ${yipranmis}`)
    if (aletsiz !== Infinity) throw new Error('aletsiz esya sonsuz olmali')
  })

  await dene('kazmaGucu() - sadece YETERLI seviyedekileri topluyor', () => {
    const b = sahteBot()
    b.inventory = {
      items: () => [
        { name: 'wooden_pickaxe', maxDurability: 59, durabilityUsed: 0 },
        { name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 50 }
      ]
    }
    // 'iron' isteyince tahta kazma sayilmamali
    const g = kazModul.kazmaGucu(b, 'iron')
    if (g.adet !== 1 || g.toplam !== 200) {
      throw new Error(`iron icin adet=${g.adet} toplam=${g.toplam}, beklenen 1/200`)
    }
    // 'wooden' isteyince ikisi de sayilmali
    const g2 = kazModul.kazmaGucu(b, 'wooden')
    if (g2.adet !== 2 || g2.toplam !== 259) {
      throw new Error(`wooden icin adet=${g2.adet} toplam=${g2.toplam}, beklenen 2/259`)
    }
  })

  await dene('seviyeyeIn() - kazma yoksa KAZMADAN duruyor', async () => {
    // Kritik: kazmasiz inmeye baslarsa cevheri yok ederek ilerler.
    // Hic basamak kirmadan 'kazma_bitti' ile donmeli.
    const r = await kazModul.seviyeyeIn(bot, 15, k, { seviye: 'stone' })
    if (r.ok) throw new Error('kazmasiz indigini iddia etti')
    if (r.basamak !== 0) throw new Error(`${r.basamak} basamak kirmis, 0 olmaliydi`)
    if (r.sebep !== 'kazma_bitti') throw new Error(`sebep: ${r.sebep}`)
  })

  await dene('elmas kazma varken demir kazma YAPMIYOR', () => {
    // Gercek sikayet: "elinde elmas kazma olmasina ragmen gidip demir
    // kazma yapmakta". Sebep, stok kontrolunun "3 kazmam var mi?" diye
    // SAYMASI. Bir elmas kazma 1561 vurus -- uc tas kazmanin (393) dort
    // kati. Sayarak bakinca "1 tane, az"; vurusla bakinca fazlasiyla
    // yeterli. Olcu birimi adet degil VURUS olmali.
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    b.inventory = { items: () => [{ name: 'diamond_pickaxe', maxDurability: 1561, durabilityUsed: 0 }] }

    // "kaz elmas 10": y=64'ten y=-58'e inis + 10 blok kazma
    const gerekli = kazModul.gerekenVurus(b, -58, 10)
    const elde = kazModul.kazmaGucu(b, 'iron').toplam

    if (elde < gerekli) {
      throw new Error(`elmas kazma (${elde} vurus) ${gerekli} vurusluk ise yetmiyor sayildi`)
    }
    // Adet olcusu kullanilsaydi 1 < 3 cikip bosuna kazma yapardi
    if (kazModul.kazmaGucu(b, 'iron').adet >= 3) {
      throw new Error('test anlamsiz: zaten 3 kazma var')
    }
  })

  await dene('gerekenVurus() derinlikle buyuyor', () => {
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    const sig = kazModul.gerekenVurus(b, 50, 5) // 14 blok
    const derin = kazModul.gerekenVurus(b, -58, 5) // 122 blok
    if (!(derin > sig * 3)) {
      throw new Error(`derin ${derin} vs sig ${sig} — derinlik hesaba katilmamis`)
    }
  })

  await dene('uret() tahtayi SOYULMUS kutukten yapmaya kalkmiyor', () => {
    // Gercek hata: bot "demir kazma yapamadim, eksik olan
    // stripped_birch_log" dedi. Tahtanin 4 tarifi var; soyulmus kutuk
    // dogada YOK (baltayla soyulur), ama tarif gecerli oldugu icin
    // seciliyordu. Puanlama artik "elde var mi"ya degil "nasil elde
    // edilir"e bakiyor.
    const mcData = require('minecraft-data')('1.20.4')
    const b = sahteBot()
    const Recipe = require('prismarine-recipe')('1.20.4').Recipe
    b.recipesAll = (id, m, masa) => Recipe.find(id, null).filter((r) => !r.requiresTable || masa)

    const p1 = uretModul.malzemePuani(b, mcData, 'birch_log')
    const p2 = uretModul.malzemePuani(b, mcData, 'stripped_birch_log')
    const p3 = uretModul.malzemePuani(b, mcData, 'birch_wood')
    if (!(p1 > p2)) throw new Error(`kutuk ${p1} <= soyulmus kutuk ${p2}`)
    if (!(p1 > p3)) throw new Error(`kutuk ${p1} <= wood ${p3}`)
    if (p2 >= 0) throw new Error(`soyulmus kutuk pozitif puan aldi: ${p2}`)
  })

  console.log('\nEritme (firin)')
  const eritModul = require('../bot/skills/erit')

  await dene('eritmeGirdisi() - kulce icin ham cevher', () => {
    if (eritModul.eritmeGirdisi('iron_ingot') !== 'raw_iron') throw new Error('demir zinciri kopuk')
    if (eritModul.eritmeGirdisi('gold_ingot') !== 'raw_gold') throw new Error('altin zinciri kopuk')
    if (eritModul.eritmeGirdisi('stick') !== null) throw new Error('cubuk eritilmez')
  })

  await dene('yakitBul() - komuru odundan once seciyor', () => {
    const b = sahteBot()
    b.inventory = {
      items: () => [
        { name: 'oak_log', count: 10 },
        { name: 'coal', count: 4 }
      ]
    }
    const y = eritModul.yakitBul(b, 8)
    if (!y || y.esya.name !== 'coal') throw new Error(`secilen: ${y && y.esya.name}`)
    if (y.kullan !== 1) throw new Error(`1 komur 8 esya pisirir, ${y.kullan} dedi`)
  })

  await dene('erit() - girdi yoksa NEYIN eksik oldugunu soyluyor', async () => {
    const r = await eritModul.erit(bot, k, 'iron_ingot', 1)
    if (r.basarili) throw new Error('bos envanterle erittigini iddia etti')
    if (r.eksik !== 'raw_iron') throw new Error(`eksik: ${r.eksik}, raw_iron olmaliydi`)
  })

  await dene('uret() zinciri firina atliyor (demir kulce tezgahta yok)', async () => {
    // Demir kulce TEZGAHTA uretilemiyor. Eskiden burada "uretilemiyor"
    // deyip duruyorduk; artik eritmeyi denemesi, o da olmayinca ham
    // maddeyi ISTEMESI lazim.
    const r = await uretModul.uret(bot, k, 'iron_ingot', 1)
    if (r.basarili) throw new Error('yoktan kulce urettigini iddia etti')
    if (!/raw_iron|iron/.test(r.mesaj)) {
      throw new Error(`ham maddeyi hic anmadi: ${r.mesaj}`)
    }
  })

  await dene('enYakinDogalAgac() kara listedeki agaci ATLIYOR', () => {
    // Gercek hata: bot ulasilamayan bir kutugu (1429,71,-48) BES KEZ
    // ust uste secti, her denemede ~20 saniye harcadi. Kara liste yoktu.
    const chop = require('../bot/skills/chopTree')
    const b = sahteBot()
    // y=64..66 arasi tek bir mese govdesi
    b.blockAt = (p) => {
      const y = Math.floor(p.y)
      const kutuk = (p.x === 10 && p.z === 10 && y >= 64 && y <= 66)
      // Yapraklar USTTE olmali: dogalAgacMi yapragi dy 0..6 araliginda
      // ariyor, yani kutugun ustunde.
      return {
        name: kutuk ? 'oak_log' : (y >= 67 && y <= 68 ? 'oak_leaves' : 'air'),
        boundingBox: kutuk ? 'block' : 'empty',
        position: new Vec3(p.x, y, p.z)
      }
    }
    b.findBlocks = () => [new Vec3(10, 65, 10)]

    const bulunan = chop.enYakinDogalAgac(b, 32)
    if (!bulunan) throw new Error('agaci hic bulamadi')

    // Ayni agacin DIBINI kara listeye al -> artik bulmamali
    const kara = new Set(['10,64,10'])
    const ikinci = chop.enYakinDogalAgac(b, 32, kara)
    if (ikinci) throw new Error(`kara listeye ragmen secti: ${ikinci.position}`)
  })

  await dene('damarTopla() damarin TAMAMINI buluyor', () => {
    // Gercek sikayet: "bir 2 tane kazdi, geride 3-4 tane birakti,
    // yenisine gitti". Kod her turda "en yakin cevheri" secip kiriyordu;
    // bir blok kirilinca en yakin aday bazen BASKA damarin kenari
    // oluyordu. Artik damar tek parca olarak toplaniyor.
    const b = sahteBot()
    // (0,10,0)-(0,10,2) ve (1,10,0) => 4 blokluk bir damar
    const damarNoktalari = new Set(['0,10,0', '0,10,1', '0,10,2', '1,10,0'])
    b.blockAt = (p) => ({
      name: damarNoktalari.has(`${p.x},${p.y},${p.z}`) ? 'iron_ore' : 'stone',
      boundingBox: 'block',
      position: p
    })

    const damar = kazModul.damarTopla(b, new Vec3(0, 10, 0), ['iron_ore', 'deepslate_iron_ore'])
    if (damar.length !== 4) {
      throw new Error(`${damar.length} blok buldu, 4 olmaliydi`)
    }
  })

  await dene('damarTopla() komsu OLMAYAN cevhere atlamiyor', () => {
    const b = sahteBot()
    // Iki ayri damar: biri (0,10,0), digeri 5 blok otede
    const noktalar = new Set(['0,10,0', '0,10,1', '5,10,5', '5,10,6'])
    b.blockAt = (p) => ({
      name: noktalar.has(`${p.x},${p.y},${p.z}`) ? 'iron_ore' : 'stone',
      boundingBox: 'block',
      position: p
    })
    const damar = kazModul.damarTopla(b, new Vec3(0, 10, 0), ['iron_ore'])
    if (damar.length !== 2) throw new Error(`${damar.length} blok — iki damari birlestirdi`)
  })

  await dene('birAdimIlerle() YATAY gidiyor (bedrocka inmiyor)', async () => {
    // Gercek hata: cevher bulamayinca "biraz ilerle, tekrar bak"
    // deniyordu ama ilerlemek icin birBasamakIn cagriliyordu -- o da her
    // seferinde BIR KAT ASAGI iniyor. Bot boyle bedrocka kadar indi.
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    b.entity.yaw = 0 // ileri = -z
    let hedef = null
    b.pathfinder = {
      ...b.pathfinder,
      setGoal () {},
      stop () {},
      goto: async (g) => { hedef = g }
    }
    await kazModul.birAdimIlerle(b, k)
    if (!hedef) throw new Error('hic yurumeye calismadi')
    if (hedef.y !== 64) throw new Error(`y=${hedef.y} hedefledi, 64 (ayni seviye) olmaliydi`)
    if (hedef.z !== -1) throw new Error(`ileri gitmedi: z=${hedef.z}`)
  })

  await dene('sutundanIn() kazmayi KUSANIP kaziyor (elle degil)', async () => {
    // Gercek sikayet: "yuzeye cikma isini kazmasi olmasina ragmen
    // eliyle yapmakta". Tasi elle kirmak ~5 kat yavas, cevher olursa
    // hicbir sey de dusmuyor. chopTree ve kaz aleti kusaniyordu,
    // sutun.js atlanmisti.
    const b = sahteBot()
    b.entity.position = new Vec3(0, 70, 0)
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.canDigBlock = () => true

    const sira = []
    b.blockAt = (p) => ({ name: 'stone', boundingBox: 'block', position: p })
    b.equip = async (esya) => { sira.push('equip:' + esya.name) }
    b.dig = async () => {
      sira.push('dig')
      b.entity.position = new Vec3(0, b.entity.position.y - 1, 0)
    }

    await sutun.sutundanIn(b, 69, k)
    if (sira.length === 0) throw new Error('hic kazmadi')
    if (sira[0] !== 'equip:iron_pickaxe') {
      throw new Error(`ilk is ${sira[0]} — kazmayi kusanmadan kazdi`)
    }
  })

  await dene('kaz() ulasilamayan cevherde SONSUZ DONGUYE girmiyor', async () => {
    // Gercek sikayet: bot ulasabildigi bir elmasi kiramayip donguye
    // girdi; kullanici gidip elmasi elle kirarak dongüyu bozdu.
    // Sahte dunya: elmas HER ZAMAN orada (kirilmiyor), pathfinder hep
    // basarili. Sigorta olmasa bu test sonsuza kadar calisirdi.
    const b = sahteBot()
    b.entity.position = new Vec3(0, -58, 0)
    b.inventory = { items: () => [{ name: 'diamond_pickaxe', maxDurability: 1561, durabilityUsed: 0, type: 1 }] }
    b.registry = { blocksByName: { diamond_ore: { id: 1 }, deepslate_diamond_ore: { id: 2 } } }
    b.findBlocks = () => [new Vec3(2, -58, 0)]
    b.blockAt = (p) => ({
      name: (p.x === 2 && Math.floor(p.y) === -58 && p.z === 0) ? 'diamond_ore' : 'deepslate',
      boundingBox: 'block',
      position: new Vec3(p.x, Math.floor(p.y), p.z)
    })
    b.canDigBlock = () => false // ASLA kirilmiyor

    // Beklemeleri sifirla: sigortayi olcuyoruz, gercek sureleri degil
    const hizli = { kontrolEt () {}, bekle: async () => {} }
    const bitis = Date.now() + 8000
    const r = await kazModul.kaz(b, hizli, 'elmas', 10)
    if (Date.now() > bitis) throw new Error('8 saniyeden uzun surdu — dongu var')
    if (r.kirilan > 0) throw new Error('kirilamayan blogu kirdigini iddia etti')
  })

  await dene('guvenliMi() su icin cevher/merdiven ayrimi yapiyor', () => {
    // Su, NEREYE GITTIGINE gore tehlikeli:
    //  - uzaktan CEVHERE vuruyorsak yanindaki su onemsiz (biraz sel)
    //  - MERDIVEN kaziyorsak o bosluga KENDIMIZ girecegiz -> bogulma
    // Eskiden su mutlak engeldi ve ulasilabilir elmaslar reddediliyordu.
    const b = sahteBot()
    b.blockAt = (p) => ({
      name: (p.x === 1 && p.y === 0 && p.z === 0) ? 'water' : 'deepslate',
      boundingBox: 'block',
      position: p
    })
    const konum = new Vec3(0, 0, 0)
    if (!kazModul.guvenliMi(b, konum)) throw new Error('cevher icin suyu engel saydi')
    if (kazModul.guvenliMi(b, konum, { suTehlikeli: true })) {
      throw new Error('merdiven icin suyu guvenli saydi — bogulur')
    }

    // Lav her iki durumda da engel
    b.blockAt = (p) => ({
      name: (p.x === 1 && p.y === 0 && p.z === 0) ? 'lava' : 'deepslate',
      boundingBox: 'block',
      position: p
    })
    if (kazModul.guvenliMi(b, konum)) throw new Error('lavi guvenli saydi')
  })

  await dene('tehlikedeMi() can azalinca ve lavda uyariyor', () => {
    // Gercek olay: bot lav golune girdi ve OLDU. Kod kirdigi bloklari
    // guvenlik acisindan denetliyordu ama BOTUN KENDI durumunu hic
    // sormuyordu. Lav saniyede ~4 can goturuyor.
    const b = sahteBot()
    b.blockAt = () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) })

    b.health = 20
    if (kazModul.tehlikedeMi(b)) throw new Error('saglikliyken tehlike dedi')

    b.health = 6
    if (!kazModul.tehlikedeMi(b)) throw new Error('6 canla tehlike gormedi')

    b.health = 20
    b.blockAt = (p) => ({ name: 'lava', boundingBox: 'empty', position: p })
    if (!kazModul.tehlikedeMi(b)) throw new Error('lavin icinde tehlike gormedi')
  })

  await dene('ondeLavVarMi() tunel yonunde lav goruyor', () => {
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    // 3 blok ileride (-z yonu) lav
    b.blockAt = (p) => ({
      name: (p.z === -3) ? 'lava' : 'stone',
      boundingBox: 'block',
      position: p
    })
    const ileri = new Vec3(0, 0, -1)
    if (!kazModul.ondeLavVarMi(b, ileri)) throw new Error('3 blok ilerideki lavi gormedi')

    const geri = new Vec3(0, 0, 1)
    if (kazModul.ondeLavVarMi(b, geri)) throw new Error('ters yonde olmayan lavi gordu')
  })

  console.log('\nBlok yerlestirme')
  const yerlestir = require('../bot/utils/yerlestir')

  await dene('blokKoy() dar yerde YER ACIYOR (pes etmiyor)', async () => {
    // Gercek sikayet: "envanterinde 2 firin var ama koyacak yer yok
    // diyor -- kirsin bi yeri koysun iste". Eski kod yanindaki 6 sabit
    // noktaya bakip pes ediyordu. Bot zaten kazma tasiyan bir madenci.
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    b.inventory = { items: () => [{ name: 'furnace', count: 2, type: 1 }] }
    b.canDigBlock = () => true

    // HER YER DOLU: hicbir hazir nokta yok
    const kirilan = new Set()
    const konan = {}
    let sonEquip = null
    b.blockAt = (p) => {
      const anahtar = `${p.x},${Math.floor(p.y)},${p.z}`
      if (konan[anahtar]) return { name: konan[anahtar], boundingBox: 'block', position: p }
      if (kirilan.has(anahtar)) return { name: 'air', boundingBox: 'empty', position: p }
      return { name: 'stone', boundingBox: 'block', position: new Vec3(p.x, Math.floor(p.y), p.z) }
    }
    b.equip = async (e) => { sonEquip = e && e.name }
    b.dig = async (blok) => {
      kirilan.add(`${blok.position.x},${blok.position.y},${blok.position.z}`)
    }
    b.placeBlock = async (ref) => {
      konan[`${ref.position.x},${ref.position.y + 1},${ref.position.z}`] = sonEquip
    }

    if (yerlestir.hazirYerBul(b)) throw new Error('test kurulumu bozuk: hazir yer var')

    const sonuc = await yerlestir.blokKoy(b, 'furnace', k)
    if (!sonuc) throw new Error('yer acamadi, pes etti')
    if (kirilan.size === 0) throw new Error('hic blok kirmadan koydugunu iddia etti')
  })

  await dene('blokKoy() korumali bolgeye koymuyor', async () => {
    const b = sahteBot()
    b.inventory = { items: () => [] }
    const sonuc = await yerlestir.blokKoy(b, 'furnace', k)
    if (sonuc) throw new Error('envanterde yokken koydugunu iddia etti')
  })

  await dene('pathfinderGit() TAKILMAYI yakaliyor (sonsuza kadar beklemiyor)', async () => {
    // Gercek olay: bot bir cikintinin kenarinda "kosuyor ama
    // ilerlemiyor" durumuna girdi. Pathfinder yol bulmus, tuslara
    // basiyor, ama bot fiziksel olarak takili. Sadece sure siniri
    // yetmiyordu: 15 saniyeyi beklemek hem uzun, hem de bunu "yol yok"
    // gibi gosteriyor -- oysa yol var, bot sikismis.
    const gorev = require('../bot/utils/gorev')
    const b = sahteBot()
    let tuslarTemizlendi = false
    b.clearControlStates = () => { tuslarTemizlendi = true }
    // goto hic bitmiyor, bot hic kimildamiyor: klasik takilma
    b.pathfinder = { ...b.pathfinder, goto: () => new Promise(() => {}) }

    const t = Date.now()
    const r = await gorev.pathfinderGit(b, {}, k, { zamanAsimi: 30000, durgunlukMs: 1000 })
    const sure = Date.now() - t

    if (r.ok) throw new Error('takilirken basarili dedi')
    if (r.sebep !== 'takildim') throw new Error(`sebep: ${r.sebep}`)
    if (sure > 5000) throw new Error(`${sure}ms bekledi — zaman asimini bekledi, takilmayi gormedi`)
    if (!tuslarTemizlendi) throw new Error('tuslari birakmadi, bot kosmaya devam eder')
  })

  console.log('\nSikismadan kurtulma')
  const kurtarModul = require('../bot/utils/kurtar')

  await dene('kurtar() acik yon varsa ziplayarak cikiyor', async () => {
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    // +x yonu acik, digerleri kapali
    b.blockAt = (p) => {
      const acik = (p.x >= 1)
      return { name: acik ? 'air' : 'stone', boundingBox: acik ? 'empty' : 'block', position: p }
    }
    const basildi = []
    b.setControlState = (ad, deger) => { if (deger) basildi.push(ad) }
    // Ziplayinca gercekten yer degistirsin
    b.lookAt = async () => { b.entity.position = new Vec3(1.5, 64, 0) }

    const r = await kurtarModul.kurtar(b, k)
    if (!r) throw new Error('acik yon varken kurtulamadi')
    if (!basildi.includes('jump')) throw new Error('ziplamadi')
  })

  await dene('kurtar() her yon kapaliysa KENDINE YOL KAZIYOR', async () => {
    // Gercek durum: bot kendi kazdigi 1 blokluk kuyuda sikismis.
    // Ziplayacak yer yok; kazmasi var, yol acmali.
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    b.blockAt = (p) => ({ name: 'stone', boundingBox: 'block', position: p })
    b.canDigBlock = () => true
    let kazildi = 0
    b.dig = async () => { kazildi++ }

    const r = await kurtarModul.kurtar(b, k)
    if (!r) throw new Error('her yon kapaliyken pes etti')
    if (kazildi === 0) throw new Error('hic kazmadan kurtuldugunu iddia etti')
  })

  await dene('kurtar() LAVA dogru kazmiyor', async () => {
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    b.blockAt = (p) => ({ name: 'lava', boundingBox: 'block', position: p })
    b.canDigBlock = () => true
    let kazildi = 0
    b.dig = async () => { kazildi++ }

    await kurtarModul.kurtar(b, k)
    if (kazildi > 0) throw new Error('lavi kazdi — kendini oldururdu')
  })

  await dene('tedarikci BASARISIZ denemeyi de hatirliyor (48 kez agac aramiyor)', async () => {
    // Gercek log: aynı saniyede 48 kez "64 blok icinde dogal agac
    // bulamadim". Sebep: sadece BASARILI toplamalar not ediliyordu.
    // Bot yeraltindayken agac bulamiyor, not dusulmuyor, ve uret bir
    // sonraki agac turu icin tekrar soruyordu (~11 tur x tekrar).
    const skills = require('../bot/skills')
    let cagri = 0

    // Gercek tedarikciYap()'i kullaniyoruz ama chopTrees'i sayacakla
    // degistiremiyoruz; bunun yerine AYNI SINIFTAN cok kez isteyip
    // ikinciden sonra false donmesini bekliyoruz.
    const tedarikci = skills.tedarikciYap()
    const b = sahteBot()
    b.findBlocks = () => { cagri++; return [] } // hic agac yok

    const r1 = await tedarikci(b, k, 'oak_log', 1)
    const r2 = await tedarikci(b, k, 'birch_log', 1)
    const r3 = await tedarikci(b, k, 'spruce_log', 1)

    if (r1 || r2 || r3) throw new Error('agac yokken buldugunu iddia etti')
    if (cagri > 1) throw new Error(`${cagri} kez agac aradi — bir kez yeterliydi`)
  })

  await dene('kaz() YIPRANMIS kazmayla calismaya devam ediyor', async () => {
    // Gercek ekran goruntusu: elinde demir kazma, ONUNDE elmas, ama
    // "0 elmas kirdim, sonra kazmam bitti" deyip yukari dondu.
    // Sebep: 20 vuruşluk esigin altina dusunce "bitti" sayiliyordu.
    // 15 vurusluk bir kazmayla birkac elmas rahat kirilir.
    const b = sahteBot()
    b.entity.position = new Vec3(0, -58, 0)
    // 15 vurus kalmis demir kazma: esigin (20) ALTINDA ama BITMIS DEGIL
    b.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 235, type: 1 }] }
    b.registry = { blocksByName: { diamond_ore: { id: 1 }, deepslate_diamond_ore: { id: 2 } } }
    b.canDigBlock = () => true

    const kirilanlar = new Set()
    b.findBlocks = () => (kirilanlar.has('2,-58,0') ? [] : [new Vec3(2, -58, 0)])
    b.blockAt = (p) => {
      const anahtar = `${p.x},${Math.floor(p.y)},${p.z}`
      const elmas = anahtar === '2,-58,0' && !kirilanlar.has(anahtar)
      return {
        name: elmas ? 'diamond_ore' : 'deepslate',
        boundingBox: 'block',
        position: new Vec3(p.x, Math.floor(p.y), p.z)
      }
    }
    b.dig = async (blok) => {
      kirilanlar.add(`${blok.position.x},${blok.position.y},${blok.position.z}`)
    }

    const hizli = { kontrolEt () {}, bekle: async () => {} }
    const r = await kazModul.kaz(b, hizli, 'elmas', 1)
    if (r.kirilan === 0) throw new Error(`yipranmis kazmayla calismayi reddetti: ${r.mesaj}`)
  })

  console.log('\nKomut yonlendirme')
  await dene('KOMUTLAR listesindeki her komut gercekten yonlendiriliyor', () => {
    // NEDEN BU TEST VAR:
    // "uret" komutunu ekledim, KOMUTLAR listesine yazdim, skill'i yazdim,
    // skill'in kendi testleri gecti -- ama komut oyunda hicbir sey yapmadi.
    // Sebep: yonlendirici `komut.startsWith('uret ')` diye bakiyordu, oysa
    // `komut` mesajin sadece ILK KELIMESI, icinde asla bosluk yok. Kosul
    // hicbir zaman dogru olmadi ve hata da vermedi -- sessizce oldu.
    // Fonksiyonu test etmek yetmiyor; BAGLANTIYI da test etmek gerekiyor.
    const kaynak = fs.readFileSync(path.join(__dirname, '..', 'bot', 'index.js'), 'utf8')
    const { KOMUTLAR } = require('../bot/index')

    const eksik = []
    for (const { ad } of KOMUTLAR) {
      const ilk = ad.split(' ')[0]
      // Yonlendiricide bu kelime bir esitlik karsilastirmasinda geciyor mu?
      const desen = new RegExp(`komut === ['\"]${ilk}['\"]`)
      if (!desen.test(kaynak)) eksik.push(ad)
    }
    if (eksik.length > 0) {
      throw new Error(`yonlendirilmeyen komutlar: ${eksik.join(', ')}`)
    }
  })

  console.log(hata === 0 ? '\n=== HEPSI GECTI ===' : `\n=== ${hata} HATA ===`)
  process.exit(hata === 0 ? 0 : 1)
}

main().catch((e) => { console.error('TEST COKTU:', e.message); process.exit(1) })
