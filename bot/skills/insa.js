'use strict'

const Vec3 = require('vec3')
const log = require('../utils/log')
const koruma = require('../utils/koruma')

/**
 * SKILL: putting blocks down.
 *
 * The bot could already place a single block for a specific purpose — a
 * crafting table (`utils/yerlestir.js`), a pillar under its own feet
 * (`sutun.js`). Neither is general: the first places wherever there is room,
 * the second only ever places straight down.
 *
 * This file places a block at a position the caller names, and builds the
 * three shapes that get asked for: a floor, a wall, and plugging the hole in
 * front of you before something walks through it.
 *
 * The interesting part is not the geometry, it is that Minecraft has no
 * "place a block at these coordinates" call. You place a block *against* an
 * existing one, on a named face. Every cell here has to find a neighbour to
 * lean on first, and a cell floating in mid-air with nothing around it simply
 * cannot be built — see `dayanakBul`.
 */

// Blocks worth building with, best first. Cobblestone leads because that is
// what a mining bot has hundreds of. Logs are last: they are the point of the
// wood task, so spending them on a wall is a waste.
const INSA_ADAYLARI = [
  /^cobblestone$|^cobbled_deepslate$|^stone$|^andesite$|^diorite$|^granite$|^deepslate$/,
  /^dirt$|^coarse_dirt$|^rooted_dirt$|^grass_block$/,
  /_planks$/,
  /^netherrack$|^tuff$|^calcite$/,
  /_log$|_stem$/
]

// The server rejects a placement past about 4.5 blocks. Staying under it
// turns a silent no-op into a reachable error.
const UZANMA = 4.0

// Caps on what a single command may build. A 9x9 floor is 81 placements at
// roughly a second each, and the player is waiting the whole time.
const MAKS_BOYUT = 7
const MAKS_YUKSEKLIK = 5

// A cell already holding one of these is treated as empty and built over.
const DEGISTIRILEBILIR = /^air$|^cave_air$|^void_air$|^water$|^grass$|^short_grass$|^tall_grass$|^snow$|^fern$|^dead_bush$|^seagrass$/

const YONLER = [
  new Vec3(0, -1, 0), new Vec3(0, 1, 0),
  new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1), new Vec3(0, 0, -1)
]

/** A building block from the inventory, or null */
function insaBlogu (bot) {
  for (const desen of INSA_ADAYLARI) {
    const esya = bot.inventory.items().find((i) => desen.test(i.name))
    if (esya) return esya
  }
  return null
}

function bosMu (blok) {
  return Boolean(blok) && DEGISTIRILEBILIR.test(blok.name)
}

/**
 * Finds an existing block to place against, and which face of it to use.
 *
 * This is the constraint that shapes the whole file. Building a floor from
 * the middle outwards fails on the second cell — it has nothing beside it
 * yet. Building outwards from a cell that touches solid ground works, which
 * is why the shape builders sort their cells by distance and go nearest
 * first: each placement becomes the support for the next.
 */
function dayanakBul (bot, konum) {
  for (const yon of YONLER) {
    const komsu = bot.blockAt(konum.plus(yon))
    if (komsu && komsu.boundingBox === 'block' && !/lava|water/.test(komsu.name)) {
      // The face vector points from the neighbour back to the target cell.
      return { referans: komsu, yuz: yon.scaled(-1) }
    }
  }
  return null
}

/**
 * Places one block at `konum`.
 *
 * @returns {Promise<{basarili:boolean, hata?:string}>}
 */
async function noktayaKoy (bot, kontrol, konum, esya) {
  if (kontrol) kontrol.kontrolEt()

  const mevcut = bot.blockAt(konum)
  if (!mevcut) return { basarili: false, hata: 'yuklenmemis' }
  if (!bosMu(mevcut)) return { basarili: false, hata: 'dolu' }
  if (koruma.korumaliMi(konum)) return { basarili: false, hata: 'korumali' }

  const merkez = konum.offset(0.5, 0.5, 0.5)
  if (bot.entity.position.offset(0, 1.6, 0).distanceTo(merkez) > UZANMA) {
    return { basarili: false, hata: 'uzak' }
  }

  // Do not brick the bot into its own wall.
  const ayak = bot.entity.position.floored()
  if (konum.equals(ayak) || konum.equals(ayak.offset(0, 1, 0))) {
    return { basarili: false, hata: 'ustumde' }
  }

  const dayanak = dayanakBul(bot, konum)
  if (!dayanak) return { basarili: false, hata: 'dayanak_yok' }

  try {
    if (!bot.heldItem || bot.heldItem.name !== esya.name) {
      await bot.equip(esya, 'hand')
    }
    await bot.lookAt(merkez, true)
    await bot.placeBlock(dayanak.referans, dayanak.yuz)
    return { basarili: true }
  } catch (err) {
    return { basarili: false, hata: err.message }
  }
}

