'use strict'

const Vec3 = require('vec3')
const log = require('./log')
const koruma = require('./koruma')

/**
 * Block placement: crafting table, furnace, chest.
 *
 * Problem: `tezgahKoy` and `firinBul` both ran the same naive search — check
 * 6 fixed spots next to you, place where the ground is solid and the cell
 * above is free. In a tunnel, a cave or a narrow gap those six rarely hold,
 * and the bot gave up with "no room to place it" while carrying two furnaces.
 *
 * Fix: two stages. First search a wider area for a ready spot (5x5x3, nearest
 * first). If there is none, make room by breaking a neighbouring block. The
 * bot is a miner with a pickaxe; giving up over "no room" makes no sense.
 */

const TEHLIKELI = /lava|water|bedrock/

/** Is there a ready spot to place on? */
function hazirYerBul (bot) {
  const p = bot.entity.position.floored()
  const adaylar = []

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dz === 0) continue // do not place directly above or below us
        adaylar.push(p.offset(dx, dy, dz))
      }
    }
  }

  adaylar.sort((a, b) =>
    a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))

  for (const hedef of adaylar) {
    const ustu = bot.blockAt(hedef)
    const zemin = bot.blockAt(hedef.offset(0, -1, 0))
    if (!ustu || !zemin) continue
    if (ustu.name !== 'air') continue
    if (zemin.boundingBox !== 'block') continue
    if (TEHLIKELI.test(zemin.name)) continue
    if (koruma.korumaliMi(hedef)) continue
    return { hedef, zemin }
  }
  return null
}

/**
 * Make room by breaking a neighbouring block.
 * The bot carries a pickaxe anyway; digging beats reporting "no room".
 */
async function yerAc (bot, kontrol) {
  const { aletKusan } = require('../skills/alet') // required here to avoid a circular require
  const p = bot.entity.position.floored()

  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (kontrol) kontrol.kontrolEt()

    const hedef = p.offset(dx, 0, dz)
    const blok = bot.blockAt(hedef)
    const zemin = bot.blockAt(hedef.offset(0, -1, 0))
    if (!blok || !zemin) continue
    if (blok.boundingBox !== 'block') continue // already free
    if (zemin.boundingBox !== 'block') continue // nothing underneath, cannot place
    if (TEHLIKELI.test(blok.name) || TEHLIKELI.test(zemin.name)) continue
    if (koruma.korumaliMi(hedef)) continue
    if (!bot.canDigBlock(blok)) continue

    try {
      await aletKusan(bot, blok)
      await bot.lookAt(blok.position.offset(0.5, 0.5, 0.5), true)
      await bot.dig(blok)
      log.bilgi('Yer açtım.')
      return true
    } catch (err) { /* try another direction */ }
  }
  return false
}

/**
 * Place the `esyaAdi` block and return the placed block, or null on failure.
 * Makes room itself when there is none.
 */
async function blokKoy (bot, esyaAdi, kontrol = null) {
  for (let deneme = 0; deneme < 3; deneme++) {
    if (kontrol) kontrol.kontrolEt()

    const esya = bot.inventory.items().find((i) => i.name === esyaAdi)
    if (!esya) return null

    const yer = hazirYerBul(bot)
    if (yer) {
      try {
        await bot.equip(esya, 'hand')
        await bot.placeBlock(yer.zemin, new Vec3(0, 1, 0))
        const konan = bot.blockAt(yer.hedef)
        if (konan && konan.name === esyaAdi) return konan
      } catch (err) { /* the code below makes room and retries */ }
    }

    if (!(await yerAc(bot, kontrol))) break
  }
  return null
}

module.exports = { blokKoy, hazirYerBul, yerAc }
