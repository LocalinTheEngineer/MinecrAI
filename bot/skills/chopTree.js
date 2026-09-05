'use strict'

const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const config = require('../config')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderGit } = require('../utils/gorev')
const { aletKusan } = require('./alet')
const { sutunaCik, sutundanIn } = require('./sutun')
const koruma = require('../utils/koruma')

/**
 * Skill: chop a tree.
 *
 * Steps:
 *  1) find the nearest log block
 *  2) flood fill the connected logs that make up that trunk
 *  3) walk to the base of the tree (pathfinder)
 *  4) break the logs bottom to top
 *  5) walk over the dropped wood to pick it up
 *
 * Every step calls `kontrol.kontrolEt()`, which is how the "dur" command works.
 */

// A block is a log if its name says so, which covers oak / birch / spruce /
// mangrove without listing them.
function kutukMu (block) {
  if (!block) return false
  return /_log$|_stem$/.test(block.name)
}

/**
 * Is this log part of a natural tree, or of something the player built?
 *
 * The bot started chopping down the user's log house: matching on the block
 * name alone says "tree" for a wall built out of the same block.
 *
 * Three signals:
 *
 *  1) `stripped_` logs never generate naturally, so they are player-placed.
 *  2) A trunk is at most 2x2. Many logs at the same level means a wall.
 *  3) A natural tree has leaves. No leaves nearby is suspicious.
 *
 * Reads a lot of blocks, so it runs on candidate logs only, not every block.
 */
function dogalAgacMi (bot, blok) {
  if (!kutukMu(blok)) return false

  // 0) player-marked protected area, checked before the heuristics
  if (koruma.korumaliMi(blok.position)) return false

  // 1) stripped logs do not occur naturally
  if (blok.name.startsWith('stripped_')) return false

  const p = blok.position

  // 2) wall test: how many logs are around it at the same height?
  //    oak/birch/spruce are 1x1, dark oak/jungle 2x2. More than that is a wall.
  let ayniSeviye = 0
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue
      if (kutukMu(bot.blockAt(p.offset(dx, 0, dz)))) ayniSeviye++
    }
  }
  if (ayniSeviye > 3) return false

  // 3) leaf test: a natural tree has a canopy
  for (let dy = 0; dy <= 6; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const b = bot.blockAt(p.offset(dx, dy, dz))
        if (b && /_leaves$/.test(b.name)) return true
      }
    }
  }
  return false
}

/**
 * Nearest natural tree, skipping player structures and the blacklist.
 *
 * `karaListe` holds trunk bases that were tried and could not be reached.
 * Without it the bot picks the same unreachable log forever: the log shows
 * (1429,71,-48) tried five times in a row, ~20 seconds per attempt.
 */
function enYakinDogalAgac (bot, yaricap, karaListe = null) {
  const adaylar = bot.findBlocks({
    matching: (b) => kutukMu(b), maxDistance: yaricap, count: 96
  })
  if (adaylar.length === 0) return null

  adaylar.sort((a, b) =>
    a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))

  for (const konum of adaylar) {
    const blok = bot.blockAt(konum)
    if (!dogalAgacMi(bot, blok)) continue
    if (karaListe) {
      const dip = govdeninDibi(bot, blok).position
      if (karaListe.has(`${dip.x},${dip.y},${dip.z}`)) continue
    }
    return blok
  }
  return null
}

/**
 * Walks down from a log to the bottom of the trunk.
 *
 * The flood fill spreads outward from wherever it starts, so starting from a
 * log in the middle and hitting the limit left both the root and the top out
 * of the list. Starting at the bottom makes it fill upward from the base.
 */
function govdeninDibi (bot, blok) {
  let p = blok.position
  for (let i = 0; i < 24; i++) {
    const alt = bot.blockAt(p.offset(0, -1, 0))
    if (!kutukMu(alt)) break
    p = alt.position
  }
  return bot.blockAt(p) || blok
}

/**
 * All logs connected to the given one, i.e. the trunk.
 * Spreads over a 3x3x3 neighbourhood, so branching trees work too.
 */
