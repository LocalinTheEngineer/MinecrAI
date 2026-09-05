'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderGit } = require('../utils/gorev')
const { uygunAlet } = require('./alet')
const { uret } = require('./uret')
const { dusenleriTopla } = require('./chopTree')
const koruma = require('../utils/koruma')

/**
 * Skill: mine ("kaz demir", "kaz elmas 5").
 *
 * Mining differs from chopping in three ways:
 *
 * 1) A tool is mandatory. Break stone by hand and the block disappears with
 *    no drop. Iron ore needs a stone pickaxe, diamond needs an iron one.
 *    Breaking with the wrong pickaxe destroys the ore, so the tier gets
 *    checked before every break.
 *
 * 2) Ore is not visible. A tree stands on the surface, ore sits inside stone:
 *    get to the right depth first, search afterwards.
 *
 * 3) Digging straight down kills. It is the classic Minecraft death: a lava
 *    lake or a 30-block cave can be right underneath and neither is visible
 *    until the block is gone. So the descent is a staircase, one step forward
 *    and one down, with solid ground always underfoot.
 */

// Turkish name -> block names. Deep down stone becomes deepslate and the ore
// name changes with it (iron_ore / deepslate_iron_ore), so both are listed.
const CEVHERLER = {
  komur: { bloklar: ['coal_ore', 'deepslate_coal_ore'], seviye: 'wooden', y: 50 },
  kömür: { bloklar: ['coal_ore', 'deepslate_coal_ore'], seviye: 'wooden', y: 50 },
  bakir: { bloklar: ['copper_ore', 'deepslate_copper_ore'], seviye: 'stone', y: 48 },
  bakır: { bloklar: ['copper_ore', 'deepslate_copper_ore'], seviye: 'stone', y: 48 },
  demir: { bloklar: ['iron_ore', 'deepslate_iron_ore'], seviye: 'stone', y: 15 },
  altin: { bloklar: ['gold_ore', 'deepslate_gold_ore'], seviye: 'iron', y: -16 },
  altın: { bloklar: ['gold_ore', 'deepslate_gold_ore'], seviye: 'iron', y: -16 },
  redstone: { bloklar: ['redstone_ore', 'deepslate_redstone_ore'], seviye: 'iron', y: -58 },
  lapis: { bloklar: ['lapis_ore', 'deepslate_lapis_ore'], seviye: 'stone', y: 0 },
  elmas: { bloklar: ['diamond_ore', 'deepslate_diamond_ore'], seviye: 'iron', y: -58 },
  zumrut: { bloklar: ['emerald_ore', 'deepslate_emerald_ore'], seviye: 'iron', y: 100 },
  zümrüt: { bloklar: ['emerald_ore', 'deepslate_emerald_ore'], seviye: 'iron', y: 100 },
  tas: { bloklar: ['stone', 'deepslate', 'andesite', 'diorite', 'granite'], seviye: 'wooden', y: null },
  taş: { bloklar: ['stone', 'deepslate', 'andesite', 'diorite', 'granite'], seviye: 'wooden', y: null }
}

// Pickaxe tiers, weakest first. An ore that asks for "iron" also breaks with
// a diamond pickaxe, which is what the index comparison is for.
const SEVIYELER = ['wooden', 'stone', 'iron', 'diamond', 'netherite']

// Blocks that stop the dig if they turn up
const TEHLIKELI = /lava|bedrock/
const SU = /water|bubble_column/

// Durability at which a replacement pickaxe gets crafted.
// Waiting for zero is too late: the moment it breaks the hand is empty and
// the next ore broken is destroyed (ore broken without a tool drops nothing).
const KRITIK_DAYANIKLILIK = 20

// Stock is measured in total swings, not in number of pickaxes.
//
// The bot used to craft an iron pickaxe while holding a diamond one, because
// the stock check asked "do I have 3 pickaxes". One diamond pickaxe is 1561
// swings, four times what three stone pickaxes give (393). By count it looks
// like "only one, not enough", by swings it is plenty.
//
// Reference durabilities: wood 59, stone 131, iron 250, diamond 1561.
// Going from y=64 to y=15 is ~49 steps x 3 blocks = ~147 swings.
const GUVENLIK_PAYI = 40

