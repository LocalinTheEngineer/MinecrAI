'use strict'

const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const { IptalEdildi, pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')

/**
 * SKILL: fighting, and knowing when not to.
 *
 * The bot used to have no answer to a mob at all. It would keep mining while
 * a zombie chewed on it, and the command ended as "bot died" with the tools
 * on the cave floor.
 *
 * Most of this file is about restraint rather than damage:
 *   - a creeper is never meleed, it is walked away from
 *   - a fight is abandoned below a health floor instead of fought to the end
 *   - auto-defence only engages what is already close, it does not go hunting
 */

const DUSMANLAR = /^(zombie|husk|drowned|zombie_villager|skeleton|stray|bogged|wither_skeleton|spider|cave_spider|creeper|enderman|witch|slime|magma_cube|blaze|silverfish|endermite|pillager|vindicator|evoker|vex|ravager|illusioner|piglin_brute|zoglin|hoglin|guardian|elder_guardian|shulker|phantom|warden)$/

// Melee range for a creeper is its blast radius. Attacking one at arm's
// length trades the bot's life for a mob that would have wandered off.
const PATLAYAN = /^creeper$/

// The warden is not a fight, it is a death sentence. Same treatment as a
// creeper: get away from it.
const KACILACAK = /^(creeper|warden)$/

const KILIC_SEVIYELERI = ['wooden', 'stone', 'iron', 'diamond', 'netherite']

// Sword swing cooldown. Hitting faster than this does less damage per hit,
// so a tighter loop is strictly worse.
const VURUS_ARALIGI = 650

// Melee reach. The server rejects an attack past ~3.5 blocks anyway.
const VURUS_MESAFESI = 3.2

// How far auto-defence looks. Deliberately short: anything further away has
// not noticed the bot and is not worth a fight.
const KORUNMA_YARICAPI = 6

// Blocks to put between the bot and something that explodes.
const KACIS_MESAFESI = 12

// Stop fighting here. Below this a bad trade turns into a dead bot, and
// everything it was carrying is on the floor.
const CAN_TABANI = 8

// Give up on a single target after this. A skeleton on a ledge that cannot be
// reached would otherwise hold the bot forever.
const HEDEF_SURESI = 30000

let korunmaSaati = null

// True while `hedefeSaldir` is running.
//
// The health watcher in yasam.js cancels the running task when health drops,
// which is right for mining and wrong here: this file has its own floor
// (`CAN_TABANI`) and a retreat to run when it is crossed. Cancelling from
// outside throws out of the loop before the retreat happens, and the bot
// stands there at 4 health next to the thing that did it.
let dovusuyor = false

function dovusuyorMu () { return dovusuyor }

function dusmanMi (varlik) {
  return Boolean(varlik && varlik.name && DUSMANLAR.test(varlik.name))
}

/** Nearest hostile within the radius, or null */
function enYakinDusman (bot, yaricap = KORUNMA_YARICAPI, { patlayanlarDahil = true } = {}) {
  let enIyi = null
  let enKisa = Infinity

  for (const id of Object.keys(bot.entities)) {
    const v = bot.entities[id]
    if (!dusmanMi(v)) continue
    if (!patlayanlarDahil && KACILACAK.test(v.name)) continue

    const d = bot.entity.position.distanceTo(v.position)
    if (d < enKisa && d <= yaricap) { enKisa = d; enIyi = v }
  }
  return enIyi
}

/**
 * Best weapon in the inventory.
 *
 * An axe counts. It hits harder than a sword of the same tier, and the bot is
 * carrying one already because it chops trees.
 */
function enIyiSilah (bot) {
  let enIyi = null
  let enIyiPuan = -1

  for (const esya of bot.inventory.items()) {
    const m = /^(\w+)_(sword|axe)$/.exec(esya.name)
    if (!m) continue
    const tur = m[1] === 'golden' ? 'wooden' : m[1]
    const seviye = KILIC_SEVIYELERI.indexOf(tur)
    if (seviye < 0) continue

    // Tier dominates; a sword beats an axe of the same tier on reach and
    // swing speed, which matters more than raw damage against mobs.
    const puan = seviye * 2 + (m[2] === 'sword' ? 1 : 0)
    if (puan > enIyiPuan) { enIyiPuan = puan; enIyi = esya }
  }
  return enIyi
}

async function silahKusan (bot) {
  const silah = enIyiSilah(bot)
  if (!silah) return null
  if (bot.heldItem && bot.heldItem.name === silah.name) return silah
  try {
    await bot.equip(silah, 'hand')
    return silah
  } catch (err) {
    return null
  }
}

/** Walks away from a point until far enough or out of tries */
async function uzaklas (bot, kontrol, konum, mesafe = KACIS_MESAFESI) {
  const p = bot.entity.position
  const dx = p.x - konum.x
  const dz = p.z - konum.z
  const uzunluk = Math.sqrt(dx * dx + dz * dz) || 1

  const hedefX = Math.floor(p.x + (dx / uzunluk) * mesafe)
  const hedefZ = Math.floor(p.z + (dz / uzunluk) * mesafe)

  try {
    pathfinderHazirla(bot)
    await bot.pathfinder.goto(new goals.GoalNearXZ(hedefX, hedefZ, 3))
    return true
  } catch (err) {
    if (err instanceof IptalEdildi) throw err
    pathfinderDurdur(bot)
    return false
  }
}

/**
 * Fights one target until it dies, gets away, or the bot is losing.
 *
 * The loop re-reads the entity every pass instead of holding onto it: a mob
 * that dies leaves a stale object behind whose `position` never changes, and
 * the bot would swing at where it used to be.
 */
async function hedefeSaldir (bot, kontrol, hedef) {
  const id = hedef.id
  const ad = hedef.name
  const bitis = Date.now() + HEDEF_SURESI
  let vurus = 0

  dovusuyor = true
  try {
    return await dovusDongusu(bot, kontrol, id, ad, bitis, () => vurus++, () => vurus)
  } finally {
    dovusuyor = false
  }
}

async function dovusDongusu (bot, kontrol, id, ad, bitis, vurdu, vurusSayisi) {
  await silahKusan(bot)

  while (Date.now() < bitis) {
    kontrol.kontrolEt()

    const v = bot.entities[id]
    if (!v || !v.isValid) {
      const vurus = vurusSayisi()
      log.basari(`${ad} oldu (${vurus} vurus).`)
      return { basarili: true, vurus, oldurdu: true }
    }

    if (bot.health !== undefined && bot.health <= CAN_TABANI) {
      pathfinderDurdur(bot)
      bot.chat(`Canım ${bot.health.toFixed(0)}, kaçıyorum.`)
      await uzaklas(bot, kontrol, v.position)
      return { basarili: false, hata: 'can_dustu', vurus: vurusSayisi() }
    }

    const d = bot.entity.position.distanceTo(v.position)

    if (d > VURUS_MESAFESI) {
      if (d > KORUNMA_YARICAPI * 3) {
        pathfinderDurdur(bot)
        return { basarili: false, hata: 'kacti', vurus: vurusSayisi() }
      }
      try {
        pathfinderHazirla(bot)
        await bot.pathfinder.goto(
          new goals.GoalNear(v.position.x, v.position.y, v.position.z, 2))
      } catch (err) {
        if (err instanceof IptalEdildi) throw err
        pathfinderDurdur(bot)
        // Unreachable: on a ledge, behind a wall, in water. Trying again from
        // the same spot gives the same answer.
        return { basarili: false, hata: 'ulasilamiyor', vurus: vurusSayisi() }
      }
      continue
    }

    try {
      await bot.lookAt(v.position.offset(0, v.height ? v.height * 0.8 : 1.4, 0), true)
      bot.attack(v)
      vurdu()
    } catch (err) {
      if (err instanceof IptalEdildi) throw err
    }

    await kontrol.bekle(VURUS_ARALIGI)
  }

  pathfinderDurdur(bot)
  return { basarili: false, hata: 'sure_doldu', vurus: vurusSayisi() }
}

/**
 * The "savas" command: deal with what is nearby.
 *
 * Explosive mobs are handled first and separately. Walking past a creeper to
 * reach a zombie is how a fight the bot was winning ends.
 */
async function savas (bot, kontrol, yaricap = KORUNMA_YARICAPI) {
  const patlayan = enYakinDusman(bot, KACIS_MESAFESI)
  if (patlayan && KACILACAK.test(patlayan.name)) {
    bot.chat(`${patlayan.name} var, ona bulaşmıyorum — uzaklaşıyorum.`)
    await uzaklas(bot, kontrol, patlayan.position)
    return { basarili: true, kacti: true }
  }

  const hedef = enYakinDusman(bot, yaricap, { patlayanlarDahil: false })
  if (!hedef) {
    bot.chat(`${yaricap} blok içinde düşman görmüyorum.`)
    return { basarili: false, hata: 'dusman_yok' }
  }

  if (!enIyiSilah(bot)) {
    bot.chat('Silahım yok, yumrukla saldırıyorum.')
  }

  bot.chat(`${hedef.name} ile dövüşüyorum.`)
  const sonuc = await hedefeSaldir(bot, kontrol, hedef)

  if (sonuc.oldurdu) bot.chat(`${hedef.name} öldü.`)
  else if (sonuc.hata === 'ulasilamiyor') bot.chat(`${hedef.name} ulaşamadığım bir yerde.`)
  else if (sonuc.hata === 'kacti') bot.chat(`${hedef.name} kaçtı.`)
  else if (sonuc.hata === 'sure_doldu') bot.chat('Bu iş uzadı, bıraktım.')

  return sonuc
}

/**
 * Background defence.
 *
 * Only runs while nothing else is running. A task that is mid-dig or mid-path
 * does not want a second system grabbing the controls; the health watcher in
 * `yasam.js` is what interrupts a task, and this picks up afterwards.
 */
function korunmaBaslat (bot, kontrol, { yaricap = KORUNMA_YARICAPI } = {}) {
  if (korunmaSaati) return false

  let mesgul = false

  korunmaSaati = setInterval(() => {
    if (mesgul || (kontrol && kontrol.calisiyor)) return
    const hedef = enYakinDusman(bot, yaricap)
    if (!hedef) return

    mesgul = true
    kontrol.baslat()
    const is = KACILACAK.test(hedef.name)
      ? uzaklas(bot, kontrol, hedef.position)
      : hedefeSaldir(bot, kontrol, hedef)

    is.catch((err) => {
      if (!(err instanceof IptalEdildi)) log.uyari(`Korunma: ${err.message}`)
    }).finally(() => {
      kontrol.bitir()
      pathfinderDurdur(bot)
      mesgul = false
    })
  }, 2000)

  return true
}

function korunmaDurdur () {
  if (!korunmaSaati) return false
  clearInterval(korunmaSaati)
  korunmaSaati = null
  return true
}

module.exports = {
  savas,
  hedefeSaldir,
  dovusuyorMu,
  enYakinDusman,
  enIyiSilah,
  silahKusan,
  uzaklas,
  dusmanMi,
  korunmaBaslat,
  korunmaDurdur,
  DUSMANLAR,
  KACILACAK,
  PATLAYAN,
  CAN_TABANI,
  KORUNMA_YARICAPI
}