function agaciTopla (bot, baslangic, limit) {
  const bulunan = []
  const gorulen = new Set()
  const kuyruk = [govdeninDibi(bot, baslangic).position]

  while (kuyruk.length > 0 && bulunan.length < limit) {
    const pos = kuyruk.shift()
    const anahtar = `${pos.x},${pos.y},${pos.z}`
    if (gorulen.has(anahtar)) continue
    gorulen.add(anahtar)

    const block = bot.blockAt(pos)
    if (!kutukMu(block)) continue
    if (block.name.startsWith('stripped_')) continue // player-placed, leave it
    bulunan.push(block)

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          kuyruk.push(pos.offset(dx, dy, dz))
        }
      }
    }
  }

  // bottom to top: cutting the base first is safer
  bulunan.sort((a, b) => a.position.y - b.position.y)
  return bulunan
}

/** Total logs in the inventory, also used by the reward function */
function oduncuSay (bot) {
  return bot.inventory.items()
    .filter((item) => /_log$|_stem$/.test(item.name))
    .reduce((toplam, item) => toplam + item.count, 0)
}

/** Items lying on the ground, re-read on every call */
function yerdekiEsyalar (bot, merkez, yaricap) {
  return Object.values(bot.entities)
    .filter((e) => e.name === 'item' &&
                   e.isValid !== false &&
                   e.position.distanceTo(merkez) < yaricap)
    .sort((a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position))
}

/**
 * Pick up the dropped wood.
 *
 * Items do not appear the instant a log breaks and they scatter a bit while
 * falling, so a single pass missed some. Loops until a round finds nothing.
 */
async function dusenleriTopla (bot, merkez, kontrol, { yaricap = 12, maksTur = 6 } = {}) {
  let toplanan = 0
  let bosTur = 0

  for (let tur = 0; tur < maksTur && bosTur < 2; tur++) {
    kontrol.kontrolEt()

    const esyalar = yerdekiEsyalar(bot, merkez, yaricap)
    if (esyalar.length === 0) {
      bosTur++
      await kontrol.bekle(600) // wait a bit longer, they may not have dropped yet
      continue
    }

    bosTur = 0

    for (const esya of esyalar) {
      kontrol.kontrolEt()
      if (!esya.isValid) continue // may already have been picked up

      const p = esya.position
      const git = await pathfinderGit(bot, new goals.GoalNear(p.x, p.y, p.z, 0),
        kontrol, { zamanAsimi: 6000, durgunlukMs: 2500 })
      if (git.ok) toplanan++
    }

    await kontrol.bekle(400)
  }

  return toplanan
}

/**
 * Chops one tree.
 * @param {object} kontrol GorevKontrol instance, used for cancellation
 */
