// Smoke test. No Minecraft needed, takes about a second.
//
// `node -e "require(...)"` only catches syntax errors. Runtime errors like
// "bot is not defined" only appear when the code runs, and the first one
// appeared during data collection -- after the user had already started a
// 40-episode job.
//
// Runs every critical path once against a fake bot object.
// After changing code:  node test/smoke.js
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
    // Default: line of sight is clear. The through-wall test overrides this.
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
    // Event listeners: the environment subscribes to 'death'
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
    // From a real training log: 455 steps, 0 wood, -4.53 reward. The agent
    // was buried in leaves at the top of a tree.
    //
    // The detail that matters: the bot is not frozen, it keeps twitching.
    // `durgunlukSayaci` watches the change in distance to the target and
    // resets on the smallest movement, so it never filled up over 455 steps.
    // The fake bot here does the same: half a block left and right every
    // step, going nowhere.
    const b3 = sahteBot()
    b3.entity.position = new Vec3(0, 64, 0)

    // Unreachable tree: a target exists, so approach still gets computed
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

    // Twitch half a block each step, with no net displacement
    let salinim = 0
    b3.look = async () => {
      salinim++
      b3.entity.position = new Vec3(salinim % 2 === 0 ? 0 : 0.6, 64, 0)
    }

    let sonuc = null
    for (let i = 0; i < 200; i++) {
      sonuc = await e3.step(1) // turn right: the bot twitches but does not move
      if (sonuc.truncated || sonuc.terminated) break
    }
    if (!sonuc.truncated) throw new Error('200 adim yerinde saydi, bolum bitmedi')
    if (e3.adim > 100) throw new Error(`${e3.adim} adim surdu — ~60'ta bitmeliydi`)
  })

  await dene('suyunIcindeMi() suyu taniyor', async () => {
    // Real run: the bot drowned, then 50+ episodes in a row ended with
    // "0 wood, 60 steps, -0.60". Swimming is not in the action space, so
    // once it falls in water there is nothing it can do. Punishing it for a
    // state it cannot learn out of is noise, not learning; the environment
    // has to fix it.
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
    // Real run: the bot fell into a cave and could not get out. The old
    // check looked only 5 blocks up; with the ceiling 20 blocks up it
    // reported open sky and rescue never fired, 40 blocks underground.
    // The question is not "is there a ceiling near me" but "is it open all
    // the way up".
    const b5 = sahteBot()
    const e5 = new MinecraftEnvironment(b5, { zamanCarpani: 0 })
    b5.entity.position = new Vec3(0, 20, 0)

    // Big cave: 20 blocks of air, then a ceiling
    b5.blockAt = (p) => {
      const y = Math.floor(p.y)
      const dolu = y >= 42 // ceiling far above
      return { name: dolu ? 'stone' : 'air', boundingBox: dolu ? 'block' : 'empty', position: p }
    }
    if (e5.acikHavadaMi()) throw new Error('magarada gokyuzu gordu')

    // Real surface: open all the way up
    b5.blockAt = (p) => ({ name: 'air', boundingBox: 'empty', position: p })
    if (!e5.acikHavadaMi()) throw new Error('acik havada tavan gordu')
  })

  await dene('CAPRAZDAKI yapragi goruyor ve kirabiliyor', async () => {
    // Seen in game: leaves on the front-left and front-right diagonals,
    // dead centre clear. The sensor said the path was clear, the agent
    // pushed forward, the game would not let it through. Both the obstacle
    // sensor and "block in front of me" sampled a single point, straight
    // ahead through the centre, while the player hitbox is 0.6 blocks wide.
    const b6 = sahteBot()
    const e6 = new MinecraftEnvironment(b6, { zamanCarpani: 0 })
    // Bot stands at the edge of a block, not its centre: x=0.9 puts the
    // hitbox (0.6..1.2) across two block columns. That is the normal case
    // in Minecraft; the agent is rarely dead centre.
    b6.entity.position = new Vec3(0.9, 64, 0.5)
    b6.entity.yaw = 0 // forward = -z
    b6.canDigBlock = () => true

    // Leaves only in the x=1 column. The straight-ahead ray (x=0) sees air,
    // but the hitbox spills into x=1 so the bot cannot pass.
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
    // Jumping over and over with nothing to show for it: leaves right above
    // the head block the jump. Overhead counts as an obstacle too.
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
    // Water escape only ran at episode start, so falling in mid-episode
    // still drowned the bot -- which happened during npm run bridge.
    // Swimming is not in the action space, so the environment has to
    // prevent a death the agent cannot act on.
    const b7 = sahteBot()
    const e7 = new MinecraftEnvironment(b7, { zamanCarpani: 0 })
    b7.blockAt = () => ({ name: 'water', boundingBox: 'empty', position: new Vec3(0, 0, 0) })

    const basilan = []
    b7.setControlState = (ad, deger) => { if (deger) basilan.push(ad) }

    await e7.step(4) // "wait" action: the agent does nothing
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
    // Breaking ore with the wrong pickaxe destroys it. What the agent has
    // to learn is "find ore and break it"; tooling is a separate problem.
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
    // The wood task clears the inventory, mining does not
    if (!komutlar.some((m) => /clear .*minecraft:logs/.test(m))) {
      throw new Error('odun gorevi envanteri temizlemedi')
    }
  })

  await dene('maden gorevi YUZEYE CIKMAYA calismiyor', async () => {
    // The two setups run opposite ways: wood goes up, mining goes down.
    // Teleporting to the surface on the mining task ruins the episode.
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
    // The wood expert waits when it has no target, and that is right in a
    // forest: no visible tree means nothing to chop. Mining is the reverse
    // -- ore is buried in stone, so seeing none is normal. Waiting would
    // make the whole imitation dataset "wait" and teach the agent nothing.
    const uzman = require('../bot/bridge/expert')
    const b10 = sahteBot()
    const e10 = new MinecraftEnvironment(b10, { zamanCarpani: 0, gorev: 'maden' })

    // No ore, no items, stone everywhere
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

    // Wood: leave stone alone (mining it by hand takes minutes and is off-task)
    if (g.GOREVLER.odun.engelKirilabilirMi(b10, tas)) throw new Error('odun gorevinde tas kirilabilir sayildi')
    if (!g.GOREVLER.odun.engelKirilabilirMi(b10, yaprak)) throw new Error('yapragi kiramadi')

    // Mining: breaking stone is the task itself
    if (!g.GOREVLER.maden.engelKirilabilirMi(b10, tas)) throw new Error('madende tas kirilamaz sayildi')
    const lav = { name: 'lava', boundingBox: 'block' }
    if (g.GOREVLER.maden.engelKirilabilirMi(b10, lav)) throw new Error('lavi kirilabilir saydi')
  })

  await dene('uzman engeli KIRIYOR, sonsuza kadar dolasmiyor', () => {
    // Measured: 43% of steps were "turning to target", 31% "going around an
    // obstacle", only 3% walking. A two-step loop:
    //   align -> blocked ahead -> sidestep left (no longer aligned)
    //   -> turn back to target -> blocked ahead -> sidestep left -> ...
    // Neither episode collected a single resource.
    const uzman = require('../bot/bridge/expert')
    const b11 = sahteBot()
    const e11 = new MinecraftEnvironment(b11, { zamanCarpani: 0, gorev: 'maden' })
    b11.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b11.canDigBlock = () => true
    // Stone everywhere: aligned or not, the way ahead is blocked
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
    // Unbreakable obstacle (stone is off-limits on the wood task) -> must go around
    b11.blockAt = () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) })

    const ilk = uzman.hedefeYonel(b11, e11, new Vec3(0, 64, -5), 'test')
    if (!/dolasiyorum/.test(ilk.sebep)) throw new Error(`dolasmadi: ${ilk.sebep}`)
    if (e11.kacinmaAdimi <= 0) throw new Error('kacinma sayaci kurulmadi')

    // Once the way clears it should walk in avoid mode, not turn back to the target
    b11.blockAt = () => ({ name: 'air', boundingBox: 'empty', position: new Vec3(0, 0, 0) })
    const ikinci = uzman.hedefeYonel(b11, e11, new Vec3(0, 64, -5), 'test')
    if (ikinci.action !== 0) throw new Error(`kacinirken yurumedi: ${ikinci.sebep}`)
  })

  await dene('maden kurulumu YUZEYDE cevher gorse bile iniyor', async () => {
    // Real bug: the code said there was no need to descend if ore was
    // already visible. Ore is visible on the surface too (coal in a cliff
    // face, iron at a cave mouth). The bot locked onto unreachable ore 30
    // blocks away and spun on the surface: 63% "turning to ore", 10%
    // walking, no breaking at all.
    const b12 = sahteBot()
    b12.entity.position = new Vec3(0, 70, 0) // on the surface
    b12.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    // Ore is visible nearby
    b12.findBlocks = () => [new Vec3(5, 70, 5)]
    // Realistic world: y<70 is stone, air above, one ore block somewhere
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
    // Detect the descent without wrapping kaz.js or scraping logs: count
    // bot.dig calls, since seviyeyeIn digs a staircase.
    b12.canDigBlock = () => true
    b12.dig = async () => { inmeyiDenedi = true }

    await e12.yeraltiKurulumu()
    if (!inmeyiDenedi) {
      throw new Error('yuzeyde cevher gorunce inmekten vazgecti')
    }
  })

  await dene('MADEN gorevinde de sudan cikiyor (bogulma gorevden bagimsiz)', async () => {
    // Real run: the bot drowned on the mining task. `sudanCik` lived inside
    // the surface setup, so the rescue only ran on the wood task. Hitting a
    // water pocket underground is routine.
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
    // `/give` needs op and fails silently. Without a pickaxe the bot breaks
    // ore and nothing drops: measured 63% "ore in front of me" and 0
    // resources. Silent failure is the most expensive kind.
    const log = require('../bot/utils/log')
    const orjinal = log.hata
    const hatalar = []
    log.hata = (...a) => hatalar.push(a.join(' '))
    try {
      const b13 = sahteBot()
      b13.inventory = { items: () => [] } // /give does not work: always empty
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
    // Real bug: y=70 down to y=15 is ~55 steps x 3 blocks, which takes
    // minutes. The Python socket timed out at 60s and training died.
    // Reset must not block for minutes; the descent spreads over episodes.
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

    // 12 steps x 3 blocks = 36. Without the cap it would be 55 x 3 = 165.
    if (kazilan > 60) throw new Error(`${kazilan} blok kazdi — inis sinirlanmamis`)
  })

  await dene('uzman ULASILAMAYAN esyayi sonsuza kadar kovalamiyor', async () => {
    // Measured: 79% of mining-task steps were "picking up nearby ore" --
    // breaking, walking, turning, with nothing ever reaching the inventory.
    // One unreachable item, dropped into the hole it had just dug, kept the
    // expert busy for the whole episode.
    const uzman = require('../bot/bridge/expert')
    const b15 = sahteBot()
    const e15 = new MinecraftEnvironment(b15, { zamanCarpani: 0, gorev: 'maden' })
    b15.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b15.canDigBlock = () => true
    b15.blockAt = () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) })
    // Unreachable item: always there, never collected
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
    // uygunAlet answers "do I hold a pickaxe", not "is it good enough for
    // this ore". Hitting diamond with a stone pickaxe destroys the ore.
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
    // Pickaxe with no durability left
    b16.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 250 }] }
    if (g.GOREVLER.maden.dogalMi(b16, { name: 'iron_ore' })) {
      throw new Error('kirilmis kazmayla cevheri hedef saydi')
    }
  })

  await dene('step() kazma kirilinca YENISINI istiyor', async () => {
    // An iron pickaxe is 250 hits and an episode is 500 steps, so breaking
    // it is expected, not an edge case. After that every hit destroys ore.
    const b16 = sahteBot()
    const komutlar = []
    b16.chat = (m) => komutlar.push(m)
    b16.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 250 }] }
    const e16 = new MinecraftEnvironment(b16, { zamanCarpani: 0, gorev: 'maden' })
    await e16.step(3) // break action
    if (!komutlar.some((m) => /give .*iron_pickaxe/.test(m))) {
      throw new Error(`kirilmis kazma icin yenisi istenmedi: ${komutlar.join(' | ')}`)
    }
  })

  await dene('maden tukenince TAZE BOLGEYE isinlaniyor', async () => {
    // In a 40-episode demo run the first 18 episodes were fine (8, 6, 22, 12
    // ore), then 19-35 were almost all zero: the bot had stripped the area.
    // The wood task solves this with spreadplayers, but that puts the player
    // on the surface, which is useless underground.
    const b17 = sahteBot()
    b17.entity.position = new Vec3(0, 15, 0) // already at depth
    b17.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 0, type: 1 }] }
    const komutlar = []
    b17.chat = (m) => komutlar.push(m)
    b17.findBlocks = () => [] // no ore at all: the area is stripped

    const e17 = new MinecraftEnvironment(b17, { zamanCarpani: 0, gorev: 'maden' })
    await e17.yeraltiKurulumu()

    if (!komutlar.some((m) => /^\/tp /.test(m))) {
      throw new Error(`taze bolgeye isinlanmadi: ${komutlar.join(' | ')}`)
    }
    // The pocket has to be carved before the teleport, or the bot suffocates in stone
    const fillIndex = komutlar.findIndex((m) => /^\/fill /.test(m))
    const tpIndex = komutlar.findIndex((m) => /^\/tp /.test(m))
    if (fillIndex < 0) throw new Error('cep acilmadi — bot tasin icine isinlanir')
    if (fillIndex > tpIndex) throw new Error('once isinlanip sonra cep acti — bogulma sirasi')
  })

  await dene('DIKEY hedefte donmuyor (yaw anlamsiz)', () => {
    // Measured: 76% of steps were turning, 10% walking, 13 of 15 episodes
    // scored zero. hedefYaw only looks at dx,dz. With the ore almost
    // straight overhead both are near zero, so a sub-block twitch flips the
    // angle by 180 degrees and the bot spins forever.
    const uzman = require('../bot/bridge/expert')
    const b18 = sahteBot()
    b18.entity.position = new Vec3(0.5, 15, 0.5)
    b18.inventory = { items: () => [{ name: 'iron_pickaxe', maxDurability: 250, durabilityUsed: 0, type: 1 }] }
    b18.canDigBlock = () => true
    b18.registry = { blocksByName: { iron_ore: { id: 1 } } }

    // Ore almost overhead: 1.4 blocks horizontally, 4 blocks up. Not exactly
    // overhead -- that gives an angle of zero and proves nothing. This is the
    // dangerous case: the angle is computable but meaningless, because a
    // one-block twitch flips it by 180 degrees.
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
    // Straight-line distance is the wrong measure underground. The agent's
    // actions are horizontal: forward, right, left. Going up needs pillaring
    // or breaking the ceiling and jumping, neither of which is in the action
    // space. Ore 8 blocks straight up counted as closer than ore 12 blocks
    // away at the end of an open tunnel.
    const g = require('../bot/bridge/gorevler')
    const b19 = sahteBot()
    b19.entity.position = new Vec3(0, 15, 0)

    const yukarida = new Vec3(0, 23, 0)   // 8 blocks up
    const ileride = new Vec3(12, 15, 0)   // 12 blocks ahead, same level

    const m = g.GOREVLER.maden.hedefMaliyeti
    if (!(m(b19, ileride) < m(b19, yukarida))) {
      throw new Error(`ileri ${m(b19, ileride).toFixed(1)} vs yukari ${m(b19, yukarida).toFixed(1)} — dikey ucuz kaldi`)
    }

    // On the wood task straight-line distance is the right measure; leave it alone
    const o = g.GOREVLER.odun.hedefMaliyeti
    if (!(o(b19, yukarida) < o(b19, ileride))) {
      throw new Error('odun gorevinin olcusu degismis')
    }
  })

  await dene('madende bolum basinda pathfinder TUNEL KAZMIYOR', async () => {
    // baslangicaTasi() walks to the target with the pathfinder, and the
    // pathfinder runs canDig:true, so it tunnels through stone. Harmless in
    // a forest (walking open ground is not the task), but underground that
    // is the task: the environment would dig the tunnel for the agent and
    // drop it next to the ore.
    const g = require('../bot/bridge/gorevler')
    if (g.GOREVLER.maden.baslangictaYurut !== false) {
      throw new Error('maden gorevinde baslangic yurutmesi acik')
    }
    if (g.GOREVLER.odun.baslangictaYurut === false) {
      throw new Error('odun gorevinde baslangic yurutmesi kapanmis')
    }

    // Check that the environment actually reads the flag
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
    // Real run: the mining task had no clear step and the inventory filled
    // up across episodes. With all 36 slots full, `/give iron_pickaxe`
    // succeeds server-side ("Gave 1 [Iron Pickaxe]") but the item never
    // arrives. A bot without a pickaxe destroys ore.
    const b20 = sahteBot()
    const komutlar = []
    b20.chat = (m) => komutlar.push(m)
    const e20 = new MinecraftEnvironment(b20, { zamanCarpani: 0, gorev: 'maden' })
    await e20.reset()

    const temizle = komutlar.findIndex((m) => /^\/clear \S+$/.test(m))
    if (temizle < 0) throw new Error(`envanter temizlenmedi: ${komutlar.join(' | ')}`)

    // Order matters: clear before the give, or the new pickaxe is deleted
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
    // Runs without Minecraft but against the real recipe table. Given 3 logs
    // and 3 cobblestone and asked for a stone pickaxe, the code has to build
    // the planks -> stick -> table -> pickaxe chain on its own.
    const mcData = require('minecraft-data')('1.20.4')
    const Recipe = require('prismarine-recipe')('1.20.4').Recipe

    const env = { oak_log: 3, cobblestone: 3 } // no crafting table - it has to make one
    let masaYerde = false
    const yerlesen = {}
    let sonEquip = null
    const b = {
      version: '1.20.4',
      inventory: {
        items: () => Object.entries(env).filter(([, c]) => c > 0)
          .map(([name, count], i) => ({ name, count, type: mcData.itemsByName[name].id, slot: i }))
      },
      // No table in the world at the start; the bot has to craft one and
      // place it. This used to always return a table, so the "cannot see
      // 3x3 recipes without a table" bug never showed up here -- the fake
      // world was easier than the real one.
      findBlock: () => (masaYerde ? { name: 'crafting_table', position: new Vec3(1, 64, 0) } : null),
      // Remembers placed blocks: blokKoy() verifies its own placement with
      // blockAt. If the fake world forgets, it thinks the place failed.
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
      // Mimics mineflayer's behaviour, not just its signature: without a
      // table it filters out 3x3 recipes. This used to be a bare
      // Recipe.find(...); the test passed but the game did not, because the
      // fake bot returned every recipe and the real one never does.
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
    // Logs at y=64..67, dirt at y=63. Starting from the middle log it should
    // walk down to 64. Regression test for cutting the middle out and leaving.
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
    // End-to-end chain test, starting from a completely empty inventory:
    //   iron pickaxe <- 3 ingots + 2 sticks
    //     ingot   <- not craftable at a table -> furnace <- raw iron <- mine
    //     stick   <- planks <- log <- chop
    //     furnace <- 8 cobblestone <- mine
    // The bot builds this tree itself; no step is hardcoded.
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
      // Remembers placed blocks: blokKoy() verifies its own placement with
      // blockAt. If the fake world forgets, it thinks the place failed.
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
    // Real bug: the bot reported it could not collect spruce_log. Sticks
    // have ~12 recipes, one per wood type. With an empty inventory they all
    // score the same, so it picked spruce at random and kept at it while the
    // forest was oak. Two rounds: trigger the supplier, then rescore with
    // whatever actually arrived.
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
      // Remembers placed blocks: blokKoy() verifies its own placement with
      // blockAt. If the fake world forgets, it thinks the place failed.
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

    // The forest is oak only: whatever is asked for, oak comes back
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
    // Real bug: one "uret tas kazma" command chopped 4 trees and still was
    // not done. Sticks have ~12 recipes, one per wood type; uret tried them
    // in order and asked the supplier for that specific log each time, so
    // every attempt felled another tree.
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
      // Remembers placed blocks: blokKoy() verifies its own placement with
      // blockAt. If the fake world forgets, it thinks the place failed.
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

    // Same logic as the real tedarikciYap(), with counters added
    const sinif = (ad) => (/_log$/.test(ad) ? 'odun' : (ad === 'cobblestone' || ad === 'stone' ? 'tas' : null))
    const verilen = new Set()
    const tedarikci = async (bot, kontrol, ad, adet) => {
      const s2 = sinif(ad)
      if (!s2 || verilen.has(s2)) return false
      // The forest has cherry and no oak. Cherry is deliberate: it sits near
      // the end of the recipe list while the first recipe tried is oak, so a
      // single-round solution would stall on oak. The bot has to rescore the
      // recipes once cherry is in hand. Handing it oak would prove nothing.
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
    // Asking for 'iron' must not count the wooden pickaxe
    const g = kazModul.kazmaGucu(b, 'iron')
    if (g.adet !== 1 || g.toplam !== 200) {
      throw new Error(`iron icin adet=${g.adet} toplam=${g.toplam}, beklenen 1/200`)
    }
    // Asking for 'wooden' counts both
    const g2 = kazModul.kazmaGucu(b, 'wooden')
    if (g2.adet !== 2 || g2.toplam !== 259) {
      throw new Error(`wooden icin adet=${g2.adet} toplam=${g2.toplam}, beklenen 2/259`)
    }
  })

  await dene('seviyeyeIn() - kazma yoksa KAZMADAN duruyor', async () => {
    // Starting the descent without a pickaxe destroys ore on the way down.
    // It has to return 'kazma_bitti' without breaking a single step.
    const r = await kazModul.seviyeyeIn(bot, 15, k, { seviye: 'stone' })
    if (r.ok) throw new Error('kazmasiz indigini iddia etti')
    if (r.basamak !== 0) throw new Error(`${r.basamak} basamak kirmis, 0 olmaliydi`)
    if (r.sebep !== 'kazma_bitti') throw new Error(`sebep: ${r.sebep}`)
  })

  await dene('elmas kazma varken demir kazma YAPMIYOR', () => {
    // Real complaint: "it has a diamond pickaxe and still goes off to make
    // an iron one". The stock check counted pickaxes. One diamond pickaxe is
    // 1561 hits, four times three stone pickaxes (393). By count it looks
    // short, by hits it is more than enough. The unit has to be hits, not
    // pieces.
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    b.inventory = { items: () => [{ name: 'diamond_pickaxe', maxDurability: 1561, durabilityUsed: 0 }] }

    // "kaz elmas 10": descend from y=64 to y=-58, then dig 10 blocks
    const gerekli = kazModul.gerekenVurus(b, -58, 10)
    const elde = kazModul.kazmaGucu(b, 'iron').toplam

    if (elde < gerekli) {
      throw new Error(`elmas kazma (${elde} vurus) ${gerekli} vurusluk ise yetmiyor sayildi`)
    }
    // With a count-based check 1 < 3 would send it off to craft another pickaxe
    if (kazModul.kazmaGucu(b, 'iron').adet >= 3) {
      throw new Error('test anlamsiz: zaten 3 kazma var')
    }
  })

  await dene('gerekenVurus() derinlikle buyuyor', () => {
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    const sig = kazModul.gerekenVurus(b, 50, 5) // 14 blocks
    const derin = kazModul.gerekenVurus(b, -58, 5) // 122 blocks
    if (!(derin > sig * 3)) {
      throw new Error(`derin ${derin} vs sig ${sig} — derinlik hesaba katilmamis`)
    }
  })

  await dene('uret() tahtayi SOYULMUS kutukten yapmaya kalkmiyor', () => {
    // Real bug: the bot said it could not make an iron pickaxe, missing
    // stripped_birch_log. Planks have 4 recipes; stripped logs do not occur
    // naturally (an axe strips them), but the recipe is valid so it got
    // picked. Scoring now asks how an ingredient is obtained, not just
    // whether it is in hand.
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

  await dene('yakitBul() - yakit YETMEDIGINDE bunu SOYLUYOR', () => {
    // Seen in game: the bot mined the iron, placed the furnace, loaded too
    // little fuel, waited, and reported failure.
    //
    // The old yakitBul returned the same thing whether the fuel was enough
    // or not, so the caller could not tell them apart. That is why the "no
    // fuel, go get coal" check in uret.js never fired -- there is almost
    // always wood in the inventory.
    const b = sahteBot()
    b.inventory = { items: () => [{ name: 'oak_planks', count: 2 }] }

    // 2 planks smelt 3 items. Asking for 20 is not enough, and it has to say so.
    const az = eritModul.yakitBul(b, 20)
    if (!az) throw new Error('yakit var ama null dondu')
    if (az.yeterli) throw new Error('2 tahta ile 20 esya eritilebilir dedi')
    if (az.pisebilecek >= 20) throw new Error(`pisebilecek ${az.pisebilecek}, 20den az olmali`)

    // 3 items: enough
    const yeter = eritModul.yakitBul(b, 3)
    if (!yeter.yeterli) throw new Error('2 tahta 3 esyaya yetmez dedi')
  })

  await dene('yakitBul() - AYNI turun butun yiginlarini sayiyor', () => {
    // `find` only saw one stack per type, so half of a coal pile split over
    // two stacks was invisible and the bot gave up early on fuel.
    const b = sahteBot()
    b.inventory = { items: () => [{ name: 'coal', count: 2 }, { name: 'coal', count: 3 }] }

    // 5 coal smelts 40 items. Counting one stack would give 2 coal = 16.
    const y = eritModul.yakitBul(b, 40)
    if (!y.yeterli) throw new Error('5 komuru 40 esyaya yetmez saydi (yiginlar toplanmiyor)')
  })

  await dene('yakitBul() - tek basina bitirebilen turu seciyor', () => {
    // Coal comes first in the list but 1 coal (8 items) cannot finish 30.
    // If a type can finish the job, pick that one, not the first listed.
    const b = sahteBot()
    b.inventory = {
      items: () => [{ name: 'coal', count: 1 }, { name: 'coal_block', count: 1 }]
    }
    const y = eritModul.yakitBul(b, 30)
    if (y.esya.name !== 'coal_block') throw new Error(`secilen ${y.esya.name}, bitiremiyor`)
    if (!y.yeterli) throw new Error('bitirebilen tur varken yetersiz dedi')

    // On a small job a coal block is waste: pick plain coal
    const kucuk = eritModul.yakitBul(b, 5)
    if (kucuk.esya.name !== 'coal') throw new Error('kucuk is icin blok harcadi')
  })

  await dene('erit() - girdi yoksa NEYIN eksik oldugunu soyluyor', async () => {
    const r = await eritModul.erit(bot, k, 'iron_ingot', 1)
    if (r.basarili) throw new Error('bos envanterle erittigini iddia etti')
    if (r.eksik !== 'raw_iron') throw new Error(`eksik: ${r.eksik}, raw_iron olmaliydi`)
  })

  await dene('uret() zinciri firina atliyor (demir kulce tezgahta yok)', async () => {
    // An iron ingot cannot be crafted at a table. This used to stop at
    // "cannot craft"; now it has to try smelting, and failing that, ask for
    // the raw material.
    const r = await uretModul.uret(bot, k, 'iron_ingot', 1)
    if (r.basarili) throw new Error('yoktan kulce urettigini iddia etti')
    if (!/raw_iron|iron/.test(r.mesaj)) {
      throw new Error(`ham maddeyi hic anmadi: ${r.mesaj}`)
    }
  })

  await dene('enYakinDogalAgac() kara listedeki agaci ATLIYOR', () => {
    // Real bug: the bot picked the same unreachable log (1429,71,-48) five
    // times in a row, ~20 seconds each. There was no blacklist.
    const chop = require('../bot/skills/chopTree')
    const b = sahteBot()
    // A single oak trunk at y=64..66
    b.blockAt = (p) => {
      const y = Math.floor(p.y)
      const kutuk = (p.x === 10 && p.z === 10 && y >= 64 && y <= 66)
      // Leaves have to sit on top: dogalAgacMi looks for them at dy 0..6
      // above the log.
      return {
        name: kutuk ? 'oak_log' : (y >= 67 && y <= 68 ? 'oak_leaves' : 'air'),
        boundingBox: kutuk ? 'block' : 'empty',
        position: new Vec3(p.x, y, p.z)
      }
    }
    b.findBlocks = () => [new Vec3(10, 65, 10)]

    const bulunan = chop.enYakinDogalAgac(b, 32)
    if (!bulunan) throw new Error('agaci hic bulamadi')

    // Blacklist the base of that same tree; it must not be found again
    const kara = new Set(['10,64,10'])
    const ikinci = chop.enYakinDogalAgac(b, 32, kara)
    if (ikinci) throw new Error(`kara listeye ragmen secti: ${ikinci.position}`)
  })

  await dene('damarTopla() damarin TAMAMINI buluyor', () => {
    // Real complaint: "it mined 2, left 3-4 behind, and went off to the next
    // one". The code picked the nearest ore each round; once a block was
    // broken the nearest candidate was sometimes the edge of another vein.
    // Veins are now collected whole.
    const b = sahteBot()
    // (0,10,0)-(0,10,2) plus (1,10,0) => a 4-block vein
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
    // Two separate veins: one at (0,10,0), the other 5 blocks away
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
    // Real bug: with no ore in sight the plan was to move a bit and look
    // again, but moving called birBasamakIn, which drops a level every time.
    // The bot rode that down to bedrock.
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    b.entity.yaw = 0 // forward = -z
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
    // Real complaint: "it digs its way to the surface by hand even though it
    // has a pickaxe". Breaking stone by hand is ~5x slower, and on ore
    // nothing drops at all. chopTree and kaz equipped the tool; sutun.js was
    // missed.
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
    // Real complaint: the bot could not break a diamond it could reach and
    // spun in a loop; the user broke the diamond by hand to stop it.
    // Fake world: the diamond is always there (never breaks) and the
    // pathfinder always succeeds. Without the guard this test would hang.
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
    b.canDigBlock = () => false // never breakable

    // Zero out the waits: the guard is what is measured, not real timings
    const hizli = { kontrolEt () {}, bekle: async () => {} }
    const bitis = Date.now() + 8000
    const r = await kazModul.kaz(b, hizli, 'elmas', 10)
    if (Date.now() > bitis) throw new Error('8 saniyeden uzun surdu — dongu var')
    if (r.kirilan > 0) throw new Error('kirilamayan blogu kirdigini iddia etti')
  })

  await dene('guvenliMi() su icin cevher/merdiven ayrimi yapiyor', () => {
    // Water is dangerous depending on where the bot ends up:
    //  - hitting ore from a distance: adjacent water is harmless, just a spill
    //  - digging a staircase: the bot enters that space itself -> drowning
    // Water used to be an absolute blocker and reachable diamonds got rejected.
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

    // Lava blocks in both cases
    b.blockAt = (p) => ({
      name: (p.x === 1 && p.y === 0 && p.z === 0) ? 'lava' : 'deepslate',
      boundingBox: 'block',
      position: p
    })
    if (kazModul.guvenliMi(b, konum)) throw new Error('lavi guvenli saydi')
  })

  await dene('tehlikedeMi() can azalinca ve lavda uyariyor', () => {
    // Real run: the bot walked into a lava pool and died. The code checked
    // the blocks it was breaking but never the bot's own state. Lava takes
    // about 4 health per second.
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
    // Lava 3 blocks ahead (-z)
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
    // Real complaint: "it has 2 furnaces in the inventory but says there is
    // nowhere to put one -- just break a block and place it". The old code
    // checked 6 fixed neighbouring spots and gave up. The bot is a miner
    // carrying a pickaxe.
    const b = sahteBot()
    b.entity.position = new Vec3(0, 64, 0)
    b.inventory = { items: () => [{ name: 'furnace', count: 2, type: 1 }] }
    b.canDigBlock = () => true

    // Everything is solid: no ready spot anywhere
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
    // Real run: the bot got stuck on the edge of a ledge, running without
    // moving. The pathfinder had a path and was holding the keys down, but
    // the bot was physically wedged. A timeout alone was not enough: waiting
    // 15 seconds is long and reports it as "no path", when the path exists
    // and the bot is just stuck.
    const gorev = require('../bot/utils/gorev')
    const b = sahteBot()
    let tuslarTemizlendi = false
    b.clearControlStates = () => { tuslarTemizlendi = true }
    // goto never resolves and the bot never moves: the classic stuck case
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
    // +x is open, every other direction is blocked
    b.blockAt = (p) => {
      const acik = (p.x >= 1)
      return { name: acik ? 'air' : 'stone', boundingBox: acik ? 'empty' : 'block', position: p }
    }
    const basildi = []
    b.setControlState = (ad, deger) => { if (deger) basildi.push(ad) }
    // Jumping actually moves the bot
    b.lookAt = async () => { b.entity.position = new Vec3(1.5, 64, 0) }

    const r = await kurtarModul.kurtar(b, k)
    if (!r) throw new Error('acik yon varken kurtulamadi')
    if (!basildi.includes('jump')) throw new Error('ziplamadi')
  })

  await dene('kurtar() her yon kapaliysa KENDINE YOL KAZIYOR', async () => {
    // Real case: the bot is stuck in a 1-block hole it dug itself. There is
    // nowhere to jump to; it has a pickaxe and has to dig its way out.
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
    // Real log: 48 times in the same second, "no natural tree within 64
    // blocks". Only successful collections were recorded. Underground the
    // bot finds no tree, nothing gets recorded, and uret asks again for the
    // next wood type (~11 types x retries).
    const skills = require('../bot/skills')
    let cagri = 0

    // Uses the real tedarikciYap(); chopTrees cannot be swapped for a
    // counter, so instead ask for the same class several times and expect
    // false from the second call on.
    const tedarikci = skills.tedarikciYap()
    const b = sahteBot()
    b.findBlocks = () => { cagri++; return [] } // no trees at all

    const r1 = await tedarikci(b, k, 'oak_log', 1)
    const r2 = await tedarikci(b, k, 'birch_log', 1)
    const r3 = await tedarikci(b, k, 'spruce_log', 1)

    if (r1 || r2 || r3) throw new Error('agac yokken buldugunu iddia etti')
    if (cagri > 1) throw new Error(`${cagri} kez agac aradi — bir kez yeterliydi`)
  })

  await dene('kaz() YIPRANMIS kazmayla calismaya devam ediyor', async () => {
    // Real screenshot: iron pickaxe in hand, diamond right in front, and the
    // bot said "broke 0 diamonds, then my pickaxe ran out" and went back up.
    // Anything under the 20-hit threshold counted as spent, but 15 hits is
    // plenty for a few diamonds.
    const b = sahteBot()
    b.entity.position = new Vec3(0, -58, 0)
    // Iron pickaxe with 15 hits left: below the threshold (20) but not spent
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
    // Why this test exists: the "uret" command was added to KOMUTLAR, the
    // skill was written, the skill's own tests passed -- and the command did
    // nothing in game. The router checked `komut.startsWith('uret ')`, but
    // `komut` is only the first word of the message and never contains a
    // space. The condition was never true and never errored, it just did
    // nothing. Testing the function is not enough; the wiring needs a test
    // too.
    const kaynak = fs.readFileSync(path.join(__dirname, '..', 'bot', 'index.js'), 'utf8')
    const { KOMUTLAR } = require('../bot/index')

    const eksik = []
    for (const { ad } of KOMUTLAR) {
      const ilk = ad.split(' ')[0]
      // Look for this word in an equality comparison in the router
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

    // `findBlocks` sees through walls. At y=15 there is always some ore
    // within 64 blocks, usually 40 blocks deep in stone. The environment
    // reported a target, so `tazeMadeneIsinla` never ran and the agent spent
    // every episode tunnelling toward ore it could not reach. In training,
    // episode 1 got 5 ore and episodes 2-18 all got zero.
    if (!(eMaden.yaricap < eOdun.yaricap)) {
      throw new Error(`maden yaricapi ${eMaden.yaricap}, odun ${eOdun.yaricap} -- kucuk degil`)
    }
    if (eMaden.yaricap > 24) {
      throw new Error(`maden yaricapi ${eMaden.yaricap}: bir bolumde tunelle asilamaz`)
    }
  })

  await dene('gozlem mesafesi AYNI yaricapla normalize ediliyor', () => {
    // If target selection uses one radius and observation normalization
    // another, the observation scale shifts between tasks and a pretrained
    // net sees meaningless input. It fails silently: the code runs, the
    // agent just gets worse.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.entity.position = new Vec3(0, 15, 0)
    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })

    // Ore exactly at the radius edge: normalized distance should be 1.0
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
    // Second cause of the PPO collapse. The "drop an unreachable target"
    // logic lived only in expert.js; once PPO took the wheel nobody called
    // it and the agent spent whole episodes locked onto ore straight
    // overhead. The environment's own `HEDEF_SABIR` (20 steps) is too slow:
    // the stall cutoff is 60 steps, so three bad targets eat a full episode.
    //
    // This test never calls the expert; it drives a fixed action sequence.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.entity.position = new Vec3(0.5, 15, 0.5)
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.canDigBlock = () => false // nothing breakable in range

    // Ore straight overhead (horizontal distance 0), and there is no up action
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

    // "Turn left": something the agent can do that gets it nowhere here
    for (let i = 0; i < 8; i++) await env.step(1)

    if (!env.karaListe.has('0,21,0')) {
      throw new Error('8 adim sonra ulasilamaz dikey hedef hala kara listede degil')
    }
  })

  await dene('tazeMadeneIsinla() cevher bulana kadar TEKRAR deniyor', async () => {
    // With the search radius down to 16, a random spot can genuinely have no
    // ore near it. A one-shot teleport then produces an episode with no
    // target, which is pure noise for PPO.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.entity.position = new Vec3(0, 15, 0)
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }

    let isinlanma = 0
    b.chat = (mesaj) => { if (/^\/tp /.test(mesaj)) isinlanma++ }
    // No ore on the first two teleports, ore on the third
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
    // Real bug: `aletTipi` was a hand-written regex list and missed 439
    // blocks in 1.20.4, including `tuff`, `calcite`, `smooth_basalt`,
    // `amethyst_block` and `dripstone_block`. Those are everywhere in y=15
    // caves. Facing one, the bot decided it had no tool for it and tried to
    // walk around it forever: the expert broke nothing across 4 episodes and
    // collected 0 resources.
    //
    // This test makes a hand-kept list impossible: it compares against the
    // game's own `material` field.
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
    // Concrete version of the test above: with a pickaxe the bot has to be
    // able to break the most common y=15 blocks, or the episode goes into
    // walking around them.
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
    // Observability test. This branch once ate an entire mining run, and
    // because the reason only said "engel_soldan_dolasiyorum" it took two
    // rounds to find out why. The block name now shows up in the
    // gorev_kontrol breakdown: "kiramadigim_tuff".
    const uzman = require('../bot/bridge/expert')
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    const e = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })
    // No pickaxe -> stone is unbreakable -> falls into the go-around branch
    b.inventory = { items: () => [] }
    b.blockAt = () => ({ name: 'tuff', material: 'mineable/pickaxe', boundingBox: 'block', position: new Vec3(0, 0, 0) })

    const karar = uzman.hedefeYonel(b, e, new Vec3(0, 64, -5), 'cevhere')
    if (!/kiramadigim_tuff/.test(karar.sebep)) {
      throw new Error(`engelin adi gerekcede yok: ${karar.sebep}`)
    }
  })

  console.log('\nGorus hatti ve on nokta sirasi')

  await dene('DUVARIN ARDINDAKI cevheri menzilde saymiyor', () => {
    // Real run (screenshot): the bot broke ore on the far side of a stone
    // wall. Mineflayer's `canDigBlock` checks distance only, not line of
    // sight, and the server accepts it. The drop lands behind the wall out
    // of reach: the break reward is paid but nothing enters the inventory.
    // That is where the measured 0 resources came from.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.entity.position = new Vec3(0.5, 15, 0.5)
    b.entity.yaw = 0 // facing -z
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }

    const cevher = new Vec3(0, 15, -3) // straight ahead, 3 blocks away
    b.findBlocks = () => [cevher]
    b.blockAt = (pos) => {
      const x = Math.floor(pos.x); const y = Math.floor(pos.y); const z = Math.floor(pos.z)
      if (x === 0 && y === 15 && z === -3) {
        return { name: 'iron_ore', material: 'mineable/pickaxe', boundingBox: 'block', position: cevher }
      }
      return { name: 'stone', material: 'mineable/pickaxe', boundingBox: 'block', position: new Vec3(x, y, z) }
    }

    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })

    // Line of sight clear: counts as in range
    b.canSeeBlock = () => true
    if (!env.onundekiKutuk()) throw new Error('gorus acikken cevheri menzilde saymadi')

    // Line of sight blocked by a wall: must not count as in range
    b.canSeeBlock = () => false
    if (env.onundekiKutuk()) throw new Error('duvarin ardindaki cevheri menzilde saydi')
  })

  await dene('onumdeki noktalar ORTADAN basliyor (caprazdan degil)', () => {
    // Real run: the bot kept breaking the front-left diagonal block while
    // the centre block stayed put, pushing forward and getting nowhere. The
    // cause was ordering alone: `onumuKapatan()` returns the first block it
    // finds and sampling started at `[-0.35, 0, 0.35]`.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.entity.position = new Vec3(0.5, 15, 0.5)
    b.entity.yaw = 0
    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })

    const noktalar = env.onumdekiNoktalar(0.8, [0.1])
    const yan = new Vec3(-Math.cos(0), 0, Math.sin(0))
    // The first sample point must have zero lateral offset
    const kayma = (noktalar[0].x - b.entity.position.x) * yan.x +
                  (noktalar[0].z - b.entity.position.z) * yan.z
    if (Math.abs(kayma) > 0.01) {
      throw new Error(`ilk ornek nokta ortada degil, yanal kayma ${kayma.toFixed(2)}`)
    }
  })

  await dene('ONCE ortadaki blogu kiriyor, caprazdakini degil', () => {
    // Behavioural version of the test above: with breakable blocks both dead
    // centre and front-left, `onumuKapatan()` has to pick the centre one.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    // The bot has to stand at the edge of a block.
    //
    // A first version put it dead centre (x=0.5) and the test could not tell
    // the difference: a 0.35 lateral offset still lands in the same block
    // there, so all three samples hit x=0. The diagonal-leaf test had the
    // same flaw. At x=0.8 the samples spread over [centre=0, left=1, right=0].
    b.entity.position = new Vec3(0.8, 15, 0.5)
    b.entity.yaw = 0 // -z
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.canDigBlock = () => true
    b.blockAt = (pos) => {
      const x = Math.floor(pos.x); const y = Math.floor(pos.y); const z = Math.floor(pos.z)
      // Centre: x=0, front-left: x=1 (both solid)
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

  await dene('gozlem boyutlari env.py ile ayni (ORTAK 16 + EK 4)', () => {
    // These numbers are the only contract between Node and Python. On a
    // mismatch the Python side blows up only after it connects to Minecraft,
    // that is, after the user has started the server and the game. Here it
    // is caught in a second.
    //
    // Wood stays narrow (16): Milestone 4's saved models expect 19-dim
    // input. Mining is wide (20). Multi-task training (Milestone 6) pulls
    // wood up to wide too, because one net covering both tasks needs a
    // shared width.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')

    const olc = (gorev, genisGozlem) => {
      const b = sahteBot()
      b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
      const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev, genisGozlem })
      const g = env.gozlem()
      if (g.some((x) => typeof x !== 'number' || Number.isNaN(x))) {
        throw new Error(`${gorev}: gozlemde sayi olmayan/NaN deger var`)
      }
      return g.length
    }

    const ORTAK = 16
    const EK = 4
    const beklenen = [
      ['odun', undefined, ORTAK],        // default: narrow
      ['odun', true, ORTAK + EK],        // what multi-task training asks for
      ['maden', undefined, ORTAK + EK],  // default: wide
      ['maden', false, ORTAK]            // narrow only when asked for explicitly
    ]
    for (const [gorev, genis, n] of beklenen) {
      const olculen = olc(gorev, genis)
      if (olculen !== n) {
        throw new Error(
          `${gorev} (genisGozlem=${genis}): ${olculen} sayi, beklenen ${n}`)
      }
    }

    // Compare with the table in env.py; the two files have to change together
    const kaynak = fs.readFileSync(
      path.join(__dirname, '..', 'python', 'minecrai', 'env.py'), 'utf8')
    const o = /^ORTAK = (\d+)/m.exec(kaynak)
    const e = /^EK = (\d+)/m.exec(kaynak)
    if (!o || !e) throw new Error('env.py icinde ORTAK/EK sabitleri bulunamadi')
    if (Number(o[1]) !== ORTAK || Number(e[1]) !== EK) {
      throw new Error(
        `env.py ORTAK=${o[1]} EK=${e[1]} diyor, environment.js ` +
        `ORTAK=${ORTAK} EK=${EK} uretiyor`)
    }
  })

  await dene('gorev degisince ARAMA YARICAPI da degisiyor', () => {
    // Silent trap for Milestone 6: `server.js` swapped `env.gorev` on a task
    // change, but the radius was a field computed once in the constructor.
    // Multi-task training switches task every episode, so a bot going from
    // wood to mining kept the 64-block radius and the "locked onto an
    // unreachable target" bug came back, silently.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const env = new MinecraftEnvironment(sahteBot(), { zamanCarpani: 0, gorev: 'odun' })
    if (env.yaricap !== 64) throw new Error(`odun yaricapi ${env.yaricap}, 64 bekleniyordu`)

    env.gorevDegistir('maden')
    if (env.gorev.ad !== 'maden') throw new Error('gorev degismedi')
    if (env.yaricap !== 16) {
      throw new Error(`madene gecince yaricap ${env.yaricap} kaldi, 16 olmaliydi`)
    }

    env.gorevDegistir('odun')
    if (env.yaricap !== 64) throw new Error('geri donunce yaricap guncellenmedi')
  })

  await dene('gorev degisimi KILITLI HEDEFI ve kara listeyi temizliyor', () => {
    // A target picked on the wood task means nothing on mining, and neither
    // does its blacklist. Left in place, the agent spends the first steps of
    // the new task walking toward an old position, with nothing in the
    // observation to explain it.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const env = new MinecraftEnvironment(sahteBot(), { zamanCarpani: 0, gorev: 'odun' })
    env.hedefKonum = new Vec3(10, 64, 10)
    env.karaListe.add('1,2,3')

    env.gorevDegistir('maden')
    if (env.hedefKonum !== null) throw new Error('kilitli hedef tasindi')
    if (env.karaListe.size !== 0) throw new Error('kara liste tasindi')
  })

  await dene('maden gozlemi ESYA yonunu gercekten tasiyor', () => {
    // For the test to discriminate, the observation has to differ with and
    // without an item. Checking the length alone would be false comfort:
    // four appended zeros match the length too.
    const { MinecraftEnvironment } = require('../bot/bridge/environment')
    const b = sahteBot()
    b.inventory = { items: () => [{ name: 'iron_pickaxe', count: 1, type: 1 }] }
    b.entity.position = new Vec3(0, 15, 0)
    b.entity.yaw = 0 // facing -z
    const env = new MinecraftEnvironment(b, { zamanCarpani: 0, gorev: 'maden' })

    const esyasiz = env.gozlem()

    // Put the item on the left (+x is left when facing -z)
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

  console.log('\nSohbet katmani (LLM)')

  await dene('BILINEN listesi yonlendiricideki HER komutu kapsiyor', () => {
    // Silent breakage: if a command drops out of BILINEN the message is no
    // longer treated as an exact command and goes to the LLM. It still
    // works, at the cost of latency and tokens, and does the wrong thing if
    // the LLM misreads it. No error anywhere.
    //
    // The same class of bug already happened here once:
    // `komut.startsWith('uret ')` could never be true and the command
    // silently did nothing.
    const kaynak = fs.readFileSync(path.join(__dirname, '..', 'bot', 'index.js'), 'utf8')

    const m = /const BILINEN = new Set\(\[([\s\S]*?)\]\)/.exec(kaynak)
    if (!m) throw new Error('index.js icinde BILINEN listesi bulunamadi')
    const bilinen = new Set(
      [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    )

    // Commands the router actually branches on
    const dallanan = new Set(
      [...kaynak.matchAll(/komut === '([^']+)'/g)].map((x) => x[1])
    )
    const eksik = [...dallanan].filter((k) => !bilinen.has(k))
    if (eksik.length > 0) {
      throw new Error(`BILINEN listesinde eksik: ${eksik.join(', ')}`)
    }
  })

  await dene('LLM SADECE izinli komutlari secebiliyor', () => {
    // In-game chat is untrusted input. Whatever the model emits, the worst
    // outcome should be a legitimate command from the list running.
    const { komutSatiri, IZINLI_KOMUTLAR } = require('../bot/sohbet/araclar')

    // Destructive commands must not be in the list
    for (const yasak of ['korumasil', 'koru', 'korumalar']) {
      if (Object.prototype.hasOwnProperty.call(IZINLI_KOMUTLAR, yasak)) {
        throw new Error(`${yasak} LLM'e acilmis -- yikici/oyuncu karari olmali`)
      }
      if (komutSatiri({ komut: yasak })) {
        throw new Error(`${yasak} kabul edildi`)
      }
    }

    // Made-up commands are rejected
    if (komutSatiri({ komut: 'rm' })) throw new Error('bilinmeyen komut kabul edildi')
    if (komutSatiri(null)) throw new Error('bos girdi kabul edildi')

    // Legitimate commands pass
    if (komutSatiri({ komut: 'kes', arguman: '3' }) !== 'kes 3') {
      throw new Error('mesru komut reddedildi')
    }
  })

  await dene('argumandan komut enjeksiyonu temizleniyor', () => {
    const { komutSatiri } = require('../bot/sohbet/araclar')
    for (const kotu of ['3; /kill @a', '3\n/op sahte', 'tas kazma && /give']) {
      const satir = komutSatiri({ komut: 'kes', arguman: kotu })
      if (/[/\n;&]/.test(satir)) {
        throw new Error(`temizlenmemis argüman gecti: ${JSON.stringify(satir)}`)
      }
    }
  })

  await dene('saglayici secimi: hangi anahtar varsa o', () => {
    const { sec } = require('../bot/sohbet/saglayici')
    if (sec({}) !== null) throw new Error('anahtarsiz saglayici dondu')
    if (sec({ geminiAnahtari: 'x' }).ad !== 'gemini') throw new Error('gemini secilmedi')
    if (sec({ anthropicAnahtari: 'x' }).ad !== 'anthropic') throw new Error('anthropic secilmedi')
    // Both keys present: Gemini wins, it has a free tier
    if (sec({ geminiAnahtari: 'x', anthropicAnahtari: 'y' }).ad !== 'gemini') {
      throw new Error('ikisi varken ucretsiz olan secilmedi')
    }
    // An explicit choice wins
    if (sec({ geminiAnahtari: 'x', sohbetSaglayici: 'anthropic' }).ad !== 'anthropic') {
      throw new Error('acik secim ezilmedi')
    }
    // An unknown provider must not pass silently
    let patladi = false
    try { sec({ sohbetSaglayici: 'yok_boyle' }) } catch { patladi = true }
    if (!patladi) throw new Error('bilinmeyen saglayici sessizce kabul edildi')
  })

  await dene('her saglayici KENDI bicimini uretip cozebiliyor', () => {
    // The two APIs differ in request body and response shape. This checks
    // that both turn the same abstract request into their own format and
    // parse their own response back into the same normalized shape.
    const { aracTanimi } = require('../bot/sohbet/araclar')
    const anthropic = require('../bot/sohbet/saglayici/anthropic')
    const gemini = require('../bot/sohbet/saglayici/gemini')

    const istek = {
      model: 'm', maksToken: 300, sistem: 'SISTEM METNI',
      arac: aracTanimi(),
      mesajlar: [
        { rol: 'oyuncu', metin: 'selam' },
        { rol: 'bot', metin: 'merhaba' },
        { rol: 'oyuncu', metin: 'kazma yap' }
      ]
    }

    // --- Anthropic: one transport
    const ad = anthropic.denemeler()[0]
    const ag = ad.tasiyici.govde({ ...istek, model: ad.model })
    if (ag.system !== 'SISTEM METNI') throw new Error('anthropic: sistem metni kayip')
    if (ag.messages.length !== 3) throw new Error('anthropic: gecmis kayip')
    if (ag.messages[1].role !== 'assistant') throw new Error('anthropic: bot rolu yanlis')
    if (!ag.tools[0].input_schema) throw new Error('anthropic: sema kayip')
    const ac = anthropic.coz({
      content: [
        { type: 'text', text: 'Tamam.' },
        { type: 'tool_use', name: 'komut_calistir', input: { komut: 'uret', arguman: 'tas kazma' } }
      ]
    })
    if (ac.metin !== 'Tamam.' || ac.arac?.komut !== 'uret') {
      throw new Error(`anthropic cozumleme: ${JSON.stringify(ac)}`)
    }

    // --- Gemini: two transports, both have to produce the right format
    const gi = gemini.TASIYICILAR.interactions
    const gc2 = gemini.TASIYICILAR.generateContent

    const bi = gi.govde({ ...istek, model: 'm' })
    if (bi.system_instruction !== 'SISTEM METNI') throw new Error('interactions: sistem metni kayip')
    if (bi.input.length !== 3 || bi.input[1].type !== 'model_output') {
      throw new Error('interactions: gecmis/rol yanlis')
    }
    if (bi.tools[0].type !== 'function') throw new Error('interactions: arac bicimi yanlis')

    const bg = gc2.govde({ ...istek, model: 'm' })
    if (bg.system_instruction.parts[0].text !== 'SISTEM METNI') {
      throw new Error('generateContent: sistem metni kayip')
    }
    if (bg.contents.length !== 3 || bg.contents[1].role !== 'model') {
      throw new Error('generateContent: gecmis/rol yanlis')
    }
    if (!bg.tools[0].function_declarations?.[0]?.parameters) {
      throw new Error('generateContent: arac bicimi yanlis')
    }
    // The model goes in the URL for generateContent, not the body
    const u = gc2.url({ model: 'test-model' })
    if (!u.includes('test-model') || !u.endsWith(':generateContent')) {
      throw new Error(`generateContent url yanlis: ${u}`)
    }
    if (gi.url({ model: 'test-model' }).includes('test-model')) {
      throw new Error('interactions url modeli icermemeli')
    }

    // One parser has to read both formats
    const cozInter = gemini.coz({
      steps: [
        { type: 'function_call', name: 'k', arguments: { komut: 'uret', arguman: 'tas kazma' } },
        { type: 'model_response', content: [{ type: 'text', text: 'Tamam.' }] }
      ]
    })
    const cozGen = gemini.coz({
      candidates: [{
        content: {
          parts: [
            { text: 'Tamam.' },
            { functionCall: { name: 'k', args: { komut: 'uret', arguman: 'tas kazma' } } }
          ]
        }
      }]
    })
    for (const [isim, c] of [['interactions', cozInter], ['generateContent', cozGen]]) {
      if (c.metin !== 'Tamam.' || c.arac?.komut !== 'uret') {
        throw new Error(`${isim} cozumleme: ${JSON.stringify(c)}`)
      }
    }
  })

  await dene('gemini: her model IKI tasiyiciyla da deneniyor', () => {
    // Which API Google accepts varies by key and by model, and guessing cost
    // two wrong turns here (a 503, then a 404 saying "use the Interactions
    // API"). Instead of choosing, both are tried.
    const gemini = require('../bot/sohbet/saglayici/gemini')
    const liste = gemini.denemeler()
    const tasiyicilar = new Set(liste.map((d) => d.tasiyici.ad))
    if (tasiyicilar.size < 2) throw new Error(`tek tasiyici deneniyor: ${[...tasiyicilar]}`)
    if (liste.length < 4) throw new Error(`sadece ${liste.length} kombinasyon`)

    // A model set in .env is tried first
    const secili = gemini.denemeler('benim-modelim')
    if (secili[0].model !== 'benim-modelim') {
      throw new Error('kullanicinin sectigi model ilk sirada degil')
    }
  })

  await dene('gemini cozumlemesi BEKLENMEDIK bicimde de pes etmiyor', () => {
    // The Gemini Interactions response shape could not be fully verified
    // without a key, so the parser walks the structure instead of assuming
    // one path. This test keeps that defensiveness: text and function call
    // still have to be found if the shape changes.
    const gemini = require('../bot/sohbet/saglayici/gemini')

    const bicimler = [
      { candidates: [{ content: { parts: [{ functionCall: { name: 'k', args: { komut: 'kes' } } }] } }] },
      { output_text: 'Selam.', candidates: [] },
      { candidates: [{ content: { parts: [{ text: 'Selam.' }] } }] },
      { steps: [{ type: 'model_response', content: [{ type: 'text', text: 'Selam.' }] }] }
    ]
    const sonuclar = bicimler.map((b) => gemini.coz(b))
    if (sonuclar[0].arac?.komut !== 'kes') throw new Error('args alani okunmadi')
    if (sonuclar[1].metin !== 'Selam.') throw new Error('output_text okunmadi')
    if (sonuclar[2].metin !== 'Selam.') throw new Error('ic ice metin bulunamadi')
    if (sonuclar[3].metin !== 'Selam.') throw new Error('farkli sarmalayici cozulemedi')
    // Junk input must not crash it
    for (const cop of [null, {}, { steps: 'yanlis' }, { steps: [1, 2, 3] }]) {
      const r = gemini.coz(cop)
      if (typeof r.metin !== 'string') throw new Error('cop girdide metin string degil')
    }
  })

  await dene('teshis araci saglayici arayuzuyle uyumlu', () => {
    // `test/sohbet_dene.js` reuses the provider interface but lives in its
    // own file, so it falls behind silently when that interface changes.
    // That happened: `url` moved off the providers onto the transports, the
    // diagnostic tool kept calling `s.url(...)`, and it crashed with a
    // TypeError on the user's machine.
    //
    // Tests cannot run the tool itself (it makes real network requests),
    // but they can read which methods it calls.
    const kaynak = fs.readFileSync(
      path.join(__dirname, 'sohbet_dene.js'), 'utf8')

    const cagirilan = new Set(
      [...kaynak.matchAll(/\bs\.(\w+)\s*\(/g)].map((m) => m[1])
    )
    if (cagirilan.size === 0) throw new Error('teshis araci saglayiciyi hic kullanmiyor?')

    for (const saglayici of ['gemini', 'anthropic']) {
      const mod = require(`../bot/sohbet/saglayici/${saglayici}`)
      for (const metot of cagirilan) {
        if (typeof mod[metot] !== 'function') {
          throw new Error(
            `sohbet_dene.js s.${metot}() cagiriyor ama ${saglayici} saglayicisinda yok`)
        }
      }
    }

    // The transport interface has to be complete too
    const gemini = require('../bot/sohbet/saglayici/gemini')
    for (const d of gemini.denemeler()) {
      for (const metot of ['url', 'govde']) {
        if (typeof d.tasiyici[metot] !== 'function') {
          throw new Error(`${d.tasiyici.ad} tasiyicisinda ${metot}() yok`)
        }
      }
    }
  })

  await dene('sohbet: BIRDEN FAZLA komut zincirlenebiliyor', () => {
    // While the bot took a single command, an ordinary request like "chop
    // wood then make a pickaxe" did not work: the model understood the
    // intent but had no way to express it. The skills did not change, only
    // how many of them can be asked for in a row.
    const { komutSatirlari, MAKS_ADIM } = require('../bot/sohbet/araclar')

    const zincir = komutSatirlari({
      adimlar: [{ komut: 'kes', arguman: '3' }, { komut: 'uret', arguman: 'tas kazma' }]
    })
    if (zincir.length !== 2) throw new Error(`${zincir.length} komut cikti, 2 bekleniyordu`)
    if (zincir[0] !== 'kes 3' || zincir[1] !== 'uret tas kazma') {
      throw new Error(`yanlis zincir: ${JSON.stringify(zincir)}`)
    }

    // Accept the singular form too, in case the model ignores the schema
    if (komutSatirlari({ komut: 'balta' })[0] !== 'balta') {
      throw new Error('tekil bicim reddedildi')
    }

    // A banned command inside the chain is dropped, the rest stay
    const karisik = komutSatirlari({
      adimlar: [{ komut: 'kes' }, { komut: 'korumasil' }, { komut: 'balta' }]
    })
    if (karisik.includes('korumasil')) throw new Error('yikici komut zincirden gecti')
    if (karisik.length !== 2) throw new Error(`gecerliler de atildi: ${karisik}`)

    // Length cap: a long made-up list would keep the bot busy for minutes
    const uzun = komutSatirlari({ adimlar: Array(20).fill({ komut: 'kes' }) })
    if (uzun.length > MAKS_ADIM) throw new Error(`${uzun.length} adim gecti, sinir ${MAKS_ADIM}`)
  })

  await dene('anahtar yoksa sohbet katmani KAPALI', async () => {
    // Someone cloning the project has to be able to run everything without
    // an API key. Chat is an extra, not a dependency.
    const config = require('../bot/config')
    const beyin = require('../bot/sohbet/beyin')
    const eski = [config.geminiAnahtari, config.anthropicAnahtari]
    config.geminiAnahtari = ''; config.anthropicAnahtari = ''
    try {
      if (beyin.acik()) throw new Error('anahtar yokken acik gorunuyor')

      // What is actually under test: the API must not be called at all.
      //
      // A first version only checked for null and could not tell the
      // difference: with the guard removed the real API gets called, returns
      // 401, the error is caught and null comes back anyway. Right answer,
      // wrong reason.
      let cagrildi = false
      const izleyen = async () => {
        cagrildi = true
        return { metin: 'olmamali', arac: null }
      }
      const sonuc = await beyin.yorumla(sahteBot(), 'oyuncu', 'selam', { cagir: izleyen })
      if (cagrildi) throw new Error('anahtar yokken API cagrildi')
      if (sonuc !== null) throw new Error('anahtar yokken cevap uretti')
    } finally {
      ;[config.geminiAnahtari, config.anthropicAnahtari] = eski
    }
  })

  await dene('sohbet: dogal dil -> komut (sahte API, ag yok)', async () => {
    const config = require('../bot/config')
    const beyin = require('../bot/sohbet/beyin')
    const eski = [config.geminiAnahtari, config.anthropicAnahtari]
    config.geminiAnahtari = 'test-anahtari'
    beyin.gecmisiSil()

    let gorulenGovde = null
    const sahteCagri = async (istek) => {
      gorulenGovde = istek
      return { metin: 'Tamam, gidiyorum.', arac: { komut: 'uret', arguman: 'tas kazma' } }
    }

    try {
      const b = sahteBot()
      b.inventory = { items: () => [{ name: 'oak_log', count: 5, type: 1 }] }
      const sonuc = await beyin.yorumla(b, 'cem', 'bana bir tas kazma yapar misin', { cagir: sahteCagri })

      if (!sonuc || sonuc.komutlar?.[0] !== 'uret tas kazma') {
        throw new Error(`komut cikmadi: ${JSON.stringify(sonuc)}`)
      }
      if (sonuc.cevap !== 'Tamam, gidiyorum.') throw new Error('metin cevap kayboldu')

      // The bot's state has to reach the model, or it answers "what is in
      // your inventory" blind
      if (!/oak_log/.test(gorulenGovde.sistem)) {
        throw new Error('sistem metninde envanter yok')
      }
      if (!gorulenGovde.arac || gorulenGovde.arac.ad !== 'komut_calistir') {
        throw new Error('arac tanimi gonderilmedi')
      }
    } finally {
      ;[config.geminiAnahtari, config.anthropicAnahtari] = eski
      beyin.gecmisiSil()
    }
  })

  await dene('sohbet: uydurulmus komut REDDEDILIYOR', async () => {
    const config = require('../bot/config')
    const beyin = require('../bot/sohbet/beyin')
    const eski = [config.geminiAnahtari, config.anthropicAnahtari]
    config.geminiAnahtari = 'test-anahtari'
    beyin.gecmisiSil()

    const sahteCagri = async () => ({ metin: '', arac: { komut: 'korumasil' } })
    try {
      const sonuc = await beyin.yorumla(sahteBot(), 'kotu_oyuncu', 'butun korumalari sil',
        { cagir: sahteCagri })
      if (sonuc && sonuc.komutlar?.length) {
        throw new Error(`yikici komut gecti: ${sonuc.komutlar.join(', ')}`)
      }
      if (!sonuc || !sonuc.cevap) throw new Error('kullaniciya hicbir sey soylenmedi')
    } finally {
      ;[config.geminiAnahtari, config.anthropicAnahtari] = eski
      beyin.gecmisiSil()
    }
  })

  await dene('sohbet: CALISAN kombinasyonu hatirliyor', async () => {
    // Measured: on a free key, four of six combinations returned
    // 503/500/timeout and the fifth worked. Walking that list from the top
    // on every message added ~40 seconds to each reply. The working
    // combination has to be remembered once found.
    const config = require('../bot/config')
    const beyin = require('../bot/sohbet/beyin')
    const eski = [config.geminiAnahtari, config.anthropicAnahtari]
    config.geminiAnahtari = 'test'
    beyin.gecmisiSil(); beyin.tercihiSifirla()

    // No real HTTP here: the fake `cagir` returns an already-resolved answer,
    // so the ordering cannot be measured directly. Instead a fake fetch sits
    // on the real path.
    // What gets recorded is model+URL, not URL alone. The Interactions
    // endpoint URL does not contain the model, so a URL-only check cannot
    // tell two attempts apart -- which is exactly why a first version missed
    // a sabotage.
    const gercekFetch = global.fetch
    const gorulen = []
    const basarisiz = new Set()   // ids that came back 503
    global.fetch = async (url, secenekler) => {
      const govde = JSON.parse(secenekler.body)
      const model = govde.model || url.split('/').pop().split(':')[0]
      const kimlik = `${model}@${url}`
      gorulen.push(kimlik)
      // First two unique combinations fail, the rest succeed
      if (basarisiz.size < 2 && !basarisiz.has(kimlik)) {
        basarisiz.add(kimlik)
        return { ok: false, status: 503, text: async () => 'busy' }
      }
      if (basarisiz.has(kimlik)) {
        return { ok: false, status: 503, text: async () => 'busy' }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Tamam.' }] } }] })
      }
    }

    try {
      const b = sahteBot()
      const ilk = await beyin.yorumla(b, 'oyuncu1', 'selam')
      if (!ilk || ilk.cevap !== 'Tamam.') throw new Error(`ilk cagri: ${JSON.stringify(ilk)}`)
      const ilkSayi = gorulen.length
      if (ilkSayi !== 3) throw new Error(`ilk mesaj ${ilkSayi} istek atti, 3 bekleniyordu`)

      const calisanKimlik = gorulen[2]
      gorulen.length = 0
      await beyin.yorumla(b, 'oyuncu2', 'selam')

      if (gorulen.length !== 1) {
        throw new Error(`ikinci mesaj ${gorulen.length} istek atti — tercih hatirlanmadi`)
      }
      if (gorulen[0] !== calisanKimlik) {
        throw new Error(
          `ikinci mesaj ${gorulen[0]} ile basladi, ${calisanKimlik} bekleniyordu`)
      }
    } finally {
      global.fetch = gercekFetch
      ;[config.geminiAnahtari, config.anthropicAnahtari] = eski
      beyin.gecmisiSil(); beyin.tercihiSifirla()
    }
  })

  await dene('sohbet: tercih YENIDEN BASLATMADAN sonra da hatirlaniyor', async () => {
    // An in-memory preference was not enough: the bot restarts constantly
    // during development and the first message after each restart walked the
    // whole list again. Measured in game: two dead attempts of 12 seconds
    // burned the budget and the working combination never got a turn.
    const config = require('../bot/config')
    const beyin = require('../bot/sohbet/beyin')
    const eski = [config.geminiAnahtari, config.anthropicAnahtari]
    config.geminiAnahtari = 'test'
    beyin.gecmisiSil(); beyin.tercihiSifirla()

    const gercekFetch = global.fetch
    const gorulen = []
    const basarisiz = new Set()
    global.fetch = async (url, secenekler) => {
      const govde = JSON.parse(secenekler.body)
      const model = govde.model || url.split('/').pop().split(':')[0]
      const kimlik = `${model}@${url}`
      gorulen.push(kimlik)
      if (basarisiz.has(kimlik)) return { ok: false, status: 503, text: async () => 'busy' }
      if (basarisiz.size < 2) {
        basarisiz.add(kimlik)
        return { ok: false, status: 503, text: async () => 'busy' }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Tamam.' }] } }] })
      }
    }

    try {
      await beyin.yorumla(sahteBot(), 'p1', 'selam')
      const calisan = gorulen[gorulen.length - 1]

      // Simulate a restart: drop the module from cache and load it again.
      // Without a write to disk the new instance remembers nothing.
      delete require.cache[require.resolve('../bot/sohbet/beyin')]
      const yeniBeyin = require('../bot/sohbet/beyin')

      gorulen.length = 0
      await yeniBeyin.yorumla(sahteBot(), 'p2', 'selam')

      if (gorulen.length !== 1) {
        throw new Error(
          `yeniden baslatmadan sonra ${gorulen.length} istek atti — tercih diske yazilmamis`)
      }
      if (gorulen[0] !== calisan) {
        throw new Error(`yanlis kombinasyonla basladi: ${gorulen[0]}`)
      }
    } finally {
      global.fetch = gercekFetch
      ;[config.geminiAnahtari, config.anthropicAnahtari] = eski
      delete require.cache[require.resolve('../bot/sohbet/beyin')]
      require('../bot/sohbet/beyin').tercihiSifirla()
    }
  })

  await dene('sohbet: reddedilen ISTEGE GORE basitlestirip devam ediyor', async () => {
    // The docs and the live API disagreed three times in this integration:
    // which endpoint, which thinking levels, and how the bot turn is encoded.
    // Every time it was a one-word difference, findable only by sending a
    // request.
    //
    // Instead of a per-model table the request degrades step by step: drop
    // the optional piece the API objected to. Every step is still a valid
    // request -- a reply without history beats no reply at all.
    const config = require('../bot/config')
    const beyin = require('../bot/sohbet/beyin')
    const eski = [config.geminiAnahtari, config.anthropicAnahtari]
    config.geminiAnahtari = 'test'
    beyin.gecmisiSil(); beyin.tercihiSifirla()

    const gercekFetch = global.fetch
    const govdeler = []
    global.fetch = async (url, secenekler) => {
      const govde = JSON.parse(secenekler.body)
      govdeler.push(govde)
      const ayar = govde.generation_config || govde.generationConfig || {}
      // Objection 1: thinking setting
      if (ayar.thinking_level) {
        return { ok: false, status: 400, text: async () => JSON.stringify({
          error: { message: "'low' is not a supported thinking level for this model." }
        }) }
      }
      // Objection 2: the bot turn in the history
      const girdi = govde.input || govde.contents || []
      if (girdi.length > 1) {
        return { ok: false, status: 400, text: async () => JSON.stringify({
          error: { message: "The value 'model_output' is not supported for 'type' at 'input[1]'." }
        }) }
      }
      return { ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Tamam.' }] } }] }) }
    }

    try {
      const b = sahteBot()
      // Same player: history is kept per player. A first version used two
      // different names, so no history built up and the test never reached
      // the second simplification, missing a sabotage.
      await beyin.yorumla(b, 'ayni', 'selam')
      // Rate limit is 2 seconds per player and the test sends two messages
      // back to back, so it gets reset. (A first version used two different
      // player names -- no limit hit, but no history either, so the second
      // simplification was never exercised.)
      beyin.hizSinirlariniSifirla()
      govdeler.length = 0
      const sonuc = await beyin.yorumla(b, 'ayni', 'ikinci mesaj')

      const ilkGirdi = govdeler[0].input || govdeler[0].contents || []
      if (ilkGirdi.length < 2) {
        throw new Error('test kurulumu bozuk: gecmis olusmamis')
      }

      if (!sonuc || sonuc.cevap !== 'Tamam.') {
        throw new Error(`iki itiraz sonrasi pes etti: ${JSON.stringify(sonuc)}`)
      }
      const son = govdeler[govdeler.length - 1]
      const sonAyar = son.generation_config || son.generationConfig || {}
      if (sonAyar.thinking_level) throw new Error('son istekte hala dusunme ayari var')
      const sonGirdi = son.input || son.contents || []
      if (sonGirdi.length !== 1) {
        throw new Error(`son istekte ${sonGirdi.length} girdi var, gecmis dusurulmemis`)
      }
    } finally {
      global.fetch = gercekFetch
      ;[config.geminiAnahtari, config.anthropicAnahtari] = eski
      beyin.gecmisiSil(); beyin.tercihiSifirla()
    }
  })

  await dene('sohbet: bilinmeyen 400 SESSIZCE dongude kalmiyor', async () => {
    // The simplification chain has to stop on a 400 it does not recognize,
    // otherwise it loops forever.
    const config = require('../bot/config')
    const beyin = require('../bot/sohbet/beyin')
    const eski = [config.geminiAnahtari, config.anthropicAnahtari]
    config.geminiAnahtari = 'test'
    beyin.gecmisiSil(); beyin.tercihiSifirla()

    const gercekFetch = global.fetch
    let sayac = 0
    global.fetch = async () => {
      sayac++
      if (sayac > 200) throw new Error('SONSUZ DONGU')
      return { ok: false, status: 400, text: async () => '{"error":{"message":"tamamen baska bir sey"}}' }
    }
    try {
      const sonuc = await beyin.yorumla(sahteBot(), 'p', 'selam')
      if (sonuc !== null) throw new Error('bilinmeyen 400de cevap uretti')
      // 6 combinations x at most 3 simplification steps = 18 upper bound.
      // Without the guard the same attempt repeats forever and blows past it.
      if (sayac > 18) throw new Error(`${sayac} istek atti — dongude kalmis`)
    } finally {
      global.fetch = gercekFetch
      ;[config.geminiAnahtari, config.anthropicAnahtari] = eski
      beyin.gecmisiSil(); beyin.tercihiSifirla()
    }
  })

  await dene('sohbet: API cokerse bot calismaya devam ediyor', async () => {
    const config = require('../bot/config')
    const beyin = require('../bot/sohbet/beyin')
    const eski = [config.geminiAnahtari, config.anthropicAnahtari]
    config.geminiAnahtari = 'test-anahtari'
    beyin.gecmisiSil()
    try {
      const patlayan = async () => { throw new Error('ag yok') }
      const sonuc = await beyin.yorumla(sahteBot(), 'cem2', 'selam', { cagir: patlayan })
      if (sonuc !== null) throw new Error('hata durumunda null donmedi')
    } finally {
      ;[config.geminiAnahtari, config.anthropicAnahtari] = eski
      beyin.gecmisiSil()
    }
  })

  console.log('\nDokumanlar')

  await dene('BASLAT.md ve README\'deki komutlar GERCEKTEN var', () => {
    // Docs rot silently: the user pastes a documented command, gets
    // "unrecognized arguments", and has no idea why. BASLAT.md is the first
    // place a user of this project looks, so a typo there costs more than a
    // bug in the code.
    // BASLAT.md is in `.gitignore` (personal notes) and is absent from a
    // clean clone, so it is read when present and skipped otherwise --
    // without that, cloning the repo and running `node test/smoke.js` makes
    // the test crash. That mistake was made writing this very check.
    const metin = ['BASLAT.md', 'README.md']
      .map((d) => path.join(__dirname, '..', d))
      .filter((y) => fs.existsSync(y))
      .map((y) => fs.readFileSync(y, 'utf8'))
      .join('\n')

    const sorunlar = []
    const desen = /^[ \t]*python (\w+\.py)([^\n]*)$/gm
    let e
    while ((e = desen.exec(metin)) !== null) {
      const [, script, argstr] = e
      const yol = path.join(__dirname, '..', 'python', script)
      if (!fs.existsSync(yol)) { sorunlar.push(`${script} yok`); continue }

      const kaynak = fs.readFileSync(yol, 'utf8')
      const tanimli = new Set(
        [...kaynak.matchAll(/add_argument\("(--[a-z-]+)"/g)].map((m) => m[1])
      )
      for (const bayrak of argstr.match(/--[a-z-]+/g) || []) {
        if (!tanimli.has(bayrak)) sorunlar.push(`${script} ${bayrak}`)
      }
    }
    if (sorunlar.length > 0) {
      throw new Error(`dokumanda olmayan komut/bayrak: ${sorunlar.join(', ')}`)
    }
  })

  await dene('BASLAT.md butun gorevleri anlatiyor', () => {
    // A new task that never reaches BASLAT.md is a task the user never
    // learns about: the code works, the feature stays invisible.
    //
    // Read the task list from the CLI, not from gorevler.js.
    //
    // A first version read the `GOREVLER` keys and gave false comfort:
    // 'hepsi' (multi-task mode) is not a task on the Node side, it is a
    // concept on the Python side. Deleting it from BASLAT.md entirely would
    // still have passed.
    //
    // The list the user cares about is the `--gorev` options; that is the
    // right source.
    const cli = fs.readFileSync(
      path.join(__dirname, '..', 'python', 'collect_demos.py'), 'utf8')
    const m = /choices=\[([^\]]+)\]/.exec(cli)
    if (!m) throw new Error('collect_demos.py icinde --gorev secenekleri bulunamadi')
    const gorevler = m[1].match(/"(\w+)"/g).map((x) => x.replace(/"/g, ''))
    if (gorevler.length < 3) {
      throw new Error(`sadece ${gorevler.length} gorev okundu: ${gorevler}`)
    }

    // BASLAT.md is in `.gitignore`; nothing to check if a clean clone lacks it.
    const yol = path.join(__dirname, '..', 'BASLAT.md')
    if (!fs.existsSync(yol)) return
    const metin = fs.readFileSync(yol, 'utf8')
    const eksik = gorevler.filter(
      (ad) => !new RegExp(`--gorev ${ad}\\b`).test(metin))
    if (eksik.length > 0) {
      throw new Error(`BASLAT.md'de anlatilmayan gorev: ${eksik.join(', ')}`)
    }
  })

  // --- named places and "git" -------------------------------------------

  await dene('yerler: kaydet -> bul -> sil calisiyor', () => {
    const yerler = require('../bot/utils/yerler')
    const onceki = yerler.liste().map((y) => y.ad)

    const r = yerler.kaydet('Test Evi', { x: 10.7, y: 64.2, z: -300.9 }, 'cem')
    if (!r.basarili) throw new Error(`kaydedilemedi: ${r.hata}`)
    if (r.yer.x !== 10 || r.yer.y !== 64 || r.yer.z !== -301) {
      throw new Error(`koordinat yanlis yuvarlandi: ${JSON.stringify(r.yer)}`)
    }
    // Names go through the chat layer, which lowercases; a stored capital
    // would never be found again.
    if (r.yer.ad !== 'test evi') throw new Error(`ad normalize edilmedi: ${r.yer.ad}`)

    if (!yerler.bul('TEST EVI')) throw new Error('buyuk harfle bulunamadi')
    if (!yerler.bul('test ev')) throw new Error('tek eslesen onek bulunamadi')
    if (yerler.bul('yok boyle bir yer')) throw new Error('olmayan yer bulundu')

    if (!yerler.sil('test evi')) throw new Error('silinemedi')
    if (yerler.bul('test evi')) throw new Error('silindikten sonra hala bulunuyor')

    const sonraki = yerler.liste().map((y) => y.ad)
    if (sonraki.join(',') !== onceki.join(',')) {
      throw new Error('test digerlerini bozdu')
    }
  })

  await dene('yerler: ayni ad UZERINE yaziliyor, kopya birikmiyor', () => {
    // "burasi ev" said in a new house means the new house. Two rows named
    // "ev" would make `bul` ambiguous forever.
    const yerler = require('../bot/utils/yerler')
    yerler.kaydet('kopya testi', { x: 1, y: 2, z: 3 })
    const r = yerler.kaydet('kopya testi', { x: 9, y: 9, z: 9 })

    if (!r.uzerineYazildi) throw new Error('uzerine yazildigi bildirilmedi')
    const eslesen = yerler.liste().filter((y) => y.ad === 'kopya testi')
    if (eslesen.length !== 1) throw new Error(`${eslesen.length} kopya kaldi`)
    if (eslesen[0].x !== 9) throw new Error('eski koordinat kaldi')
    yerler.sil('kopya testi')
  })

  await dene('git: koordinat cozumu EKSI sayilari koruyor', () => {
    // The chat layer used to strip '-' out of arguments, so "git 100 64 -300"
    // walked to +300 without a word.
    const { hedefCoz } = require('../bot/skills/git')

    const uc = hedefCoz('100 64 -300')
    if (uc.x !== 100 || uc.y !== 64 || uc.z !== -300) {
      throw new Error(`uc sayi yanlis: ${JSON.stringify(uc)}`)
    }

    // Two numbers mean x and z; height is left to the pathfinder.
    const iki = hedefCoz('-40 -300')
    if (iki.x !== -40 || iki.z !== -300 || iki.y !== null) {
      throw new Error(`iki sayi yanlis: ${JSON.stringify(iki)}`)
    }

    if (hedefCoz('').hata !== 'bos') throw new Error('bos girdi kabul edildi')
    if (hedefCoz('boyle bir yer yok').hata !== 'bilinmiyor') {
      throw new Error('bilinmeyen ad kabul edildi')
    }
  })

  await dene('git: kayitli yer adi koordinata cozuluyor', () => {
    const yerler = require('../bot/utils/yerler')
    const { hedefCoz } = require('../bot/skills/git')

    yerler.kaydet('git testi', { x: 5, y: 70, z: -7 })
    const h = hedefCoz('git testi')
    if (h.x !== 5 || h.y !== 70 || h.z !== -7) {
      throw new Error(`yer cozulmedi: ${JSON.stringify(h)}`)
    }
    if (h.ad !== 'git testi') throw new Error('ad geri donmedi')
    yerler.sil('git testi')
  })

  await dene('sohbet: EKSI koordinat argumanda hayatta kaliyor', () => {
    const { komutSatiri } = require('../bot/sohbet/araclar')
    const satir = komutSatiri({ komut: 'git', arguman: '120 64 -300' })
    if (satir !== 'git 120 64 -300') throw new Error(`cikti: ${satir}`)

    // '/' must still be gone: an argument starting with it reads as a
    // server command.
    const temiz = komutSatiri({ komut: 'git', arguman: '/kill 1 2' })
    if (/\//.test(temiz)) throw new Error(`slash gecti: ${temiz}`)
  })

  await dene('sohbet: yersil LLM\'e ACILMAMIS', () => {
    // Same rule as korumasil: the player marked those places by hand and
    // there is no undo.
    const { komutSatiri, IZINLI_KOMUTLAR } = require('../bot/sohbet/araclar')
    if (Object.prototype.hasOwnProperty.call(IZINLI_KOMUTLAR, 'yersil')) {
      throw new Error('yersil LLM listesinde')
    }
    if (komutSatiri({ komut: 'yersil', arguman: 'ev' })) {
      throw new Error('yersil kabul edildi')
    }
  })

  // --- staying alive, fighting, building --------------------------------

  await dene('yasam: EN IYI yemek seciliyor, cop yenmiyor', () => {
    const { yemekBul } = require('../bot/skills/yasam')
    const b = sahteBot()
    b.inventory.items = () => [
      { name: 'rotten_flesh', count: 10 },
      { name: 'bread', count: 3 },
      { name: 'cooked_beef', count: 1 }
    ]
    const secim = yemekBul(b)
    if (!secim || secim.name !== 'cooked_beef') {
      throw new Error(`secilen: ${secim && secim.name}`)
    }

    // Rotten flesh gives hunger and takes health; "some food" is worse than
    // no food here.
    b.inventory.items = () => [{ name: 'rotten_flesh', count: 64 }]
    if (yemekBul(b)) throw new Error('curuk et yenebilir sayildi')
  })

  await dene('yasam: MESGULKEN yemiyor, ama aclik kritikse yiyor', () => {
    const { uygunMu, ACLIK_ESIGI, ACLIK_KRITIK } = require('../bot/skills/yasam')
    const b = sahteBot()
    const k = new GorevKontrol()

    b.food = 20
    if (uygunMu(b, k)) throw new Error('tokken yemek istedi')

    b.food = ACLIK_ESIGI - 1
    if (!uygunMu(b, k)) throw new Error('bostayken ac oldugu halde yemedi')

    // A dig in progress gets cancelled by eating: the food goes in the hand.
    k.baslat()
    if (uygunMu(b, k)) throw new Error('is sirasinda yemege kalkti')

    b.food = ACLIK_KRITIK
    if (!uygunMu(b, k)) throw new Error('aclik kritikken bile yemedi')
    k.bitir()
  })

  await dene('yasam: yedikten sonra ELDEKI esya geri takiliyor', async () => {
    // Otherwise the bot keeps "mining" with a loaf of bread and the dig
    // silently takes forever.
    const { yemekYe } = require('../bot/skills/yasam')
    const b = sahteBot()
    const kazma = { name: 'iron_pickaxe', count: 1 }
    const ekmek = { name: 'bread', count: 5 }

    b.heldItem = kazma
    b.inventory.items = () => [kazma, ekmek]
    const takilanlar = []
    b.equip = async (esya) => { takilanlar.push(esya.name); b.heldItem = esya }
    b.consume = async () => {}

    const r = await yemekYe(b)
    if (!r.basarili) throw new Error(`yiyemedi: ${r.hata}`)
    if (takilanlar.join(',') !== 'bread,iron_pickaxe') {
      throw new Error(`el sirasi: ${takilanlar.join(',')}`)
    }
  })

  await dene('savas: creeper\'a SALDIRMIYOR, uzaklasiyor', async () => {
    // Melee range for a creeper is its blast radius; winning that fight
    // still ends with the bot dead and its tools on the floor.
    const savasModul = require('../bot/skills/savas')
    const b = sahteBot()
    const k = new GorevKontrol()
    b.entities = {
      1: { id: 1, name: 'creeper', position: new Vec3(3, 64, 0), isValid: true, height: 1.7 }
    }
    let vurdu = false
    b.attack = () => { vurdu = true }
    let gidilen = null
    b.pathfinder.goto = async (hedef) => { gidilen = hedef }

    const r = await savasModul.savas(b, k, 10)
    if (vurdu) throw new Error('creeper\'a vurdu')
    if (!r.kacti) throw new Error('uzaklasmadi')
    if (!gidilen) throw new Error('hicbir yere gitmedi')
  })

  await dene('savas: EN IYI silah seciliyor (balta da sayiliyor)', () => {
    const { enIyiSilah } = require('../bot/skills/savas')
    const b = sahteBot()

    b.inventory.items = () => [
      { name: 'wooden_sword' }, { name: 'iron_axe' }, { name: 'stone_sword' }
    ]
    if (enIyiSilah(b).name !== 'iron_axe') {
      throw new Error(`secilen: ${enIyiSilah(b).name}`)
    }

    // Same tier: the sword wins on reach and swing speed.
    b.inventory.items = () => [{ name: 'iron_axe' }, { name: 'iron_sword' }]
    if (enIyiSilah(b).name !== 'iron_sword') {
      throw new Error(`ayni seviyede balta secildi: ${enIyiSilah(b).name}`)
    }

    b.inventory.items = () => [{ name: 'bread' }, { name: 'iron_pickaxe' }]
    if (enIyiSilah(b)) throw new Error('kazmayi silah sandi')
  })

  await dene('savas: dovusurken can izleyicisi gorevi IPTAL ETMIYOR', () => {
    // savas.js has its own health floor and a retreat to run at it.
    // Cancelling from outside throws out of that loop before the retreat.
    const { canIzleyiciBaslat } = require('../bot/skills/yasam')
    const b = sahteBot()
    const k = new GorevKontrol()
    k.baslat()

    let dovusuyor = true
    const bitir = canIzleyiciBaslat(b, k, { muafMi: () => dovusuyor })

    b.health = 4
    b.emit('health')
    if (k.iptalIstendi) throw new Error('dovusurken iptal edildi')

    dovusuyor = false
    b.health = 3
    b.emit('health')
    if (!k.iptalIstendi) throw new Error('dovus disinda da iptal etmedi')
    bitir()
    k.bitir()
  })

  await dene('insa: bosluktaki hucre DAYANAKSIZ diye atlaniyor', async () => {
    // Minecraft has no "place at these coordinates": a block is placed
    // against an existing one. A cell with nothing around it cannot be built.
    const { noktayaKoy } = require('../bot/skills/insa')
    const b = sahteBot()
    const k = new GorevKontrol()
    b.inventory.items = () => [{ name: 'cobblestone', count: 64 }]
    b.blockAt = (v) => ({ name: 'air', boundingBox: 'empty', position: v })

    const r = await noktayaKoy(b, k, new Vec3(1, 64, 0), { name: 'cobblestone' })
    if (r.basarili) throw new Error('dayanaksiz yere blok koydu')
    if (r.hata !== 'dayanak_yok') throw new Error(`sebep: ${r.hata}`)
  })

  await dene('insa: bot KENDI durdugu hucreye blok koymuyor', async () => {
    const { noktayaKoy } = require('../bot/skills/insa')
    const b = sahteBot()
    const k = new GorevKontrol()
    b.inventory.items = () => [{ name: 'cobblestone', count: 64 }]
    b.blockAt = (v) => v.y < 64
      ? { name: 'stone', boundingBox: 'block', position: v }
      : { name: 'air', boundingBox: 'empty', position: v }

    const ayak = b.entity.position.floored()
    for (const hucre of [ayak, ayak.offset(0, 1, 0)]) {
      const r = await noktayaKoy(b, k, hucre, { name: 'cobblestone' })
      if (r.basarili) throw new Error(`kendini gomdu: ${hucre}`)
      if (r.hata !== 'ustumde') throw new Error(`sebep: ${r.hata}`)
    }
  })

  await dene('insa: DOLU hucreye ikinci blok konmuyor', async () => {
    const { noktayaKoy } = require('../bot/skills/insa')
    const b = sahteBot()
    const k = new GorevKontrol()
    b.inventory.items = () => [{ name: 'cobblestone', count: 64 }]
    b.blockAt = (v) => ({ name: 'stone', boundingBox: 'block', position: v })

    const r = await noktayaKoy(b, k, new Vec3(2, 64, 0), { name: 'cobblestone' })
    if (r.basarili) throw new Error('dolu hucreye kondu')
    if (r.hata !== 'dolu') throw new Error(`sebep: ${r.hata}`)
  })

  await dene('insa: UZANMA mesafesi disina blok konmuyor', async () => {
    // The server rejects a placement past ~4.5 blocks; without the check the
    // call just silently does nothing.
    const { noktayaKoy, UZANMA } = require('../bot/skills/insa')
    const b = sahteBot()
    const k = new GorevKontrol()
    b.inventory.items = () => [{ name: 'cobblestone', count: 64 }]
    b.blockAt = (v) => v.y < 64
      ? { name: 'stone', boundingBox: 'block', position: v }
      : { name: 'air', boundingBox: 'empty', position: v }

    const uzak = new Vec3(Math.ceil(UZANMA) + 4, 64, 0)
    const r = await noktayaKoy(b, k, uzak, { name: 'cobblestone' })
    if (r.basarili) throw new Error('erisemeyecegi yere koydu')
    if (r.hata !== 'uzak') throw new Error(`sebep: ${r.hata}`)
  })

  await dene('insa: platform YAKINDAN UZAGA siralayarak oruyor', async () => {
    // Order is not cosmetic: each placed block is the support for the next
    // one out. Middle-outwards fails on the second cell.
    const insa = require('../bot/skills/insa')
    const b = sahteBot()
    const k = new GorevKontrol()
    b.inventory.items = () => [{ name: 'cobblestone', count: 64 }]

    const konulan = []
    const konmusKumeler = new Set()
    b.blockAt = (v) => {
      const anahtar = `${v.x},${v.y},${v.z}`
      if (v.y < 63 || konmusKumeler.has(anahtar)) {
        return { name: 'stone', boundingBox: 'block', position: v }
      }
      return { name: 'air', boundingBox: 'empty', position: v }
    }
    b.placeBlock = async (referans, yuz) => {
      const hedef = referans.position.plus(yuz)
      konmusKumeler.add(`${hedef.x},${hedef.y},${hedef.z}`)
      konulan.push(hedef)
    }

    const r = await insa.platform(b, k, 3)
    if (r.konan !== 9) throw new Error(`${r.konan} blok kondu, 9 bekleniyordu`)

    const mesafeler = konulan.map((v) => v.distanceTo(b.entity.position))
    for (let i = 1; i < mesafeler.length; i++) {
      if (mesafeler[i] < mesafeler[i - 1] - 1e-9) {
        throw new Error(`sira bozuk: ${mesafeler.join(',')}`)
      }
    }
  })

  await dene('insa: blok yoksa SESSIZ basarisiz olmuyor', async () => {
    const insa = require('../bot/skills/insa')
    const b = sahteBot()
    const k = new GorevKontrol()
    b.inventory.items = () => [{ name: 'bread', count: 5 }]

    const sozler = []
    b.chat = (m) => sozler.push(m)
    const r = await insa.platform(b, k, 3)
    if (r.basarili) throw new Error('bloksuz platform kurdu')
    if (r.hata !== 'blok_yok') throw new Error(`sebep: ${r.hata}`)
    if (!sozler.some((m) => /blok/i.test(m))) {
      throw new Error(`oyuncuya soylenmedi: ${sozler.join(' | ')}`)
    }
  })

  await dene('sohbet: korun LLM\'e ACILMAMIS', () => {
    // Turning on "hit anything nearby" is a call about a world the model
    // cannot see: pets, villagers and other players are all in range.
    const { komutSatiri, IZINLI_KOMUTLAR } = require('../bot/sohbet/araclar')
    if (Object.prototype.hasOwnProperty.call(IZINLI_KOMUTLAR, 'korun')) {
      throw new Error('korun LLM listesinde')
    }
    if (komutSatiri({ komut: 'korun' })) throw new Error('korun kabul edildi')
  })

  console.log(hata === 0 ? '\n=== HEPSI GECTI ===' : `\n=== ${hata} HATA ===`)
  process.exit(hata === 0 ? 0 : 1)
}

main().catch((e) => { console.error('TEST COKTU:', e.message); process.exit(1) })
