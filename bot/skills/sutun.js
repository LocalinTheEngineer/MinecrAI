'use strict'

const Vec3 = require('vec3')
const { IptalEdildi, sinirli } = require('../utils/gorev')
const { aletKusan } = require('./alet')

/**
 * SKILL: build a pillar / come back down ("pillar jumping")
 *
 * Problem: the logs at the top of a tree sit 5-7 blocks up, the bot's arm
 * reaches ~4.5, and the pathfinder cannot walk there because there is no
 * ground to stand on in the air. The bot chopped the middle of a tree and
 * left the top 3-4 logs behind.
 *
 * Fix: the same thing players do — jump, place a block under your feet while
 * airborne, repeat. One block per round.
 *
 * Why not pathfinder's own towering: `allow1by1towers` exists in
 * mineflayer-pathfinder and is on by default. It is turned off (bot/index.js)
 * because with it on the bot also towered while walking normally, building up
 * next to a two-block hill instead of walking around it. Rather than dropping
 * the ability, the decision of when to tower moved here: this file is called
 * only for "I cannot reach the log above me".
 */

// Blocks usable for the pillar, in preference order. Dirt and stone are the
// cheapest; wood comes last because it is the thing being collected in the
// first place (it does come back, it is just a last resort).
const SUTUN_ADAYLARI = [
  /^dirt$|^coarse_dirt$|^rooted_dirt$|^grass_block$/,
  /^cobblestone$|^cobbled_deepslate$|^stone$|^netherrack$|^andesite$|^diorite$|^granite$/,
  /_planks$/,
  /_log$|_stem$/
]

/** Any block in the inventory usable for a pillar? */
function sutunBlogu (bot) {
  for (const desen of SUTUN_ADAYLARI) {
    const esya = bot.inventory.items().find((i) => desen.test(i.name))
    if (esya) return esya
  }
  return null
}

/** The block right under the feet */
function ayakAlti (bot) {
  return bot.blockAt(bot.entity.position.offset(0, -0.5, 0))
}

/**
 * Goes up one level: jump, then place a block under the feet while airborne.
 *
 * Timing matters. Place too early and the bot has not left the cell yet, so
 * the server refuses; too late and it is already falling. So instead of a
 * fixed delay this watches the bot's real height and places the moment it has
 * risen one block.
 */
async function birKatCik (bot, kontrol) {
  const esya = sutunBlogu(bot)
  if (!esya) return { ok: false, sebep: 'blok_yok' }

  const zemin = ayakAlti(bot)
  if (!zemin || zemin.name === 'air') return { ok: false, sebep: 'zemin_yok' }

  const hedefKonum = zemin.position.offset(0, 1, 0)
  const baslangicY = bot.entity.position.y

  try {
    await bot.equip(esya, 'hand')
  } catch (err) {
    return { ok: false, sebep: 'kusanamadim' }
  }

  // Look straight down; placing needs the reference face in view
  await bot.look(bot.entity.yaw, Math.PI / 2, true)

  bot.setControlState('jump', true)

  let kondu = false
  const bitis = Date.now() + 1200
  while (Date.now() < bitis) {
    kontrol.kontrolEt()
    await new Promise((resolve) => setTimeout(resolve, 40))

    // One block up yet? That is the moment the space under the feet is free.
    if (bot.entity.position.y - baslangicY >= 1.0) {
      try {
        await bot.placeBlock(zemin, new Vec3(0, 1, 0))
        kondu = true
      } catch (err) {
        // Server refused: check whether the block went down anyway,
        // placeBlock sometimes throws even though it did
        const b = bot.blockAt(hedefKonum)
        kondu = !!(b && b.name !== 'air')
      }
      break
    }
  }

  bot.setControlState('jump', false)
  await kontrol.bekle(250) // wait until we settle on top of the block

  if (!kondu) return { ok: false, sebep: 'blok_konmadi' }
  return { ok: true }
}

/**
 * Pillars up until the feet reach `hedefY`.
 * @returns {{ok:boolean, cikilan:number, baslangicY:number, sebep?:string}}
 */
async function sutunaCik (bot, hedefY, kontrol, { maksKat = 12 } = {}) {
  const baslangicY = Math.floor(bot.entity.position.y)
  let cikilan = 0

  while (Math.floor(bot.entity.position.y) < hedefY && cikilan < maksKat) {
    kontrol.kontrolEt()

    const sonuc = await birKatCik(bot, kontrol)
    if (!sonuc.ok) {
      return { ok: cikilan > 0, cikilan, baslangicY, sebep: sonuc.sebep }
    }
    cikilan++
  }

  return { ok: true, cikilan, baslangicY }
}

/**
 * Comes down by mining the pillar. The broken blocks go back into the
 * inventory, so the pillar costs nothing, it is only borrowed.
 */
async function sutundanIn (bot, hedefY, kontrol, { maksKat = 16 } = {}) {
  let inilen = 0

  while (Math.floor(bot.entity.position.y) > hedefY && inilen < maksKat) {
    kontrol.kontrolEt()

    const alt = ayakAlti(bot)
    if (!alt || alt.name === 'air') {
      // Airborne and falling, wait until we touch down
      await kontrol.bekle(200)
      continue
    }
    if (!bot.canDigBlock(alt)) break

    try {
      await aletKusan(bot, alt) // digging by hand is ~5x slower
      await bot.look(bot.entity.yaw, Math.PI / 2, true)
      await sinirli(bot.dig(alt), 8000, kontrol)
    } catch (err) {
      if (err instanceof IptalEdildi) { bot.stopDigging(); throw err }
      break
    }

    inilen++
    await kontrol.bekle(300) // wait out the fall
  }

  // Short wait for the blocks dropped while breaking the pillar; walking
  // over them picks them up
  await kontrol.bekle(200)
  return inilen
}

/**
 * Pillars up until the sky is visible, the "cik" command.
 * Manual rescue when the bot is stuck in a pit or a cave.
 */
async function yuzeyeSutunla (bot, kontrol, { maksKat = 80 } = {}) {
  let cikilan = 0

  while (cikilan < maksKat) {
    kontrol.kontrolEt()

    // Is the sky open? Look for a solid block up to 8 blocks above.
    let kapali = false
    for (let dy = 1; dy <= 8; dy++) {
      const b = bot.blockAt(bot.entity.position.offset(0, dy, 0))
      if (b && b.boundingBox === 'block') { kapali = true; break }
    }

    if (!kapali && bot.entity.position.y > 62) break

    if (kapali) {
      // Break through the ceiling, then climb
      const tavan = bot.blockAt(bot.entity.position.offset(0, 2, 0))
      if (tavan && tavan.boundingBox === 'block' && bot.canDigBlock(tavan)) {
        try {
          // Equip a tool. Breaking stone by hand is ~5x slower, and on ore
          // nothing drops at all. `chopTree` and `kaz` already did this, the
          // pillar file was missed.
          await aletKusan(bot, tavan)
          await bot.lookAt(tavan.position.offset(0.5, 0.5, 0.5), true)
          await bot.dig(tavan)
        } catch (err) { return { ok: false, cikilan, sebep: 'tavan_kirilamadi' } }
      }
    }

    const r = await birKatCik(bot, kontrol)
    if (!r.ok) return { ok: cikilan > 0, cikilan, sebep: r.sebep }
    cikilan++
  }

  return { ok: true, cikilan }
}

module.exports = { sutunaCik, sutundanIn, birKatCik, sutunBlogu, yuzeyeSutunla }