async function chopTree (bot, kontrol, { karaListe = null } = {}) {
  const baslangicOdun = oduncuSay(bot)
  kontrol.kontrolEt()

  // --- 1) nearest natural tree, player structures excluded ---
  const hedef = enYakinDogalAgac(bot, config.searchRadius, karaListe)

  if (!hedef) {
    log.uyari(`${config.searchRadius} blok içinde doğal ağaç bulamadım.`)
    return { basarili: false, kesilen: 0, kazanilanOdun: 0, hata: 'agac_yok' }
  }

  log.bilgi(`Ağaç bulundu: ${hedef.name} @ ${hedef.position}`)

  // --- 2) collect the whole tree ---
  const kutukler = agaciTopla(bot, hedef, config.maxLogsPerTree)
  log.bilgi(`Bu ağaçta ${kutukler.length} kütük var.`)

  // --- 3) walk to the base ---
  const dip = kutukler[0].position
  const dibeGit = await pathfinderGit(bot, new goals.GoalNear(dip.x, dip.y, dip.z, 2),
    kontrol, { zamanAsimi: 20000, durgunlukMs: 4000 })
  if (!dibeGit.ok) {
    // Could not walk to the base. It used to try anyway: 20 seconds of
    // reaching from a distance, failing, then picking the same tree again.
    // Now the distance decides. If the tree is still out of range it goes on
    // the blacklist and the next one is tried.
    const uzaklik = bot.entity.position.distanceTo(dip)
    if (uzaklik > 6) {
      if (karaListe) karaListe.add(`${dip.x},${dip.y},${dip.z}`)
      log.uyari(`Ağacın dibine ulaşamadım (${uzaklik.toFixed(0)} blok uzakta), başka ağaca geçiyorum.`)
      return { basarili: false, kesilen: 0, kazanilanOdun: 0, hata: 'ulasilamadi' }
    }
    log.uyari('Ağacın dibine tam yürüyemedim — yine de deneyeceğim.')
  }

  // --- 4) break the logs ---
  //
  // Three fallbacks. With only the first two the top of the tree was always
  // left standing:
  //
  //   a) in reach: break it directly            (fastest)
  //   b) otherwise walk next to it, then break   (pathfinder)
  //   c) still not reachable and the block is above:
  //      pillar up by placing blocks underneath, then break
  //
  // Then a second pass: blocks the first pass could not reach are usually
  // reachable once the logs in between are gone (line of sight opens up,
  // branches come down).

  const zeminY = Math.floor(bot.entity.position.y)
  let kesilen = 0
  let sutunKuruldu = false

  /** Real distance from eye level to the centre of the block */
  function erisimMesafesi (blok) {
    const goz = bot.entity.position.offset(0, bot.entity.height || 1.62, 0)
    return goz.distanceTo(blok.position.offset(0.5, 0.5, 0.5))
  }

  function elimdeMi (blok) {
    return erisimMesafesi(blok) <= 4.4 && bot.canDigBlock(blok)
  }

  async function kutuguKir (konum, sutunaIzinVar) {
    const guncel = bot.blockAt(konum)
    if (!kutukMu(guncel)) return 'zaten_yok'

    await aletKusan(bot, guncel) // an axe is ~8x faster

    // (a) in reach
    if (elimdeMi(guncel)) {
      await bot.lookAt(guncel.position.offset(0.5, 0.5, 0.5), true)
      await sinirli(bot.dig(guncel), 15000, kontrol)
      return 'kirildi'
    }

    // (b) walk closer
    //
    // A block 3+ above gets a short pathfinder timeout: there is no floor up
    // there so no path exists, but the search still runs for 12 seconds. In a
    // test recording a 7-log tree took 54 seconds, nearly all of it in these
    // dead searches. Trying briefly and falling through to (c), the pillar,
    // is both faster and more likely to work.
    const yukarida = konum.y - Math.floor(bot.entity.position.y) >= 3
    const yaklas = await pathfinderGit(bot,
      new goals.GoalLookAtBlock(konum, bot.world, { range: 4 }),
      kontrol, { zamanAsimi: yukarida ? 4000 : 12000, durgunlukMs: 3000 })
    if (yaklas.ok) {
      kontrol.kontrolEt()
      const b = bot.blockAt(konum)
      if (kutukMu(b) && bot.canDigBlock(b)) {
        await sinirli(bot.dig(b), 15000, kontrol)
        return 'kirildi'
      }
    }

    // (c) pillar up if the block is above
    if (sutunaIzinVar && konum.y - Math.floor(bot.entity.position.y) >= 2) {
      // standing 2 blocks below the log puts it at eye level
      const cikis = await sutunaCik(bot, konum.y - 2, kontrol)
      if (cikis.cikilan > 0) sutunKuruldu = true

      const b = bot.blockAt(konum)
      if (kutukMu(b) && elimdeMi(b)) {
        await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true)
        await sinirli(bot.dig(b), 15000, kontrol)
        return 'kirildi'
      }
      if (!cikis.ok) return `sutun_olmadi:${cikis.sebep || '?'}`
    }

    return 'ulasilamadi'
  }

  const kacirilan = []

  for (const kutuk of kutukler) {
    kontrol.kontrolEt()
    try {
      const sonuc = await kutuguKir(kutuk.position, true)
      if (sonuc === 'kirildi') kesilen++
      else if (sonuc !== 'zaten_yok') kacirilan.push(kutuk.position)
    } catch (err) {
      if (err instanceof IptalEdildi) {
        pathfinderDurdur(bot); bot.stopDigging(); throw err
      }
      log.uyari(`Bir kütüğü kesemedim (${err.message}) — devam ediyorum.`)
      kacirilan.push(kutuk.position)
    }
  }

  // Climb down if a pillar was built: the blocks come back and the second
  // pass is safer from the ground.
  if (sutunKuruldu) {
    try { await sutundanIn(bot, zeminY, kontrol) } catch (err) {
      if (err instanceof IptalEdildi) throw err
    }
    sutunKuruldu = false
  }

  // --- 4b) second pass over what the first pass could not reach ---
  // Without it the bot routinely cut the middle of a tree and left the root
  // and the top: the view was blocked on the first try and opened up later.
  const halaDuran = kacirilan.filter((p) => kutukMu(bot.blockAt(p)))
  if (halaDuran.length > 0) {
    log.bilgi(`${halaDuran.length} kütüğe ilk turda ulaşamadım, tekrar deniyorum.`)
    for (const konum of halaDuran) {
      kontrol.kontrolEt()
      try {
        if (await kutuguKir(konum, true) === 'kirildi') kesilen++
      } catch (err) {
        if (err instanceof IptalEdildi) {
          pathfinderDurdur(bot); bot.stopDigging(); throw err
        }
      }
    }
    if (sutunKuruldu) {
      try { await sutundanIn(bot, zeminY, kontrol) } catch (err) {
        if (err instanceof IptalEdildi) throw err
      }
    }
  }

  const kalan = kutukler.filter((k) => kutukMu(bot.blockAt(k.position))).length
  if (kalan > 0) log.uyari(`${kalan} kütüğe hiç ulaşamadım.`)

  // --- 5) pick up the dropped wood ---
  if (kesilen > 0) {
    await kontrol.bekle(1000) // let the items spawn and land
    await dusenleriTopla(bot, dip, kontrol)
  }

  if (kesilen === 0 && karaListe) karaListe.add(`${dip.x},${dip.y},${dip.z}`)

  // The inventory may have been emptied from outside (/clear). A negative
  // gain does not count as collected wood, but it is not an error either.
  const kazanilanOdun = Math.max(0, oduncuSay(bot) - baslangicOdun)
  log.basari(`${kesilen} kütük kesildi, envantere +${kazanilanOdun} odun girdi.`)

  return { basarili: kesilen > 0, kesilen, kazanilanOdun }
}