/** Swings left on this item (Infinity for items with no durability) */
function kalanDayaniklilik (esya) {
  if (!esya || !esya.maxDurability) return Infinity
  return esya.maxDurability - (esya.durabilityUsed || 0)
}

/**
 * Total swings left across every pickaxe that meets the required tier.
 * Summed, not checked one by one: two half-worn pickaxes make a whole one.
 */
function kazmaGucu (bot, gerekliSeviye) {
  const gerekli = SEVIYELER.indexOf(gerekliSeviye)
  let toplam = 0
  let adet = 0
  for (const esya of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(esya.name)
    if (!m) continue
    const seviye = SEVIYELER.indexOf(m[1] === 'golden' ? 'stone' : m[1])
    if (seviye < gerekli) continue
    toplam += kalanDayaniklilik(esya)
    adet++
  }
  return { toplam, adet }
}

/**
 * Swings this job costs: descent + mining + safety margin.
 * Derived from the size of the job, not guessed.
 */
function gerekenVurus (bot, hedefY, adet) {
  const su = Math.floor(bot.entity.position.y)
  const derinlik = hedefY === null ? 0 : Math.max(0, su - hedefY)
  return derinlik * 3 + adet * 2 + GUVENLIK_PAYI
}

/**
 * Top the pickaxe stock up to a swing target.
 *
 * The stone being mined is already in the inventory, so a stone pickaxe can
 * be crafted underground. The only requirement is a crafting table on hand,
 * which is why one gets made before the descent.
 */
async function kazmaStokla (bot, kontrol, seviye, hedefVurus, secenekler = {}) {
  const istek = seviye === 'wooden'
    ? 'tahta kazma'
    : seviye === 'stone'
      ? 'tas kazma'
      : seviye === 'iron' ? 'demir kazma' : 'elmas kazma'

  let yapilan = 0
  for (let i = 0; i < 5; i++) {
    kontrol.kontrolEt()
    if (kazmaGucu(bot, seviye).toplam >= hedefVurus) break
    const r = await uret(bot, kontrol, istek, 1, secenekler)
    if (!r.basarili) break
    yapilan++
  }
  return yapilan
}

// Health below this means leave. Full health is 20, so 12 is three hearts
// gone. Lava does ~4 health per second: noticing at 12 leaves just enough
// time to get out.
const KACIS_CANI = 12

// How many blocks ahead to scan for lava before tunnelling
const LAV_TARAMA = 4

/**
 * Null when safe, otherwise the reason it is not.
 *
 * Not having this cost a death: the bot walked into a lava lake and kept
 * mining because nothing in the code looked at its health. The blocks it
 * broke were safety-checked, the bot's own state never was.
 */
function tehlikedeMi (bot) {
  if (typeof bot.health === 'number' && bot.health < KACIS_CANI) {
    return `canım azaldı (${bot.health.toFixed(0)}/20)`
  }
  const ayak = bot.blockAt(bot.entity.position)
  const alt = bot.blockAt(bot.entity.position.offset(0, -1, 0))
  for (const b of [ayak, alt]) {
    if (b && /lava/.test(b.name)) return 'lavın içindeyim'
  }
  return null
}

/**
 * Is there lava in the direction of travel?
 *
 * `guvenliMi` only looks at the neighbours of the block being broken, so
 * anything one block further out is a blind spot. That is exactly how
 * tunnelling punches through the wall of a lava lake and walks in.
 */
function ondeLavVarMi (bot, yon, menzil = LAV_TARAMA) {
  const ayak = bot.entity.position.floored()
  for (let i = 1; i <= menzil; i++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (const yan of [-1, 0, 1]) {
        const p = ayak.offset(
          yon.x * i + (yon.x === 0 ? yan : 0),
          dy,
          yon.z * i + (yon.z === 0 ? yan : 0)
        )
        const b = bot.blockAt(p)
        if (b && /lava/.test(b.name)) return true
      }
    }
  }
  return false
}