/**
 * Builds a list of cells, nearest first.
 *
 * Nearest first is not cosmetic: each placed block becomes a support for the
 * next one out, so the order is what makes an unsupported shape buildable at
 * all.
 */
async function noktalariKur (bot, kontrol, noktalar) {
  const esya = insaBlogu(bot)
  if (!esya) return { basarili: false, hata: 'blok_yok', konan: 0 }

  const sirali = [...noktalar].sort((a, b) =>
    a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))

  let konan = 0
  let atlanan = 0
  const sebepler = {}

  for (const nokta of sirali) {
    kontrol.kontrolEt()

    // The stack can run out halfway through a wall.
    const guncel = bot.inventory.items().find((i) => i.name === esya.name)
      ? esya
      : insaBlogu(bot)
    if (!guncel) return { basarili: konan > 0, hata: 'blok_bitti', konan, atlanan }

    const r = await noktayaKoy(bot, kontrol, nokta, guncel)
    if (r.basarili) {
      konan++
    } else {
      atlanan++
      sebepler[r.hata] = (sebepler[r.hata] || 0) + 1
    }
  }

  log.bilgi(`Insa: ${konan} blok kondu, ${atlanan} atlandi ${JSON.stringify(sebepler)}`)
  return { basarili: konan > 0, konan, atlanan, sebepler }
}

/** Which way the bot is facing, as a unit step on the ground */
function bakisYonu (bot) {
  const yaw = bot.entity.yaw
  const x = -Math.sin(yaw)
  const z = Math.cos(yaw)
  return Math.abs(x) > Math.abs(z)
    ? new Vec3(Math.sign(x), 0, 0)
    : new Vec3(0, 0, Math.sign(z))
}

/** A square floor at foot level, centred on the bot */
async function platform (bot, kontrol, boyut = 3) {
  const n = Math.max(1, Math.min(MAKS_BOYUT, Math.floor(boyut)))
  const yari = Math.floor(n / 2)
  const taban = bot.entity.position.floored().offset(0, -1, 0)

  const noktalar = []
  for (let dx = -yari; dx <= yari; dx++) {
    for (let dz = -yari; dz <= yari; dz++) {
      noktalar.push(taban.offset(dx, 0, dz))
    }
  }

  bot.chat(`${n}x${n} platform kuruyorum.`)
  const r = await noktalariKur(bot, kontrol, noktalar)
  bot.chat(r.konan > 0
    ? `${r.konan} blok koydum${r.atlanan ? `, ${r.atlanan} yere koyamadım` : ''}.`
    : 'Koyacak blok bulamadım (taş, toprak ya da tahta lazım).')
  return r
}

/** A wall in front of the bot, `en` wide and `yukseklik` tall */
async function duvar (bot, kontrol, en = 3, yukseklik = 2) {
  const g = Math.max(1, Math.min(MAKS_BOYUT, Math.floor(en)))
  const h = Math.max(1, Math.min(MAKS_YUKSEKLIK, Math.floor(yukseklik)))

  const ileri = bakisYonu(bot)
  const yan = new Vec3(ileri.z, 0, -ileri.x) // 90° to the facing direction
  const taban = bot.entity.position.floored().plus(ileri)
  const yari = Math.floor(g / 2)

  const noktalar = []
  for (let i = -yari; i <= yari; i++) {
    for (let y = 0; y < h; y++) {
      noktalar.push(taban.plus(yan.scaled(i)).offset(0, y, 0))
    }
  }

  bot.chat(`${g}x${h} duvar örüyorum.`)
  const r = await noktalariKur(bot, kontrol, noktalar)
  bot.chat(r.konan > 0
    ? `${r.konan} blok koydum${r.atlanan ? `, ${r.atlanan} yere koyamadım` : ''}.`
    : 'Koyacak blok bulamadım.')
  return r
}

/**
 * Plugs the gap directly in front — the "kapat" case.
 *
 * A 1-wide, 2-tall wall, which is the shape of a doorway and of the hole a
 * mob walks through.
 */
function kapat (bot, kontrol) {
  return duvar(bot, kontrol, 1, 2)
}

module.exports = {
  platform,
  duvar,
  kapat,
  noktayaKoy,
  noktalariKur,
  insaBlogu,
  dayanakBul,
  bakisYonu,
  bosMu,
  MAKS_BOYUT,
  MAKS_YUKSEKLIK,
  UZANMA
}
