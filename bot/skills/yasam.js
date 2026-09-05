'use strict'

const log = require('../utils/log')

/**
 * SKILL: staying alive — eating, and backing off when hurt.
 *
 * Every other skill assumes the bot is standing. A mining run is 20 minutes
 * long; hunger drains, regeneration stops, a zombie finishes the job and the
 * command ends with "Bir sorun çıktı: bot died". Nothing in the codebase was
 * watching for that.
 *
 * Two loops, both running in the background:
 *   - eat before hunger costs anything
 *   - notice a health drop and stop whatever is going on
 *
 * Neither one fights the current task for control. See `uygunMu` for why that
 * matters more than it sounds.
 */

// Food ranked by how much it is worth eating, best first. Anything not on the
// list is not eaten: rotten flesh and pufferfish are food by the game's
// definition and a net loss by any other.
const YEMEKLER = [
  /^golden_carrot$/, /^cooked_beef$/, /^cooked_porkchop$/, /^cooked_mutton$/,
  /^cooked_chicken$/, /^cooked_rabbit$/, /^cooked_cod$/, /^cooked_salmon$/,
  /^bread$/, /^baked_potato$/, /^carrot$/, /^apple$/, /^beetroot_soup$/,
  /^mushroom_stew$/, /^rabbit_stew$/, /^melon_slice$/, /^sweet_berries$/,
  /^dried_kelp$/, /^cookie$/
]

// Eat at 16 of 20, not at 20. Below 18 the player stops regenerating health,
// and a full bar wastes most of the item's value.
const ACLIK_ESIGI = 16

// Below this, hunger is doing damage and interrupting the task is cheaper
// than dying in the middle of it.
const ACLIK_KRITIK = 6

// Health, out of 20. Half is early enough to run: a creeper does more than
// that in one go, but a zombie needs several hits to get there.
const CAN_ESIGI = 8

// How often the hunger check runs. Hunger moves slowly; a tighter loop would
// only burn CPU.
const KONTROL_ARALIGI = 5000

let saat = null
let yiyor = false

/** Best food in the inventory, or null */
function yemekBul (bot) {
  const esyalar = bot.inventory.items()
  for (const desen of YEMEKLER) {
    const bulunan = esyalar.find((i) => desen.test(i.name))
    if (bulunan) return bulunan
  }
  return null
}

/**
 * Eats once.
 *
 * Eating occupies the main hand, so whatever was held is put back afterwards.
 * Without that the bot finishes a meal holding bread and keeps "mining" with
 * it — the dig silently takes forever and nothing says why.
 */
async function yemekYe (bot) {
  if (yiyor) return { basarili: false, hata: 'zaten_yiyor' }

  const yemek = yemekBul(bot)
  if (!yemek) return { basarili: false, hata: 'yemek_yok' }

  const oncekiEl = bot.heldItem
  yiyor = true
  try {
    await bot.equip(yemek, 'hand')
    await bot.consume()
    log.bilgi(`Yedim: ${yemek.name} (aclik ${bot.food}/20)`)
    return { basarili: true, yemek: yemek.name }
  } catch (err) {
    // consume() throws when the food bar filled up mid-bite or the item ran
    // out. Neither is worth reporting to the player.
    log.uyari(`Yiyemedim (${yemek.name}): ${err.message}`)
    return { basarili: false, hata: err.message }
  } finally {
    yiyor = false
    if (oncekiEl) {
      try { await bot.equip(oncekiEl, 'hand') } catch (err) { /* item may be gone */ }
    }
  }
}

/**
 * Is now a good moment to eat?
 *
 * Eating takes about 1.6 seconds with the food held in hand. Doing that in
 * the middle of a dig cancels the dig, and in the middle of a fight it drops
 * the sword. So while a task is running the bot waits — unless hunger has
 * gone critical, where the task is going to fail anyway.
 */
function uygunMu (bot, kontrol) {
  if (yiyor) return false
  if (bot.food === undefined || bot.food > ACLIK_ESIGI) return false
  if (bot.food <= ACLIK_KRITIK) return true
  return !(kontrol && kontrol.calisiyor)
}

/** Starts the background hunger loop; safe to call twice */
function otomatikYemekBaslat (bot, kontrol) {
  if (saat) return false

  saat = setInterval(() => {
    if (!uygunMu(bot, kontrol)) return
    yemekYe(bot).then((r) => {
      if (!r.basarili && r.hata === 'yemek_yok' && bot.food <= ACLIK_KRITIK) {
        bot.chat('Aclıktan ölüyorum, yiyecek bir şeyim yok.')
      }
    }).catch(() => {})
  }, KONTROL_ARALIGI)

  return true
}

function otomatikYemekDurdur () {
  if (!saat) return false
  clearInterval(saat)
  saat = null
  return true
}

/**
 * Watches health and cancels the current task when it drops too far.
 *
 * Only cancelling, not fleeing. The task loops already handle cancellation
 * correctly, and adding a second thing that drives the bot's movement while a
 * task is mid-step is how two systems end up fighting over the same keys.
 * `savas.js` decides what to do next.
 *
 * @returns a function that removes the listener
 */
function canIzleyiciBaslat (bot, kontrol, { esik = CAN_ESIGI, tepki, muafMi } = {}) {
  let sonCan = bot.health === undefined ? 20 : bot.health

  const dinleyici = () => {
    const can = bot.health
    if (can === undefined) return

    const dustu = can < sonCan
    sonCan = can
    if (!dustu || can > esik) return

    // Combat opts out. savas.js has its own health floor and a retreat to
    // run at it; cancelling from here throws out of that loop first and the
    // bot stands still at 4 health next to whatever hit it.
    if (typeof muafMi === 'function' && muafMi()) return

    log.uyari(`Can ${can.toFixed(0)}/20 — isi birakiyorum.`)
    if (kontrol && kontrol.calisiyor) {
      bot.chat(`Canım ${can.toFixed(0)}, işi bırakıyorum.`)
      kontrol.durdur()
    }
    if (typeof tepki === 'function') {
      try { tepki(can) } catch (err) { /* the caller's problem, not ours */ }
    }
  }

  bot.on('health', dinleyici)
  return () => bot.removeListener('health', dinleyici)
}

module.exports = {
  yemekYe,
  yemekBul,
  uygunMu,
  otomatikYemekBaslat,
  otomatikYemekDurdur,
  canIzleyiciBaslat,
  YEMEKLER,
  ACLIK_ESIGI,
  ACLIK_KRITIK,
  CAN_ESIGI
}