/** Tier of the best pickaxe in the inventory, null if there is none */
function kazmaSeviyesi (bot) {
  let enIyi = -1
  for (const esya of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(esya.name)
    if (!m) continue
    const i = SEVIYELER.indexOf(m[1] === 'golden' ? 'stone' : m[1])
    if (i > enIyi) enIyi = i
  }
  return enIyi < 0 ? null : SEVIYELER[enIyi]
}

/** Nearest cardinal direction the bot is facing */
function ileriYon (bot) {
  const yaw = bot.entity.yaw
  const x = -Math.sin(yaw)
  const z = -Math.cos(yaw)
  return Math.abs(x) > Math.abs(z)
    ? new Vec3(Math.sign(x), 0, 0)
    : new Vec3(0, 0, Math.sign(z))
}

/** Is breaking this block safe? Any lava or water next to it? */
/**
 * Is breaking this block safe?
 *
 * Water is dangerous or not depending on where the bot is headed.
 *
 * It used to be an absolute blocker like lava, which silently rejected
 * reachable diamonds: water pockets are common down deep. The distinction:
 *
 *  - Hitting an ore from a distance: water beside it does not matter, worst
 *    case it floods a little while the bot stays put.
 *  - Digging the staircase: the bot steps into that gap itself, and opening a
 *    water pocket and walking into it means drowning.
 *
 * So `suTehlikeli` is the caller's call: the staircase passes true, ore
 * breaking passes false.
 */
function guvenliMi (bot, konum, { suTehlikeli = false } = {}) {
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const b = bot.blockAt(konum.offset(dx, dy, dz))
    if (!b) continue
    if (TEHLIKELI.test(b.name)) return false
    if (suTehlikeli && SU.test(b.name)) return false
  }
  return true
}

/** Break one block, if it can be broken */
async function blogoKir (bot, konum, kontrol, gerekliSeviye = null, { suTehlikeli = false } = {}) {
  const b = bot.blockAt(konum)
  if (!b || b.name === 'air' || b.boundingBox !== 'block') return true

  // Say why it refused.
  //
  // The bot failed to break a reachable diamond and looped, and the log had
  // not one line of reason: the only way to find out was reading the code and
  // guessing. Every refusal now names its cause.
  const reddet = (sebep) => {
    log.uyari(`${b.name} @ ${konum} kırılmadı: ${sebep}`)
    return false
  }

  if (koruma.korumaliMi(konum)) return reddet('koruma bölgesi')
  if (!guvenliMi(bot, konum, { suTehlikeli })) return reddet('yanında lav, su veya bedrock var')
  if (!bot.canDigBlock(b)) {
    const goz = bot.entity.position.offset(0, bot.entity.height || 1.62, 0)
    const uzaklik = goz.distanceTo(konum.offset(0.5, 0.5, 0.5))
    return reddet(`kazılamıyor (uzaklık ${uzaklik.toFixed(1)}, görüş kapalı olabilir)`)
  }

  const alet = uygunAlet(bot, b)

  // Never hit ore without a tool.
  //
  // `canDigBlock` answers "can you break it", not "will it drop". By hand,
  // stone and ore both break and nothing lands on the floor. If the bot keeps
  // working after its pickaxe breaks it silently erases a diamond vein, so a
  // broken pickaxe is not just a slowdown, it is ore lost for good.
  if (gerekliSeviye && /ore$|ancient_debris/.test(b.name)) {
    const { toplam } = kazmaGucu(bot, gerekliSeviye)
    if (toplam <= 0) return reddet(`${gerekliSeviye} kazma gerekiyor, yok`)
  }

  if (alet) { try { await bot.equip(alet, 'hand') } catch (err) { /* fall back to bare hands */ } }

  await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true)
  await sinirli(bot.dig(b), 12000, kontrol)
  return true
}

/**
 * Descend one staircase step.
 *
 * Each step breaks three blocks: foot and head level ahead to walk through,
 * and the one below that to descend into. The ground underfoot is never
 * removed, so there is no fall and no stepping into lava. If lava or water
 * shows up the step is abandoned before anything is broken.
 */
