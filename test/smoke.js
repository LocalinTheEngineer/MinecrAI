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
    // Varsayilan: gorus hatti acik. Duvar arkasi testi bunu override eder.
    canSeeBlock: () => true,
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

  await dene('yerinde sayan bolum TRUNCATE oluyor (yaprakta sikisma)', async () => {
    // Egitim kaydindaki gercek olay: 455 adim, 0 odun, -4.53 odul.
    // Ajan bir agacin tepesinde yapraklara gomulmus.
    //
    // KRITIK AYRINTI: bot HIC KIMILDAMIYOR degil, SUREKLI BIRAZ
    // KIMILDIYOR. `durgunlukSayaci` "hedefe yaklasma" degisimine bakiyor
    // ve en ufak kipirdanmada sifirlaniyor -- bu yuzden 455 adim boyunca
    // hic dolmadi. Bu testte sahte bot da oyle yapiyor: her adimda
    // yarim blok saga sola oynuyor ama BIR YERE GITMIYOR.
    const b3 = sahteBot()
    b3.entity.position = new Vec3(0, 64, 0)

    // Ulasilamayan bir agac: hedef var, yaklasma hesaplanıyor
    b3.findBlocks = () => [new Vec3(10, 64, 10)]
    b3.blockAt = (p) => {
      const kutuk = (p.x === 10 && p.z === 10 && Math.floor(p.y) >= 64 && Math.floor(p.y) <= 66)
      const yaprak = (p.x === 10 && p.z === 10 && Math.floor(p.y) >= 67 && Math.floor(p.y) <= 68)
      return {
        name: kutuk ? 'oak_log' : (yaprak ? 'oak_leaves' : 'air'),
        boundingBox: kutuk ? 'block' : 'empty',
        position: new Vec3(p.x, Math.floor(p.y), p.z)
      }
    }

    const e3 = new MinecraftEnvironment(b3, { zamanCarpani: 0 })
    await e3.reset()

    // Her adimda yarim blok kipirdan -- ama net yer degistirme yok
    let salinim = 0
    b3.look = async () => {
      salinim++
      b3.entity.position = new Vec3(salinim % 2 === 0 ? 0 : 0.6, 64, 0)
    }

    let sonuc = null
    for (let i = 0; i < 200; i++) {
      sonuc = await e3.step(1) // saga don: bot kipirdaniyor ama gitmiyor
      if (sonuc.truncated || sonuc.terminated) break
    }
    if (!sonuc.truncated) throw new Error('200 adim yerinde saydi, bolum bitmedi')
    if (e3.adim > 100) throw new Error(`${e3.adim} adim surdu — ~60'ta bitmeliydi`)
  })

  await dene('suyunIcindeMi() suyu taniyor', async () => {
    // Gercek olay: bot bogularak oldu, sonra 50+ bolum ust uste
    // "0 odun, 60 adim, -0.60" ile bitti. Ajanin aksiyon uzayinda yuzme
    // yok; suya dusunce yapabilecegi bir sey kalmiyor. Ogrenemeyecegi
    // bir durumda ceza yemesi ogrenme degil GURULTU -- ortam duzeltmeli.
    const b4 = sahteBot()
    const e4 = new MinecraftEnvironment(b4, { zamanCarpani: 0 })

    b4.blockAt = () => ({ name: 'air', boundingBox: 'empty', position: new Vec3(0, 0, 0) })
    if (e4.suyunIcindeMi()) throw new Error('havada su gordu')

    b4.blockAt = () => ({ name: 'water', boundingBox: 'empty', position: new Vec3(0, 0, 0) })
    if (!e4.suyunIcindeMi()) throw new Error('suyun icinde suyu gormedi')
  })

  await dene('sudanCik() ziplayarak yuzmeyi deniyor', async () => {
    const b4 = sahteBot()
    const e4 = new MinecraftEnvironment(b4, { zamanCarpani: 0 })
    let sudayim = true
    b4.blockAt = () => ({
      name: sudayim ? 'water' : 'air',
      boundingBox: 'empty',
      position: new Vec3(0, 0, 0)
    })
    const basilan = []
    b4.setControlState = (ad, deger) => {
      if (ad === 'jump' && deger) { basilan.push(ad); sudayim = false }
    }

    const r = await e4.sudanCik()
    if (!r) throw new Error('sudayken cikmayi denemedi')
    if (!basilan.includes('jump')) throw new Error('yuzmek icin ziplamadi')
  })

  await dene('acikHavadaMi() BUYUK magarada yanilmiyor', async () => {
    // Gercek olay: bot bir madene dustu ve cikamadi. Eski kontrol sadece
    // 5 blok yukari bakiyordu; tavan 20 blok yukarida oldugu icin
    // "ustum acik" dedi ve kurtarma HIC tetiklenmedi -- oysa bot yerin
    // 40 blok altindaydi. Dogru soru "yakinimda tavan var mi" degil,
    // "yukarisi SONUNA KADAR acik mi".
    const b5 = sahteBot()
    const e5 = new MinecraftEnvironment(b5, { zamanCarpani: 0 })
    b5.entity.position = new Vec3(0, 20, 0)

    // BUYUK magara: 20 blok bosluk, sonra tavan
    b5.blockAt = (p) => {
      const y = Math.floor(p.y)
      const dolu = y >= 42 // tavan cok yukarida
      return { name: dolu ? 'stone' : 'air', boundingBox: dolu ? 'block' : 'empty', position: p }
    }
    if (e5.acikHavadaMi()) throw new Error('magarada gokyuzu gordu')

    // Gercek yuzey: yukarisi sonuna kadar bos
    b5.blockAt = (p) => ({ name: 'air', boundingBox: 'empty', position: p })
    if (!e5.acikHavadaMi()) throw new Error('acik havada tavan gordu')
  })

  await dene('CAPRAZDAKI yapragi goruyor ve kirabiliyor', async () => {
    // Oyunda gorulen: ajanin onunde sol ve sag caprazda yaprak var,
    // tam ortasi bos. Sensor "onum acik" diyordu, ajan ileri basiyordu,
    // oyun onu gecirmiyordu. Sebep: hem engel sensoru hem "onumu kapatan
    // blok" TEK BIR NOKTAYA bakiyordu -- tam ileri, tam ortadan. Oysa
    // oyuncu kutusu 0.6 blok genis.
    const b6 = sahteBot()
    const e6 = new MinecraftEnvironment(b6, { zamanCarpani: 0 })
    // Bot blogun ORTASINDA DEGIL, kenarinda: x=0.9 => govde kutusu
    // (0.6..1.2) iki blok sutununa birden yayiliyor. Minecraft'ta
    // olagan durum bu; ajan nadiren tam ortada duruyor.
    b6.entity.position = new Vec3(0.9, 64, 0.5)
    b6.entity.yaw = 0 // ileri = -z
    b6.canDigBlock = () => true

    // Yaprak SADECE x=1 sutununda. Tam ileri isini (x=0) BOS goruyor,
    // ama govde x=1 sutununa tastigi icin gecemiyoruz.
    b6.blockAt = (p) => {
      const x = Math.floor(p.x); const y = Math.floor(p.y); const z = Math.floor(p.z)
      const yaprak = (y === 64 || y === 65) && z === -1 && x === 1
      return {
        name: yaprak ? 'oak_leaves' : 'air',
        boundingBox: yaprak ? 'block' : 'empty',
        position: new Vec3(x, y, z)
      }
    }

    if (!e6.onumdeEngelVar()) throw new Error('caprazdaki engeli GORMEDI')
    const hedef = e6.onumuKapatan()
    if (!hedef) throw new Error('caprazdaki yapragi kirmayi denemedi')
    if (hedef.name !== 'oak_leaves') throw new Error(`yanlis blok: ${hedef.name}`)
  })

  await dene('KAFASININ USTUNDEKI yapragi kirabiliyor', async () => {
    // "Zipliyor zipliyor ama nafile": kafasinin ustunde yaprak varsa
    // ziplayamiyor. Yukarisi da engeldir.
    const b6 = sahteBot()
    const e6 = new MinecraftEnvironment(b6, { zamanCarpani: 0 })
    b6.entity.position = new Vec3(0.5, 64, 0.5)
    b6.canDigBlock = () => true
    b6.blockAt = (p) => {
      const ustu = Math.floor(p.y) === 66
      return {
        name: ustu ? 'oak_leaves' : 'air',
        boundingBox: ustu ? 'block' : 'empty',
        position: p
      }
    }
    const hedef = e6.onumuKapatan()
    if (!hedef) throw new Error('kafasinin ustundeki yapragi gormedi')
  })

  await dene('step() suda ZIPLAYARAK yuzuyor (bogulmuyor)', async () => {
    // Bolum BASINDA sudan cikariyorduk ama bolum ORTASINDA suya girerse
    // orada oluyordu -- ve gercekten oldu, npm run bridge calisirken.
    // Ajanin aksiyon uzayinda yuzme yok; onun etkileyemedigi bir olumu
    // ortam engellemeli.
    const b7 = sahteBot()
    const e7 = new MinecraftEnvironment(b7, { zamanCarpani: 0 })
    b7.blockAt = () => ({ name: 'water', boundingBox: 'empty', position: new Vec3(0, 0, 0) })

    const basilan = []
    b7.setControlState = (ad, deger) => { if (deger) basilan.push(ad) }

    await e7.step(4) // "bekle" aksiyonu: ajan hicbir sey yapmiyor
    if (!basilan.includes('jump')) throw new Error('suda yuzmeyi denemedi')
  })

  console.log('\nGorev tanimlari (odun / maden)')
  const gorevler = require('../bot/bridge/gorevler')

  await dene('gorevGetir() bilinmeyen gorevde oduna dusuyor', () => {
    if (gorevler.gorevGetir('zurna').ad !== 'odun') throw new Error('varsayilan odun degil')
    if (gorevler.gorevGetir('maden').ad !== 'maden') throw new Error('maden bulunamadi')
  })

  await dene('maden gorevi cevheri taniyor, kutugu tanimiyor', () => {
    const m = gorevler.GOREVLER.maden
    for (const ad of ['iron_ore', 'deepslate_diamond_ore', 'coal_ore']) {
      if (!m.hedefMi({ name: ad })) throw new Error(`${ad} hedef sayilmadi`)
    }
    for (const ad of ['oak_log', 'stone', 'deepslate', 'dirt']) {
      if (m.hedefMi({ name: ad })) throw new Error(`${ad} yanlislikla hedef sayildi`)
    }
  })

  await dene('odun gorevi hala kutuk topluyor (geriye donuk uyum)', () => {
    const o = gorevler.GOREVLER.odun
    if (!o.hedefMi({ name: 'birch_log' })) throw new Error('kutugu tanimadi')
    if (o.hedefMi({ name: 'iron_ore' })) throw new Error('cevheri odun sandi')
    if (o.hedefAdet !== 5) throw new Error('hedef adet degismis')
  })

  await dene('ortam varsayilan olarak ODUN gorevinde (mevcut egitim bozulmasin)', () => {
    const b8 = sahteBot()
    const e8 = new MinecraftEnvironment(b8, { zamanCarpani: 0 })
    if (e8.gorev.ad !== 'odun') throw new Error(`varsayilan gorev: ${e8.gorev.ad}`)
    const e9 = new MinecraftEnvironment(sahteBot(), { zamanCarpani: 0, gorev: 'maden' })
    if (e9.gorev.ad !== 'maden') throw new Error('maden gorevi secilemedi')
  })

  await dene('maden gorevi bolum basinda KAZMA veriyor', async () => {
    // Yanlis kazmayla cevher kirmak onu YOK EDIYOR. Ajanin ogrenmesi
    // gereken sey "cevheri bul ve kir"; alet tedariki ayri bir problem.
    const b9 = sahteBot()
    const komutlar = []
    b9.chat = (m) => komutlar.push(m)
    const e9 = new MinecraftEnvironment(b9, { zamanCarpani: 0, gorev: 'maden' })
    await e9.reset()
    if (!komutlar.some((m) => /give .*iron_pickaxe/.test(m))) {
      throw new Error(`kazma verilmedi. komutlar: ${komutlar.join(' | ')}`)
    }
  })

  await dene('odun gorevi kazma VERMIYOR (gorevler birbirine karismasin)', async () => {
    const b9 = sahteBot()
    const komutlar = []
    b9.chat = (m) => komutlar.push(m)
    const e9 = new MinecraftEnvironment(b9, { zamanCarpani: 0 })
    await e9.reset()
    if (komutlar.some((m) => /iron_pickaxe/.test(m))) {
      throw new Error('odun gorevinde kazma verildi')
    }
    // Odun gorevi envanteri temizler, maden temizlemez
    if (!komutlar.some((m) => /clear .*minecraft:logs/.test(m))) {
      throw new Error('odun gorevi envanteri temizlemedi')
    }
  })

  await dene('maden gorevi YUZEYE CIKMAYA calismiyor', async () => {
    // Kurulumlar birbirinin tersi: odun yukari, maden asagi. Maden
    // goreviyle yuzeye isinlanmak bolumu bozar.
    const b9 = sahteBot()
    const komutlar = []
    b9.chat = (m) => komutlar.push(m)
    const e9 = new MinecraftEnvironment(b9, { zamanCarpani: 0, gorev: 'maden' })
    await e9.reset()
    if (komutlar.some((m) => /spreadplayers/.test(m))) {
      throw new Error('maden gorevinde yuzeye isinlandi')
    }
  })

  await dene('maden uzmani cevher gormeyince TUNEL ACIYOR (beklemiyor)', () => {
    // Odun uzmani "hedef yoksa bekle" diyordu ve orada dogruydu: ormanda
    // agac goremiyorsan kazacak bir sey yok. Madende TERSI -- cevher zaten
    // tasin icinde sakli, gorememek NORMAL. 'bekle' deseydi taklit
    // verisinin tamami "bekle" olurdu ve ajan hicbir sey ogrenemezdi.
    const uzman = require('../bot/bridge/expert')
    const b10 = sahteBot()
    const e10 = new MinecraftEnvironment(b10, { zamanCarpani: 0, gorev: 'maden' })

    // Hicbir cevher, hicbir esya yok; her yer tas
    b10.blockAt = () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) })
    b10.canDigBlock = () => true
    b10.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }

    const karar = uzman.uzmanAksiyonu(b10, e10)
    if (karar.action === 4) throw new Error('cevher gormeyince bekledi — tunel acmali')
    if (!/tunel/.test(karar.sebep)) throw new Error(`beklenmedik karar: ${karar.sebep}`)
  })

  await dene('odun uzmani agac gormeyince hala BEKLIYOR (geriye donuk)', () => {
    const uzman = require('../bot/bridge/expert')
    const b10 = sahteBot()
    const e10 = new MinecraftEnvironment(b10, { zamanCarpani: 0 })
    const karar = uzman.uzmanAksiyonu(b10, e10)
    if (karar.sebep !== 'AGAC_BULAMIYORUM') {
      throw new Error(`odun uzmani degisti: ${karar.sebep}`)
    }
  })

  await dene('engel kirma kurali goreve gore ayriliyor', () => {
    const g = require('../bot/bridge/gorevler')
    const b10 = sahteBot()
    b10.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    const tas = { name: 'stone', boundingBox: 'block' }
    const yaprak = { name: 'oak_leaves', boundingBox: 'block' }

    // Odun: tasi kirma (elle tas kazmak dakikalar surer, gorevle ilgisi yok)
    if (g.GOREVLER.odun.engelKirilabilirMi(b10, tas)) throw new Error('odun gorevinde tas kirilabilir sayildi')
    if (!g.GOREVLER.odun.engelKirilabilirMi(b10, yaprak)) throw new Error('yapragi kiramadi')

    // Maden: tasi kirmak GOREVIN KENDISI
    if (!g.GOREVLER.maden.engelKirilabilirMi(b10, tas)) throw new Error('madende tas kirilamaz sayildi')
    const lav = { name: 'lava', boundingBox: 'block' }
    if (g.GOREVLER.maden.engelKirilabilirMi(b10, lav)) throw new Error('lavi kirilabilir saydi')
  })

  await dene('uzman engeli KIRIYOR, sonsuza kadar dolasmiyor', () => {
    // Olculen hata: bolumlerin %43'u "hedefe donuyorum", %31'i "engelden
    // dolasiyorum", YURUME sadece %3. Iki adimlik dongu:
    //   hizalan -> onum kapali -> sola dolas (artik hizali degilim)
    //   -> hedefe geri don -> onum kapali -> sola dolas -> ...
    // Iki bolumde de tek bir kaynak toplanamadi.
    const uzman = require('../bot/bridge/expert')
    const b11 = sahteBot()
    const e11 = new MinecraftEnvironment(b11, { zamanCarpani: 0, gorev: 'maden' })
    b11.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b11.canDigBlock = () => true
    // Her yer tas: hizali olsak da onumuz kapali
    b11.blockAt = () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) })

    const karar = uzman.hedefeYonel(b11, e11, new Vec3(0, 64, -5), 'test')
    if (karar.action !== 3) {
      throw new Error(`kirmak yerine ${karar.action} sectiledi (${karar.sebep})`)
    }
  })

  await dene('kacinma sayaci dolastiktan sonra YURUMEYI dayatiyor', () => {
    const uzman = require('../bot/bridge/expert')
    const b11 = sahteBot()
    const e11 = new MinecraftEnvironment(b11, { zamanCarpani: 0 })
    // Kirilamayan engel (odun gorevinde tas kirilamaz) -> dolasmali
    b11.blockAt = () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) })

    const ilk = uzman.hedefeYonel(b11, e11, new Vec3(0, 64, -5), 'test')
    if (!/dolasiyorum/.test(ilk.sebep)) throw new Error(`dolasmadi: ${ilk.sebep}`)
    if (e11.kacinmaAdimi <= 0) throw new Error('kacinma sayaci kurulmadi')

    // Onu acilinca kacinma modunda YURUMELI, hedefe geri donmemeli
    b11.blockAt = () => ({ name: 'air', boundingBox: 'empty', position: new Vec3(0, 0, 0) })
    const ikinci = uzman.hedefeYonel(b11, e11, new Vec3(0, 64, -5), 'test')
    if (ikinci.action !== 0) throw new Error(`kacinirken yurumedi: ${ikinci.sebep}`)
  })

  await dene('maden kurulumu YUZEYDE cevher gorse bile iniyor', async () => {
    // Gercek hata: "zaten cevher goruyorsam inmeye gerek yok" yazmistim.
    // Yuzeyde de cevher gorunuyor (ucurum yuzundeki komur, magara agzindaki
    // demir). Bot 30 blok otedeki ulasilamaz cevhere kilitlenip yuzeyde
    // donup duruyordu: %63 "cevhere donuyorum", %10 yurume, HIC kirma yok.
    const b12 = sahteBot()
    b12.entity.position = new Vec3(0, 70, 0) // YUZEYDE
    b12.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    // Yakinda cevher GORUNUYOR
    b12.findBlocks = () => [new Vec3(5, 70, 5)]
    // Gercekci dunya: y<70 TAS (kazilacak), ustu hava, bir yerde cevher
    b12.blockAt = (p) => {
      const x = Math.floor(p.x); const y = Math.floor(p.y); const z = Math.floor(p.z)
      if (x === 5 && z === 5 && y === 70) {
        return { name: 'iron_ore', boundingBox: 'block', position: new Vec3(x, y, z) }
      }
      const dolu = y < 70
      return {
        name: dolu ? 'stone' : 'air',
        boundingBox: dolu ? 'block' : 'empty',
        position: new Vec3(x, y, z)
      }
    }
    b12.registry = { blocksByName: { iron_ore: { id: 1 } } }

    const e12 = new MinecraftEnvironment(b12, { zamanCarpani: 0, gorev: 'maden' })
    let inmeyiDenedi = false
    // seviyeyeIn cagrilirsa bunu yakalayalim: kaz.js'i sarmalamak yerine
    // log'a bakmak yerine, bot.dig cagrilarini sayiyoruz (merdiven kazar)
    b12.canDigBlock = () => true
    b12.dig = async () => { inmeyiDenedi = true }

    await e12.yeraltiKurulumu()
    if (!inmeyiDenedi) {
      throw new Error('yuzeyde cevher gorunce inmekten vazgecti')
    }
  })

  await dene('MADEN gorevinde de sudan cikiyor (bogulma gorevden bagimsiz)', async () => {
    // Gercek olay: bot maden gorevinde bogularak oldu. `sudanCik` yuzey
    // kurulumunun ICINDEYDI, yani kurtarma sadece odun gorevinde
    // calisiyordu. Yeraltinda su cebine girmek cok olagan.
    const b13 = sahteBot()
    let sudayim = true
    b13.blockAt = () => ({
      name: sudayim ? 'water' : 'stone',
      boundingBox: sudayim ? 'empty' : 'block',
      position: new Vec3(0, 0, 0)
    })
    const basilan = []
    b13.setControlState = (ad, deger) => {
      if (ad === 'jump' && deger) { basilan.push(ad); sudayim = false }
    }
    const e13 = new MinecraftEnvironment(b13, { zamanCarpani: 0, gorev: 'maden' })
    await e13.reset()
    if (!basilan.includes('jump')) throw new Error('maden gorevinde sudan cikmayi denemedi')
  })

  await dene('kazma verilemezse GURULTULU hata (sessiz basarisizlik yok)', async () => {
    // `/give` op yetkisi ister ve sessizce basarisiz olur. Kazmasiz bot
    // cevheri kiriyor ama HICBIR SEY DUSMUYOR: olcumde %63 "onumde cevher
    // var" ve 0 kaynak gorduk. Sessiz basarisizlik en pahali hata turu.
    const log = require('../bot/utils/log')
    const orjinal = log.hata
    const hatalar = []
    log.hata = (...a) => hatalar.push(a.join(' '))
    try {
      const b13 = sahteBot()
      b13.inventory = { items: () => [] } // /give calismiyor: hep bos
      const e13 = new MinecraftEnvironment(b13, { zamanCarpani: 0, gorev: 'maden' })
      await e13.yeraltiKurulumu()
    } finally {
      log.hata = orjinal
    }
    if (!hatalar.some((h) => /op de[gğ]il|iron_pickaxe/.test(h))) {
      throw new Error(`kazma verilemedi ama uyarmadi. hatalar: ${hatalar.join(' | ')}`)
    }
  })

  await dene('maden reset() inisi SINIRLIYOR (soket zaman asimi olmasin)', async () => {
    // Gercek hata: y=70'ten y=15'e inmek ~55 basamak x 3 blok = dakikalar.
    // Python soketi 60 sn'de zaman asimina ugradi ve egitim dustu.
    // Reset dakikalarca bloke olmamali; inis bolumlere yayilmali.
    const b14 = sahteBot()
    b14.entity.position = new Vec3(0, 70, 0)
    b14.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b14.canDigBlock = () => true
    let kazilan = 0
    b14.dig = async () => { kazilan++ }
    b14.blockAt = (p) => {
      const y = Math.floor(p.y)
      const dolu = y < 70
      return { name: dolu ? 'stone' : 'air', boundingBox: dolu ? 'block' : 'empty', position: new Vec3(0, y, 0) }
    }

    const e14 = new MinecraftEnvironment(b14, { zamanCarpani: 0, gorev: 'maden' })
    await e14.yeraltiKurulumu()

    // 12 basamak x 3 blok = 36. Sinir yoksa 55 basamak x 3 = 165 olurdu.
    if (kazilan > 60) throw new Error(`${kazilan} blok kazdi — inis sinirlanmamis`)
  })

  await dene('uzman ULASILAMAYAN esyayi sonsuza kadar kovalamiyor', async () => {
    // Olcum: maden gorevinde adimlarin %79'u "yakindaki cevheri
    // aliyorum"du -- kiriyor, yuruyor, donuyor, ama esya envantere hic
    // girmiyordu. Kirdigi deligin icine dusmus, ulasilamayan bir esya
    // uzmani bolumun TAMAMI boyunca mesgul ediyordu.
    const uzman = require('../bot/bridge/expert')
    const b15 = sahteBot()
    const e15 = new MinecraftEnvironment(b15, { zamanCarpani: 0, gorev: 'maden' })
    b15.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b15.canDigBlock = () => true
    b15.blockAt = () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) })
    // ULASILAMAYAN esya: hep orada, hic toplanmiyor
    b15.entities = {
      1: { name: 'item', isValid: true, position: new Vec3(2, 64, 2) }
    }

    let esyaAdimi = 0
    for (let i = 0; i < 60; i++) {
      const karar = uzman.uzmanAksiyonu(b15, e15)
      if (/yakin_cevheri/.test(karar.sebep)) esyaAdimi++
    }
    if (esyaAdimi >= 60) throw new Error('60 adim boyunca ayni esyayi kovaladi')
    if (esyaAdimi > 30) throw new Error(`${esyaAdimi} adim kovaladi — sabir sayaci calismiyor`)
  })

  await dene('TAS kazmayla elmas hedef sayilmiyor (yok etmesin)', () => {
    // uygunAlet "elinde kazma var mi" der, "bu cevher icin YETER MI"
    // demez. Tas kazmayla elmasa vurmak elmasi YOK EDIYOR.
    const g = require('../bot/bridge/gorevler')
    const b16 = sahteBot()
    b16.inventory = { items: () => [{ name: 'stone_pickaxe', maxDurability: 131, durabilityUsed: 0 }] }

    if (g.GOREVLER.maden.dogalMi(b16, { name: 'diamond_ore' })) {
      throw new Error('tas kazmayla elmasi hedef saydi')
    }
    if (!g.GOREVLER.maden.dogalMi(b16, { name: 'iron_ore' })) {
      throw new Error('tas kazmayla demiri hedef saymadi (oysa yeterli)')
    }
  })

  await dene('KIRILMIS kazma hedef birakmiyor', () => {
    const g = require('../bot/bridge/gorevler')
    const b16 = sahteBot()
    // Dayanikligi bitmis kazma
    b16.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 250 }] }
    if (g.GOREVLER.maden.dogalMi(b16, { name: 'iron_ore' })) {
      throw new Error('kirilmis kazmayla cevheri hedef saydi')
    }
  })

  await dene('step() kazma kirilinca YENISINI istiyor', async () => {
    // Demir kazma 250 vurus, bolum 500 adim: kirilmasi istisna degil,
    // BEKLENEN durum. Kirildiktan sonra her vurus bir cevheri yok eder.
    const b16 = sahteBot()
    const komutlar = []
    b16.chat = (m) => komutlar.push(m)
    b16.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 250 }] }
    const e16 = new MinecraftEnvironment(b16, { zamanCarpani: 0, gorev: 'maden' })
    await e16.step(3) // kirma aksiyonu
    if (!komutlar.some((m) => /give .*iron_pickaxe/.test(m))) {
      throw new Error(`kirilmis kazma icin yenisi istenmedi: ${komutlar.join(' | ')}`)
    }
  })

  await dene('maden tukenince TAZE BOLGEYE isinlaniyor', async () => {
    // 40 bolumluk demo toplamada ilk 18 bolum iyiydi (8, 6, 22, 12
    // cevher), sonra 19-35 arasi neredeyse tamamen SIFIR. Bot bolgenin
    // cevherini bitirmisti. Odun gorevinde bunu spreadplayers ile
    // cozmustuk ama o komut oyuncuyu YUZEYE koyuyor -- madende ise yaramaz.
    const b17 = sahteBot()
    b17.entity.position = new Vec3(0, 15, 0) // zaten derinlikte
    b17.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 0, type: 1 }] }
    const komutlar = []
    b17.chat = (m) => komutlar.push(m)
    b17.findBlocks = () => [] // HIC CEVHER YOK: bolge tukenmis

    const e17 = new MinecraftEnvironment(b17, { zamanCarpani: 0, gorev: 'maden' })
    await e17.yeraltiKurulumu()

    if (!komutlar.some((m) => /^\/tp /.test(m))) {
      throw new Error(`taze bolgeye isinlanmadi: ${komutlar.join(' | ')}`)
    }
    // Isinlanmadan ONCE cep acilmali, yoksa bot tasin icinde bogulur
    const fillIndex = komutlar.findIndex((m) => /^\/fill /.test(m))
    const tpIndex = komutlar.findIndex((m) => /^\/tp /.test(m))
    if (fillIndex < 0) throw new Error('cep acilmadi — bot tasin icine isinlanir')
    if (fillIndex > tpIndex) throw new Error('once isinlanip sonra cep acti — bogulma sirasi')
  })

  await dene('DIKEY hedefte donmuyor (yaw anlamsiz)', () => {
    // Olcum: adimlarin %76'si donus, %10 yurume, 13/15 bolum SIFIR.
    // Sebep: hedefYaw sadece dx,dz'ye bakiyor. Cevher neredeyse tam
    // tepemizdeyse dx ve dz sifira yakin -- bir bloktan kucuk bir
    // kipirdanma aciyi 180 derece ceviriyor ve bot sonsuza kadar donuyor.
    const uzman = require('../bot/bridge/expert')
    const b18 = sahteBot()
    b18.entity.position = new Vec3(0.5, 15, 0.5)
    b18.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 0, type: 1 }] }
    b18.canDigBlock = () => true
    b18.registry = { blocksByName: { iron_ore: { id: 1 } } }

    // Cevher NEREDEYSE tepede: yatay uzaklik 1.4 blok, 4 blok yukarida.
    // Tam tepede degil -- oyle olsaydi aci sifir cikar ve test hicbir sey
    // kanitlamazdi. Asil tehlikeli durum bu: aci hesaplanabiliyor ama
    // ANLAMSIZ, cunku bir blokluk kipirdanma onu 180 derece ceviriyor.
    b18.findBlocks = () => [new Vec3(1, 19, 1)]
    b18.blockAt = (p) => {
      const x = Math.floor(p.x); const y = Math.floor(p.y); const z = Math.floor(p.z)
      if (x === 1 && z === 1 && y === 19) {
        return { name: 'iron_ore', boundingBox: 'block', position: new Vec3(x, y, z) }
      }
      return { name: 'stone', boundingBox: 'block', position: new Vec3(x, y, z) }
    }

    const e18 = new MinecraftEnvironment(b18, { zamanCarpani: 0, gorev: 'maden' })
    const karar = uzman.uzmanAksiyonu(b18, e18)
    if (karar.action === 1 || karar.action === 2) {
      throw new Error(`dikey hedefte dondu (${karar.sebep}) — yaw anlamsiz`)
    }
  })

  await dene('maden ULASILABILIR hedefi seciyor (dikey pahali)', () => {
    // Kus ucusu mesafe madende YANLIS olcu. Ajanin aksiyonlari yatay:
    // ileri, saga, sola. Yukari cikmak icin altina blok koymak ya da
    // tavani kirip ziplamak gerekiyor -- ikisi de aksiyon uzayinda yok.
    // 8 blok TAM YUKARIDAKI cevher, 12 blok otedeki acik tunelin
    // ucundakinden "daha yakin" sayiliyordu.
    const g = require('../bot/bridge/gorevler')
    const b19 = sahteBot()
    b19.entity.position = new Vec3(0, 15, 0)

    const yukarida = new Vec3(0, 23, 0)   // 8 blok yukari
    const ileride = new Vec3(12, 15, 0)   // 12 blok ileri, ayni seviye

    const m = g.GOREVLER.maden.hedefMaliyeti
    if (!(m(b19, ileride) < m(b19, yukarida))) {
      throw new Error(`ileri ${m(b19, ileride).toFixed(1)} vs yukari ${m(b19, yukarida).toFixed(1)} — dikey ucuz kaldi`)
    }

    // Odun gorevinde kus ucusu mesafe DOGRU olcu, degismemeli
    const o = g.GOREVLER.odun.hedefMaliyeti
    if (!(o(b19, yukarida) < o(b19, ileride))) {
      throw new Error('odun gorevinin olcusu degismis')
    }
  })

  await dene('madende bolum basinda pathfinder TUNEL KAZMIYOR', async () => {
    // baslangicaTasi() pathfinder ile hedefe yaklasiyor ve pathfinder
    // canDig:true -- yani tasin icinden TUNEL KAZARAK gidiyor. Ormanda
    // masum (acik arazide yurumek gorev degil), madende GOREVIN KENDISI.
    // Ortam ajan adina tuneli kazip onu cevherin dibine birakirdi.
    const g = require('../bot/bridge/gorevler')
    if (g.GOREVLER.maden.baslangictaYurut !== false) {
      throw new Error('maden gorevinde baslangic yurutmesi acik')
    }
    if (g.GOREVLER.odun.baslangictaYurut === false) {
      throw new Error('odun gorevinde baslangic yurutmesi kapanmis')
    }

    // Ortam bayragi gercekten okuyor mu?
    const b19 = sahteBot()
    b19.entity.position = new Vec3(0, 15, 0)
    b19.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 0, type: 1 }] }
    const e19 = new MinecraftEnvironment(b19, { zamanCarpani: 0, gorev: 'maden' })
    let yurudu = false
    e19.baslangicaTasi = async () => { yurudu = true; return false }
    await e19.reset()
    if (yurudu) throw new Error('maden gorevinde baslangicaTasi cagrildi')
  })

  await dene('maden gorevi envanteri TAMAMEN bosaltiyor', async () => {
    // Gercek olay: madende temizleme etiketi yoktu, envanter bolumden
    // bolume doldu. 36 slot dolunca `/give iron_pickaxe` sunucu tarafinda
    // BASARILI oluyor ("Gave 1 [Iron Pickaxe]") ama esya envantere
    // giremiyor. Kazmasiz bot cevheri yok ediyor.
    const b20 = sahteBot()
    const komutlar = []
    b20.chat = (m) => komutlar.push(m)
    const e20 = new MinecraftEnvironment(b20, { zamanCarpani: 0, gorev: 'maden' })
    await e20.reset()

    const temizle = komutlar.findIndex((m) => /^\/clear \S+$/.test(m))
    if (temizle < 0) throw new Error(`envanter temizlenmedi: ${komutlar.join(' | ')}`)

    // SIRA KRITIK: temizlik kazmadan ONCE olmali, yoksa verilen kazma silinir
    const kazma = komutlar.findIndex((m) => /give .*iron_pickaxe/.test(m))
    if (kazma >= 0 && temizle > kazma) {
      throw new Error('once kazma verildi sonra envanter silindi — kazma yok olur')
    }
  })

  await dene('odun gorevi SADECE kutukleri siliyor (baltasi kalsin)', async () => {
    const b20 = sahteBot()
    const komutlar = []
    b20.chat = (m) => komutlar.push(m)
    const e20 = new MinecraftEnvironment(b20, { zamanCarpani: 0 })
    await e20.reset()
    if (komutlar.some((m) => /^\/clear \S+$/.test(m))) {
      throw new Error('odun gorevinde envanterin TAMAMI silindi — balta gider')
    }
    if (!komutlar.some((m) => /clear .*minecraft:logs/.test(m))) {
      throw new Error('kutukler silinmedi')
    }
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

  console.log('\nUlasilabilirlik (PPO cokusunun sebebi)')

  await dene('madende arama yaricapi ORMANDAN kucuk', () => {
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const eOdun = new MinecraftEnvironment(sahteBot(), { zamanCarpani: 0 })
    const eMaden = new MinecraftEnvironment(sahteBot(), { zamanCarpani: 0, gorev: 'maden' })

    // Neden onemli: `findBlocks` DUVARIN ARDINI da goruyor. y=15'te 64 blok
    // yaricapinda her zaman bir cevher vardir -- tasin 40 blok gerisinde.
    // Ortam "hedef var" dedigi icin `tazeMadeneIsinla` hic calismiyor ve
    // ajan her bolumu ulasamayacagi bir cevhere tunel kazarak geciriyordu.
    // Egitimde 1. bolum 5 cevher aldi, 2-18 arasi HEPSI sifir.
    if (!(eMaden.yaricap < eOdun.yaricap)) {
      throw new Error(`maden yaricapi ${eMaden.yaricap}, odun ${eOdun.yaricap} -- kucuk degil`)
    }
    if (eMaden.yaricap > 24) {
      throw new Error(`maden yaricapi ${eMaden.yaricap}: bir bolumde tunelle asilamaz`)
    }
  })

  await dene('gozlem mesafesi AYNI yaricapla normalize ediliyor', () => {
    // Hedef secimi bir yaricap, gozlem normalizasyonu baska bir yaricap
    // kullanirsa gozlem olcegi gorevden goreve kayar ve onceden egitilmis
    // ag anlamsiz girdi gorur. Bu sessizce olur -- kod calisir, ajan aptallasir.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.entity.position = new Vec3(0, 15, 0)
    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })

    // Yaricapin TAM UCUNDA bir cevher: normalize mesafe 1.0 olmali
    const uzak = new Vec3(env.yaricap, 15, 0)
    b.findBlocks = () => [uzak]
    b.blockAt = (pos) => {
      if (Math.floor(pos.x) === env.yaricap && Math.floor(pos.y) === 15 && Math.floor(pos.z) === 0) {
        return { name: 'iron_ore', boundingBox: 'block', position: uzak }
      }
      return { name: 'air', boundingBox: 'empty', position: new Vec3(0, 0, 0) }
    }
    const mesafe = env.gozlem()[3]
    if (Math.abs(mesafe - 1) > 0.02) {
      throw new Error(`yaricapin ucundaki hedef ${mesafe.toFixed(2)} olarak normalize edildi, 1.00 bekleniyordu`)
    }
  })

  await dene('DIKEY ulasilamaz hedefi UZMAN OLMADAN da birakiyor', async () => {
    // PPO cokusunun ikinci sebebi. "Ulasilamaz hedefi birak" mantigi
    // sadece expert.js'teydi; PPO direksiyona gecince kimse cagirmadi ve
    // ajan bolumun tamamini tam tepesindeki bir cevhere kilitli gecirdi.
    // Ortamin kendi `HEDEF_SABIR`i (20 adim) cok yavas: yerinde sayma
    // kesme esigi 60 adim, yani uc kotu hedef bolumun tamamini yiyor.
    //
    // Bu test UZMANI HIC CAGIRMIYOR -- sabit bir aksiyon dizisi suruyor.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.entity.position = new Vec3(0.5, 15, 0.5)
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.canDigBlock = () => false // menzilde kiracak hicbir sey yok

    // Cevher TAM TEPEMIZDE (yatay mesafe 0), aksiyon uzayinda yukari yok
    const cevher = new Vec3(0, 21, 0)
    b.findBlocks = () => [cevher]
    b.blockAt = (pos) => {
      const x = Math.floor(pos.x); const y = Math.floor(pos.y); const z = Math.floor(pos.z)
      if (x === 0 && y === 21 && z === 0) {
        return { name: 'iron_ore', boundingBox: 'block', position: cevher }
      }
      return { name: 'air', boundingBox: 'empty', position: new Vec3(x, y, z) }
    }

    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })
    if (!env.enYakinKutuk()) throw new Error('test kurulumu bozuk: hedef secilmedi')

    // "Sola don" -- ajanin yapabilecegi ama bu hedefte ise yaramayan sey
    for (let i = 0; i < 8; i++) await env.step(1)

    if (!env.karaListe.has('0,21,0')) {
      throw new Error('8 adim sonra ulasilamaz dikey hedef hala kara listede degil')
    }
  })

  await dene('tazeMadeneIsinla() cevher bulana kadar TEKRAR deniyor', async () => {
    // Arama yaricapi 16'ya inince rastgele bir noktanin yakininda hic
    // cevher OLMAMASI mumkun hale geldi. Tek atislik isinlanma hedefsiz
    // bolum uretiyor; hedefsiz bolum PPO icin saf gurultu.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.entity.position = new Vec3(0, 15, 0)
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }

    let isinlanma = 0
    b.chat = (mesaj) => { if (/^\/tp /.test(mesaj)) isinlanma++ }
    // Ilk iki isinlanmada cevher YOK, ucuncude var
    b.findBlocks = () => (isinlanma >= 3 ? [new Vec3(3, 15, 0)] : [])
    b.blockAt = (pos) => {
      const x = Math.floor(pos.x); const y = Math.floor(pos.y); const z = Math.floor(pos.z)
      if (isinlanma >= 3 && x === 3 && y === 15 && z === 0) {
        return { name: 'iron_ore', boundingBox: 'block', position: new Vec3(3, 15, 0) }
      }
      return { name: 'stone', boundingBox: 'block', position: new Vec3(x, y, z) }
    }

    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })
    const bulundu = await env.tazeMadeneIsinla()
    if (!bulundu) throw new Error(`${isinlanma} isinlanmadan sonra pes etti`)
    if (isinlanma < 3) throw new Error('tek atisllik: tekrar denemedi')
  })

  console.log('\nAlet secimi (madenin 4 bolumu bunun yuzunden bosa gitti)')

  await dene('aletTipi() OYUNUN VERISIYLE uyusuyor (elle liste tutmuyoruz)', () => {
    // Gercek hata: `aletTipi` elle yazilmis bir regex listesiydi ve
    // 1.20.4'te 439 blogu kaciriyordu -- `tuff`, `calcite`,
    // `smooth_basalt`, `amethyst_block`, `dripstone_block` dahil.
    // Bunlar y=15 magaralarinda HER YERDE. Bot birine bakinca "kiracak
    // aletim yok" deyip sonsuza kadar etrafindan dolasmaya calisti:
    // uzman 4 bolumde HIC kirma yapmadi, 0 kaynak topladi.
    //
    // Bu test elle liste tutmayi imkansiz kiliyor: oyunun kendi
    // `material` alaniyla karsilastiriyor.
    const { aletTipi } = require('../bot/skills/alet')
    const mcData = require('minecraft-data')('1.20.4')

    const kacirilan = []
    for (const b of Object.values(mcData.blocksByName)) {
      if (!b.diggable || !b.material) continue
      const m = /^mineable\/(pickaxe|axe|shovel)$/.exec(b.material)
      if (!m) continue
      if (aletTipi(b) !== '_' + m[1]) kacirilan.push(b.name)
    }
    if (kacirilan.length > 0) {
      throw new Error(
        `${kacirilan.length} blok icin yanlis alet: ${kacirilan.slice(0, 5).join(', ')}...`)
    }
  })

  await dene('madende TUFF/CALCITE yolu kapatamiyor (kazma varken)', () => {
    // Yukaridaki testin somut hali: kazmasi olan bot y=15'in en sik
    // bloklarini kirabilmeli. Kirilamiyorsa bolum dolasmakla geciyor.
    const g = require('../bot/bridge/gorevler')
    const mcData = require('minecraft-data')('1.20.4')
    const b = sahteBot()
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }

    for (const ad of ['tuff', 'calcite', 'smooth_basalt', 'dripstone_block',
      'amethyst_block', 'deepslate', 'stone', 'andesite']) {
      const veri = mcData.blocksByName[ad]
      const blok = { name: ad, material: veri.material, boundingBox: 'block' }
      if (!g.GOREVLER.maden.engelKirilabilirMi(b, blok)) {
        throw new Error(`kazma elindeyken ${ad} kirilamaz sayildi`)
      }
    }
  })

  await dene('uzman KIRAMADIGI blogun adini gerekcesine yaziyor', () => {
    // Olculebilirlik testi. Bu dal bir kez maden gorevinin tamamini yedi
    // ve gerekce sadece "engel_soldan_dolasiyorum" dedigi icin sebebi
    // bulmak iki tur surdu. Artik gorev_kontrol dagiliminda blogun adi
    // gorunuyor: "kiramadigim_tuff".
    const uzman = require('../bot/bridge/expert')
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    const e = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })
    // Kazma YOK -> tas kirilamaz -> dolasma dalina duser
    b.inventory = { items: () => [] }
    b.blockAt = () => ({ name: 'tuff', material: 'mineable/pickaxe', boundingBox: 'block', position: new Vec3(0, 0, 0) })

    const karar = uzman.hedefeYonel(b, e, new Vec3(0, 64, -5), 'cevhere')
    if (!/kiramadigim_tuff/.test(karar.sebep)) {
      throw new Error(`engelin adi gerekcede yok: ${karar.sebep}`)
    }
  })

  console.log('\nGorus hatti ve on nokta sirasi')

  await dene('DUVARIN ARDINDAKI cevheri menzilde saymiyor', () => {
    // Gercek olay (ekran goruntusu): bot tasin ARDINDAKI cevheri kirdi.
    // Mineflayer'in `canDigBlock`u sadece mesafeye bakiyor, gorus hattina
    // bakmiyor -- sunucu da kabul ediyor. Kirilan cevher duvarin arkasina
    // dusuyor ve bot ona ulasamiyor: "kirma" odulu aliniyor ama envantere
    // HICBIR SEY girmiyor. Olcumdeki 0 kaynagin sebebi bu.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.entity.position = new Vec3(0.5, 15, 0.5)
    b.entity.yaw = 0 // -z yonune bakiyor
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }

    const cevher = new Vec3(0, 15, -3) // tam onumuzde, 3 blok oteda
    b.findBlocks = () => [cevher]
    b.blockAt = (pos) => {
      const x = Math.floor(pos.x); const y = Math.floor(pos.y); const z = Math.floor(pos.z)
      if (x === 0 && y === 15 && z === -3) {
        return { name: 'iron_ore', material: 'mineable/pickaxe', boundingBox: 'block', position: cevher }
      }
      return { name: 'stone', material: 'mineable/pickaxe', boundingBox: 'block', position: new Vec3(x, y, z) }
    }

    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })

    // Gorus ACIK: menzilde sayilmali
    b.canSeeBlock = () => true
    if (!env.onundekiKutuk()) throw new Error('gorus acikken cevheri menzilde saymadi')

    // Gorus KAPALI (arada duvar var): menzilde SAYILMAMALI
    b.canSeeBlock = () => false
    if (env.onundekiKutuk()) throw new Error('duvarin ardindaki cevheri menzilde saydi')
  })

  await dene('onumdeki noktalar ORTADAN basliyor (caprazdan degil)', () => {
    // Gercek olay: bot hep SOL CAPRAZDAKI blogu kiriyor, ortadaki blok
    // yerinde kaliyor, ileri basiyor ama gecemiyor. Sebep sadece sira:
    // `onumuKapatan()` buldugu ILK blogu donduruyor ve ornekleme
    // `[-0.35, 0, 0.35]` diye basliyordu.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.entity.position = new Vec3(0.5, 15, 0.5)
    b.entity.yaw = 0
    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })

    const noktalar = env.onumdekiNoktalar(0.8, [0.1])
    const yan = new Vec3(-Math.cos(0), 0, Math.sin(0))
    // Ilk nokta yanal kaymasi SIFIR olmali
    const kayma = (noktalar[0].x - b.entity.position.x) * yan.x +
                  (noktalar[0].z - b.entity.position.z) * yan.z
    if (Math.abs(kayma) > 0.01) {
      throw new Error(`ilk ornek nokta ortada degil, yanal kayma ${kayma.toFixed(2)}`)
    }
  })

  await dene('ONCE ortadaki blogu kiriyor, caprazdakini degil', () => {
    // Yukaridaki testin davranissal hali: hem ortada hem sol caprazda
    // kirilabilir blok varsa `onumuKapatan()` ORTADAKINI secmeli.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    // BOT BLOGUN KENARINDA DURMALI.
    //
    // Ilk yazisimda botu blogun TAM ORTASINA (x=0.5) koymustum ve test
    // ayirt etmiyordu: 0.35 yanal kayma orada hala AYNI bloga dusuyor,
    // yani ucu de x=0. Ayni hatayi capraz-yaprak testinde de yapmistim.
    // x=0.8'de ornekler [orta=0, sol=1, sag=0] bloklarina dagiliyor.
    b.entity.position = new Vec3(0.8, 15, 0.5)
    b.entity.yaw = 0 // -z
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.canDigBlock = () => true
    b.blockAt = (pos) => {
      const x = Math.floor(pos.x); const y = Math.floor(pos.y); const z = Math.floor(pos.z)
      // Orta: x=0, sol capraz: x=1 (ikisi de dolu)
      if (z <= 0 && (x === 0 || x === 1)) {
        return { name: 'stone', material: 'mineable/pickaxe', boundingBox: 'block', position: new Vec3(x, y, z) }
      }
      return { name: 'air', boundingBox: 'empty', position: new Vec3(x, y, z) }
    }

    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })
    const kapatan = env.onumuKapatan()
    if (!kapatan) throw new Error('onumu kapatan blogu hic bulamadi')
    if (kapatan.position.x !== 0) {
      throw new Error(`caprazdakini (x=${kapatan.position.x}) sectiledi, ortadakini (x=0) degil`)
    }
  })

  console.log('\nGozlem boyutu (Node <-> Python sozlesmesi)')

  await dene('gozlem boyutlari env.py ile ayni (odun 16, maden 20)', () => {
    // Node ile Python arasindaki tek sozlesme bu sayi. Uyusmazsa Python
    // tarafi calisma aninda patliyor -- ama ancak Minecraft'a baglandiktan
    // SONRA, yani kullanici oyunu ve sunucuyu actiktan sonra. Burada
    // bir saniyede yakalaniyor.
    //
    // Maden 4 sayi fazla aliyor: dusmus esyanin egosentrik yonu ve
    // mesafesi + "onumu kapatan blogu kirabiliyor muyum". Bunlar olmadan
    // taklit dogrulugu %25.5 cikti (kor tahmin %25).
    // Odun 16'da BIRAKILDI: Milestone 4'un kayitli modelleri 19 boyutlu
    // girdi bekliyor.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const beklenen = { odun: 16, maden: 20 }

    for (const [gorev, n] of Object.entries(beklenen)) {
      const b = sahteBot()
      b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
      const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev })
      const gozlem = env.gozlem()
      if (gozlem.length !== n) {
        throw new Error(`${gorev}: gozlem ${gozlem.length} sayi, beklenen ${n}`)
      }
      if (gozlem.some((x) => typeof x !== 'number' || Number.isNaN(x))) {
        throw new Error(`${gorev}: gozlemde sayi olmayan/NaN deger var`)
      }
    }

    // env.py'deki tablo ile karsilastir -- iki dosya birlikte degismeli
    const kaynak = fs.readFileSync(
      path.join(__dirname, '..', 'python', 'minecrai', 'env.py'), 'utf8')
    const m = /HAM_BOYUTLARI = \{"odun": (\d+), "maden": (\d+)\}/.exec(kaynak)
    if (!m) throw new Error('env.py icinde HAM_BOYUTLARI tablosu bulunamadi')
    if (Number(m[1]) !== beklenen.odun || Number(m[2]) !== beklenen.maden) {
      throw new Error(
        `env.py odun=${m[1]} maden=${m[2]} diyor, environment.js ` +
        `odun=${beklenen.odun} maden=${beklenen.maden} uretiyor`)
    }
  })

  await dene('maden gozlemi ESYA yonunu gercekten tasiyor', () => {
    // Testin ayirt edici olmasi icin: esya varken ve yokken gozlemin
    // FARKLI olmasi gerek. Sadece uzunluga bakmak sahte bir guvence olurdu
    // -- dort sifir eklemek de uzunlugu tutturur.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.entity.position = new Vec3(0, 15, 0)
    b.entity.yaw = 0 // -z yonune bakiyor
    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })

    const esyasiz = env.gozlem()

    // Esya SOLDA olsun (+x, bot -z'ye bakarken sol taraf)
    b.entities = {
      1: { name: 'item', position: new Vec3(3, 15, 0), objectType: 'Item' }
    }
    const solda = env.gozlem()

    if (esyasiz[16] === solda[16] && esyasiz[17] === solda[17]) {
      throw new Error('esya varken de yokken de gozlem ayni -- esya bilgisi tasinmiyor')
    }
    if (Math.abs(solda[16]) < 0.5) {
      throw new Error(`esya tam yanda ama sin(aci)=${solda[16].toFixed(2)} (buyuk olmali)`)
    }
  })

  console.log(hata === 0 ? '\n=== HEPSI GECTI ===' : `\n=== ${hata} HATA ===`)
  process.exit(hata === 0 ? 0 : 1)
}

main().catch((e) => { console.error('TEST COKTU:', e.message); process.exit(1) })
