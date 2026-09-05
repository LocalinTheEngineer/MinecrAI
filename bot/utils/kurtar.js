'use strict'

const log = require('./log')
const koruma = require('./koruma')

/**
 * Getting unstuck.
 *
 * Stuck detection came first: 4 seconds without movement and the bot reports
 * "takildim". Detection alone is half a fix — the bot still stands where it
 * jammed, only now it knows. The caller moves to another target, pathfinder
 * still finds no path through the same narrow gap, and the loop restarts.
 *
 * This is the missing half: actually freeing the bot.
 *
 * The bot gets stuck in a 1-block-wide shaft it dug itself. What does a player
 * do there? Look around, jump across if a side is open, otherwise pull out a
 * pickaxe and cut a way out. Same here.
 */

const TEHLIKELI = /lava|bedrock/
const YONLER = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function bekle (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Are the foot and head cells free in this direction? */
function acikMi (bot, p, dx, dz) {
  const ayak = bot.blockAt(p.offset(dx, 0, dz))
  const bas = bot.blockAt(p.offset(dx, 1, dz))
  if (!ayak || !bas) return false
  return ayak.boundingBox !== 'block' && bas.boundingBox !== 'block'
}

/** Try to break a block, if it is safe */
async function kirmayiDene (bot, konum) {
  const { aletKusan } = require('../skills/alet')
  const b = bot.blockAt(konum)
  if (!b || b.boundingBox !== 'block') return false
  if (TEHLIKELI.test(b.name)) return false
  if (koruma.korumaliMi(konum)) return false
  if (!bot.canDigBlock(b)) return false

  try {
    await aletKusan(bot, b)
    await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true)
    await bot.dig(b)
    return true
  } catch (err) {
    return false
  }
}

/**
 * Try to free the bot from where it is stuck.
 * @returns {Promise<boolean>} true if the position changed
 */
async function kurtar (bot, kontrol = null) {
  const baslangic = bot.entity.position.clone()

  try { bot.pathfinder.stop(); bot.pathfinder.setGoal(null) } catch (err) {}
  try { bot.clearControlStates() } catch (err) {}
  await bekle(200)

  const p = bot.entity.position.floored()
  const acikYonler = YONLER.filter(([dx, dz]) => acikMi(bot, p, dx, dz))

  // 1) If a direction is open, jump across into it.
  //    Most jams are a snag on a block edge; a small jump clears it.
  if (acikYonler.length > 0) {
    const [dx, dz] = acikYonler[0]
    try {
      await bot.lookAt(bot.entity.position.offset(dx * 2, 0, dz * 2), true)
      bot.setControlState('forward', true)
      bot.setControlState('jump', true)
      await bekle(600)
    } finally {
      try {
        bot.setControlState('jump', false)
        bot.setControlState('forward', false)
      } catch (err) {}
    }
    await bekle(300)
    if (bot.entity.position.distanceTo(baslangic) > 0.8) {
      log.bilgi('Sıkıştığım yerden çıktım.')
      return true
    }
  }

  if (kontrol) kontrol.kontrolEt()

  // 2) Every direction closed: dig a way out.
  //    The bot carries a pickaxe anyway; waiting in a narrow shaft is pointless.
  for (const [dx, dz] of YONLER) {
    const ayakKondu = await kirmayiDene(bot, p.offset(dx, 0, dz))
    const basKondu = await kirmayiDene(bot, p.offset(dx, 1, dz))
    if (ayakKondu || basKondu) {
      log.bilgi('Sıkıştım, kendime yol açtım.')
      return true
    }
    if (kontrol) kontrol.kontrolEt()
  }

  // 3) Last resort: dig up. At the bottom of a self-dug shaft the way out is
  //    above.
  if (await kirmayiDene(bot, p.offset(0, 2, 0))) {
    log.bilgi('Sıkıştım, yukarı doğru yol açtım.')
    return true
  }

  log.uyari('Sıkıştım ve kurtulamadım.')
  return false
}

module.exports = { kurtar, acikMi }