async function birBasamakIn (bot, kontrol, gerekliSeviye = null) {
  const yon = ileriYon(bot)
  if (ondeLavVarMi(bot, yon)) return { ok: false, sebep: 'onde_lav' }
  const ayak = bot.entity.position.floored()

  const onAyak = ayak.plus(yon)
  const onBas = onAyak.offset(0, 1, 0)
  const onAlt = onAyak.offset(0, -1, 0)

  for (const konum of [onBas, onAyak, onAlt]) {
    kontrol.kontrolEt()
    // the bot steps into this gap, so water is a hazard here (drowning)
    if (!guvenliMi(bot, konum, { suTehlikeli: true })) return { ok: false, sebep: 'tehlike' }
  }

  // Open cave case.
  //
  // The staircase assumes solid stone ahead. In the huge post-1.18 caves that
  // assumption breaks: there is already air ahead, nothing to break, and the
  // code then tried to walk to a point in mid-air and reported "yuruyemedim".
  // A screenshot caught exactly this, the bot stuck on a cave ledge, unable
  // to descend.
  //
  // Nothing to dig when it is already open: that is the pathfinder's job.
  const onuBos = [onBas, onAyak, onAlt].every((k) => {
    const b = bot.blockAt(k)
    return !b || b.boundingBox !== 'block'
  })
  if (onuBos) return { ok: false, sebep: 'acik_alan' }

  for (const konum of [onBas, onAyak, onAlt]) {
    kontrol.kontrolEt()
    if (!(await blogoKir(bot, konum, kontrol, gerekliSeviye, { suTehlikeli: true }))) {
      return { ok: false, sebep: 'kirilamadi' }
    }
  }

  // walk into the gap just opened
  const git = await pathfinderGit(bot, new goals.GoalBlock(onAlt.x, onAlt.y, onAlt.z),
    kontrol, { zamanAsimi: 8000, durgunlukMs: 3000 })
  if (!git.ok) return { ok: false, sebep: git.sebep }
  return { ok: true }
}

/**
 * Tunnel one step horizontally, without descending.
 *
 * `birBasamakIn` drops one block on every call. Using it in the search loop
 * meant every "move a bit and look again" also went a level deeper, and the
 * bot ended up on bedrock. Searching is horizontal work: the depth was
 * already set by `seviyeyeIn` and has to stay there.
 */
async function birAdimIlerle (bot, kontrol, gerekliSeviye = null) {
  const yon = ileriYon(bot)
  if (ondeLavVarMi(bot, yon)) return { ok: false, sebep: 'onde_lav' }
  const ayak = bot.entity.position.floored()

  const onAyak = ayak.plus(yon)
  const onBas = onAyak.offset(0, 1, 0)

  for (const konum of [onBas, onAyak]) {
    kontrol.kontrolEt()
    if (!guvenliMi(bot, konum, { suTehlikeli: true })) return { ok: false, sebep: 'tehlike' }
  }
  for (const konum of [onBas, onAyak]) {
    kontrol.kontrolEt()
    if (!(await blogoKir(bot, konum, kontrol, gerekliSeviye, { suTehlikeli: true }))) {
      return { ok: false, sebep: 'kirilamadi' }
    }
  }

  const git = await pathfinderGit(bot, new goals.GoalBlock(onAyak.x, onAyak.y, onAyak.z),
    kontrol, { zamanAsimi: 8000, durgunlukMs: 3000 })
  if (!git.ok) return { ok: false, sebep: git.sebep }
  return { ok: true }
}