/**
 * Chops several trees.
 * @param {number} adet how many trees to chop (Infinity = until "dur")
 */
async function chopTrees (bot, kontrol, adet = 1) {
  let toplamKesilen = 0
  let toplamOdun = 0
  let agac = 0

  // Blacklist shared across all rounds: an unreachable tree gets marked once
  // and is never picked again.
  const karaListe = new Set()
  let ustUsteBasarisiz = 0

  while (agac < adet) {
    kontrol.kontrolEt()

    const sonuc = await chopTree(bot, kontrol, { karaListe })
    if (!sonuc.basarili) {
      // no trees left, no point in looping
      if (sonuc.hata === 'agac_yok') break
      // repeated unreachable trees means there is nothing to chop here
      if (++ustUsteBasarisiz >= 5) {
        log.uyari('Ulaşabildiğim ağaç kalmadı.')
        break
      }
    } else {
      ustUsteBasarisiz = 0
    }

    toplamKesilen += sonuc.kesilen
    toplamOdun += sonuc.kazanilanOdun
    agac++

    if (agac < adet) await kontrol.bekle(300)
  }

  return { agac, kesilen: toplamKesilen, kazanilanOdun: toplamOdun }
}

module.exports = {
  chopTree,
  chopTrees,
  oduncuSay,
  kutukMu,
  dogalAgacMi,
  enYakinDogalAgac,
  agaciTopla,
  dusenleriTopla,
  govdeninDibi
}