/** Take the staircase down to the target Y */
async function seviyeyeIn (bot, hedefY, kontrol, { maksBasamak = 120, seviye = 'stone', tedarikci = null } = {}) {
  let basamak = 0
  let takilma = 0

  while (Math.floor(bot.entity.position.y) > hedefY && basamak < maksBasamak) {
    kontrol.kontrolEt()

    const tehlike = tehlikedeMi(bot)
    if (tehlike) return { ok: false, basamak, sebep: `tehlike: ${tehlike}` }

    const oncekiY = Math.floor(bot.entity.position.y)

    // Pickaxe running out mid-descent.
    //
    // Each step is 3 blocks, so y=64 to y=15 is ~147 blocks against 59 swings
    // for a wooden pickaxe and 131 for a stone one. Running out halfway down
    // is the rule, not the exception. At the threshold the descent pauses and
    // a new pickaxe is crafted from the stone just mined, which is already in
    // the inventory.
    const guc = kazmaGucu(bot, seviye)
    if (guc.toplam < KRITIK_DAYANIKLILIK) {
      log.uyari(`Kazma bitmek üzere (${guc.toplam} vuruş), yenisini yapıyorum.`)
      await kazmaStokla(bot, kontrol, seviye, gerekenVurus(bot, hedefY, 0), { tedarikci })
      if (kazmaGucu(bot, seviye).toplam < KRITIK_DAYANIKLILIK) {
        return { ok: false, basamak, sebep: 'kazma_bitti' }
      }
    }

    // Pathfinder first, staircase second.
    //
    // The pathfinder knows caves, ledges, ladders and tunnels, and with
    // `canDig` on it breaks stone when it has to. The hand-written staircase
    // does the one thing it cannot: open a way through solid stone. Hence the
    // order, try the ready-made solution first and dig only if it fails.
    //
    // The descent goes in 10-block chunks: asking for all 50 at once hands
    // the pathfinder a huge search space.
    const araHedef = Math.max(hedefY, oncekiY - 10)
    await pathfinderGit(bot, new goals.GoalY(araHedef), kontrol,
      { zamanAsimi: 20000, durgunlukMs: 5000 })

    if (Math.floor(bot.entity.position.y) < oncekiY) {
      basamak++
      takilma = 0
      continue
    }

    // pathfinder made no progress: dig the staircase by hand
    const r = await birBasamakIn(bot, kontrol, seviye)
    if (!r.ok) {
      if (++takilma >= 3) return { ok: false, basamak, sebep: r.sebep }
      continue
    }
    takilma = 0
    basamak++
    if (basamak % 10 === 0) {
      log.bilgi(`y=${Math.floor(bot.entity.position.y)} (${basamak} basamak)`)
    }
  }
  return { ok: true, basamak }
}

/**
 * Flood fill from one ore block to the whole vein.
 *
 * Ore comes in veins, not single blocks: an iron vein is usually 4-9 blocks.
 * The old code picked the nearest ore each round, broke it, then searched
 * again. After a break the nearest candidate is sometimes the edge of another
 * vein, so the bot broke 2 blocks and wandered off leaving 3-4 behind.
 *
 * `agaciTopla` solves the same problem for trees: collect the whole vein into
 * a list and stay on it until it is finished.
 */
function damarTopla (bot, baslangic, isimler, limit = 24) {
  const bulunan = []
  const gorulen = new Set()
  const kuyruk = [baslangic]

  while (kuyruk.length > 0 && bulunan.length < limit) {
    const p = kuyruk.shift()
    const anahtar = `${p.x},${p.y},${p.z}`
    if (gorulen.has(anahtar)) continue
    gorulen.add(anahtar)

    const b = bot.blockAt(p)
    if (!b || !isimler.includes(b.name)) continue
    if (koruma.korumaliMi(p)) continue
    bulunan.push(p)

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          kuyruk.push(p.offset(dx, dy, dz))
        }
      }
    }
  }
  return bulunan
}

/** Nearby target ores, sorted by real distance */
function cevherBul (bot, isimler, yaricap, karaListe) {
  const idler = isimler
    .map((n) => (bot.registry.blocksByName[n] || {}).id)
    .filter((x) => x !== undefined)
  if (idler.length === 0) return []

  return bot.findBlocks({ matching: idler, maxDistance: yaricap, count: 64 })
    .filter((p) => !karaListe.has(`${p.x},${p.y},${p.z}`) && !koruma.korumaliMi(p))
    .sort((a, b) =>
      a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
}

/**
 * Main entry point.
 * @param {string} istek "demir", "elmas", "tas"
 * @param {number} adet how many blocks to break
 */
async function kaz (bot, kontrol, istek, adet = 8, secenekler = {}) {
  const ad = String(istek || 'tas').toLowerCase().trim()
  const cevher = CEVHERLER[ad]
  if (!cevher) {
    return {
      basarili: false,
      mesaj: `"${istek}" nedir bilmiyorum. Bildiklerim: ${Object.keys(CEVHERLER).join(', ')}`
    }
  }

  // --- 1) right pickaxe in hand? if not, try to craft one ---
  const gerekli = SEVIYELER.indexOf(cevher.seviye)
  let mevcut = SEVIYELER.indexOf(kazmaSeviyesi(bot))

  if (mevcut < gerekli) {
    log.bilgi(`${cevher.seviye} kazma lazım, yapmayı deniyorum...`)
    const yapim = await uret(bot, kontrol, `${cevher.seviye === 'wooden' ? 'tahta' : cevher.seviye === 'stone' ? 'tas' : 'demir'} kazma`, 1, secenekler)
    mevcut = SEVIYELER.indexOf(kazmaSeviyesi(bot))
    if (mevcut < gerekli) {
      return {
        basarili: false,
        mesaj: `${ad} için ${cevher.seviye} kazma gerekiyor, yapamadım — ${yapim.mesaj}`
      }
    }
  }

  const baslangicKonum = bot.entity.position.clone()

  // --- 2) stock up before descending ---
  //
  // One pickaxe does not get you deep (see the swing arithmetic above). The
  // bot takes spare pickaxes and a crafting table along; the table is what
  // lets it make new pickaxes down there out of the stone it mines.
  if (cevher.y !== null && Math.floor(bot.entity.position.y) > cevher.y + 8) {
    // Say why it is looking for wood.
    //
    // The user typed "kaz elmas", the bot went off hunting for trees and the
    // user fairly asked what it was doing. The reason was invisible: its
    // pickaxe was not enough for the job so it was crafting a spare, and a
    // spare pickaxe needs wood. Right behaviour, wrong that it was silent.
    const hedefVurus = gerekenVurus(bot, cevher.y, adet)
    const eldeki = kazmaGucu(bot, cevher.seviye)
    if (eldeki.toplam < hedefVurus) {
      log.bilgi(
        `Bu iş ~${hedefVurus} vuruş tutar, elimde ${eldeki.toplam} var — ` +
        'yedek kazma yapmayı deniyorum (odun/taş gerekebilir).'
      )
    }
    await kazmaStokla(bot, kontrol, cevher.seviye, hedefVurus, secenekler)
    await uret(bot, kontrol, 'tezgah', 1, secenekler) // best effort, fine if it fails
    const g = kazmaGucu(bot, cevher.seviye)
    log.bilgi(`${g.adet} kazma, toplam ${g.toplam} vuruş ile iniyorum.`)
  }

  // --- 3) descend to the right depth ---
  if (cevher.y !== null && Math.floor(bot.entity.position.y) > cevher.y + 8) {
    log.bilgi(`${ad} için y=${cevher.y} seviyesine iniyorum...`)
    const inis = await seviyeyeIn(bot, cevher.y, kontrol, { seviye: cevher.seviye, tedarikci: secenekler.tedarikci })
    if (!inis.ok && inis.basamak === 0) {
      return { basarili: false, mesaj: `İnemedim (${inis.sebep}).` }
    }
    if (!inis.ok && inis.sebep === 'kazma_bitti') {
      // No tool underground means stranded. The staircase is still standing,
      // so walking back up it is the way out.
      await yuzeyeDon(bot, baslangicKonum, kontrol)
      return {
        basarili: false,
        kirilan: 0,
        mesaj: `Kazmam bitti ve yenisini yapacak malzemem yok (y=${Math.floor(bot.entity.position.y)}). Yukarı döndüm — odun ve taş verirsen tekrar denerim.`
      }
    }
    if (!inis.ok) log.uyari(`İniş yarıda kesildi (${inis.sebep}), buradan arıyorum.`)
  }

  // --- 3) search for ore and break it ---
  const baslangic = bot.entity.position.clone()
  const karaListe = new Set()
  let kirilan = 0
  let bosArama = 0
  let kazmaBitti = false
  let kacildi = null

  // Loop fuse.
  //
  // The bot could circle an ore it cannot reach forever. Two guards: a cap on
  // total rounds, and a rule that each round either breaks a block or adds
  // something to the blacklist. Neither happening means no progress, so those
  // rounds get counted and the loop stops after a few of them.
  const MAKS_TUR = 60
  let tur = 0
  let ilerlemesiz = 0

  while (kirilan < adet && bosArama < 6 && tur < MAKS_TUR) {
    kontrol.kontrolEt()

    // Check health. Lava does ~4 per second, so noticing at 12 leaves just
    // enough time to run. Without this check the bot died in lava once.
    const tehlike = tehlikedeMi(bot)
    if (tehlike) {
      log.hata(`${tehlike} — kaçıyorum.`)
      kacildi = tehlike
      break
    }

    tur++
    const turBasiKirilan = kirilan
    const turBasiKara = karaListe.size

    // Low pickaxe is not the same as no pickaxe.
    //
    // This was the cause of "iron pickaxe in hand, diamond in front of it,
    // and it will not mine". Below the threshold (20 swings) the bot declared
    // the pickaxe finished and headed back to the surface, while 15 swings
    // breaks a few diamonds comfortably.
    //
    // One threshold was doing two jobs and one of them was wrong:
    //   - during the descent it is right: no tool underground means stranded,
    //     so the spare has to be ready beforehand.
    //   - while mining it is wrong: breaking the ore in front of you needs
    //     the pickaxe in hand, not a spare.
    //
    // The threshold now only means "try to craft another one". Stopping needs
    // the pickaxe to actually hit zero.
    if (kazmaGucu(bot, cevher.seviye).toplam < KRITIK_DAYANIKLILIK) {
      await kazmaStokla(bot, kontrol, cevher.seviye, gerekenVurus(bot, null, adet - kirilan), secenekler)
    }
    if (kazmaGucu(bot, cevher.seviye).toplam <= 0) {
      kazmaBitti = true
      break
    }

    const adaylar = cevherBul(bot, cevher.bloklar, 32, karaListe)
    if (adaylar.length === 0) {
      // nothing found: tunnel a bit further along and look again
      bosArama++
      // Horizontal move. This used to call `birBasamakIn`, so every empty
      // search also went a level down, which is how the bot hit bedrock.
      const r = await birAdimIlerle(bot, kontrol, cevher.seviye)
      if (!r.ok) break
      continue
    }
    bosArama = 0

    // take the whole vein, not a single block
    const damar = damarTopla(bot, adaylar[0], cevher.bloklar)
    log.bilgi(`${damar.length} bloklu damar bulundu (y=${adaylar[0].y}).`)

    for (const konum of damar) {
      kontrol.kontrolEt()
      if (kirilan >= adet) break

      const anahtar = `${konum.x},${konum.y},${konum.z}`
      if (karaListe.has(anahtar)) continue

      // no need to walk when it is already in reach: standing inside a vein
      // puts the neighbouring blocks in range anyway
      const goz = bot.entity.position.offset(0, bot.entity.height || 1.62, 0)
      const yakin = goz.distanceTo(konum.offset(0.5, 0.5, 0.5)) <= 4.4

      try {
        if (!yakin) {
          const git = await pathfinderGit(bot,
            new goals.GoalLookAtBlock(konum, bot.world, { range: 4 }),
            kontrol, { zamanAsimi: 15000, durgunlukMs: 4000 })
          if (!git.ok) {
            log.uyari(`${konum} cevherine gidemedim (${git.sebep}), atlıyorum.`)
            karaListe.add(anahtar)
            continue
          }
          kontrol.kontrolEt()
        }
        if (await blogoKir(bot, konum, kontrol, cevher.seviye)) kirilan++
        else karaListe.add(anahtar)
      } catch (err) {
        if (err instanceof IptalEdildi) {
          pathfinderDurdur(bot); bot.stopDigging(); throw err
        }
        pathfinderDurdur(bot)
        karaListe.add(anahtar) // unreachable, do not try again
      }
    }

    // Pick up the drops right away.
    //
    // Collection used to happen only at the very end, within 16 blocks of the
    // starting position. The bot mines 100 blocks underground and hundreds of
    // blocks away from where it started, so nothing was ever inside that
    // radius and the diamonds it broke stayed on the floor.
    if (kirilan > 0) {
      await kontrol.bekle(400)
      await dusenleriTopla(bot, bot.entity.position.clone(), kontrol, { yaricap: 10, maksTur: 3 })
    }

    // blacklist whatever is left of the vein so the loop stops returning to it
    for (const konum of damar) {
      const b = bot.blockAt(konum)
      if (b && cevher.bloklar.includes(b.name)) {
        karaListe.add(`${konum.x},${konum.y},${konum.z}`)
      }
    }

    if (kirilan === turBasiKirilan && karaListe.size === turBasiKara) {
      if (++ilerlemesiz >= 5) {
        log.uyari('Beş turdur ilerleme yok — burada yapabileceğim bir şey kalmadı.')
        break
      }
    } else {
      ilerlemesiz = 0
    }
  }

  // --- 4) collect the drops ---
  if (kirilan > 0) {
    await kontrol.bekle(600)
    await dusenleriTopla(bot, baslangic, kontrol, { yaricap: 16 })
  }

  if (kacildi) {
    await yuzeyeDon(bot, baslangicKonum, kontrol)
    return {
      basarili: kirilan > 0,
      kirilan,
      mesaj: `${kacildi} — ${kirilan} ${ad} ile geri döndüm. Aşağısı tehlikeli.`
    }
  }

  if (kazmaBitti) {
    await yuzeyeDon(bot, baslangicKonum, kontrol)
    return {
      basarili: kirilan > 0,
      kirilan,
      mesaj: `${kirilan} ${ad} kırdım, sonra kazmam bitti. Yukarı döndüm.`
    }
  }

  // Return to the surface when the job is done.
  //
  // The bot used to stay where it dug. The log shows it stuck at y=17,
  // trying to reach surface trees from down there and failing every time.
  // Whatever the next command turns out to be, underground is a bad start.
  const derinlik = baslangicKonum.y - bot.entity.position.y
  if (derinlik > 6) await yuzeyeDon(bot, baslangicKonum, kontrol)

  return {
    basarili: kirilan > 0,
    kirilan,
    mesaj: kirilan > 0
      ? `${kirilan} ${ad} kırdım, yukarı döndüm (y=${Math.floor(bot.entity.position.y)}).`
      : `${ad} bulamadım (y=${Math.floor(bot.entity.position.y)}).`
  }
}

/**
 * Walk back to the starting point.
 * The staircase is still there, so there is a way out even without a tool,
 * as long as the staircase does not get sealed up behind the bot.
 */
async function yuzeyeDon (bot, hedef, kontrol) {
  log.bilgi('Yüzeye dönüyorum...')
  const git = await pathfinderGit(bot, new goals.GoalNear(hedef.x, hedef.y, hedef.z, 3),
    kontrol, { zamanAsimi: 60000, durgunlukMs: 6000 })
  if (git.ok) return true
  log.uyari(`Yüzeye dönemedim (${git.sebep}) — merdiveni takip ederek beni bulabilirsin.`)
  return false
}

module.exports = {
  kaz,
  kazmaSeviyesi,
  ileriYon,
  seviyeyeIn,
  birBasamakIn,
  yuzeyeDon,
  damarTopla,
  birAdimIlerle,
  kalanDayaniklilik,
  kazmaGucu,
  kazmaStokla,
  CEVHERLER,
  SEVIYELER,
  KRITIK_DAYANIKLILIK,
  GUVENLIK_PAYI,
  gerekenVurus,
  guvenliMi,
  tehlikedeMi,
  ondeLavVarMi,
  KACIS_CANI
}
