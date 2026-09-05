'use strict'

const { goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const log = require('../utils/log')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')

/**
 * SKILL: walk over to a player.
 *
 * Three traps here:
 *
 *  1) `GoalFollow` + `goto()` is a misuse. GoalFollow is a continuously
 *     updated goal; through `goto()` the path resets on every update and it
 *     fails with "Path was stopped before it could be completed". Live
 *     following needs `setGoal(hedef, true)`. This file uses a static
 *     `GoalNear` and recomputes it on every attempt.
 *
 *  2) The target cell can be unreachable (fence, step, leaves). Tolerance is
 *     loosened in stages: 2 -> 4 -> 6 blocks.
 *
 *  3) If the player is in the air (flying in creative) the goal used to sit in
 *     empty space. It now aims at the ground below them.
 */

const DENEME_TOLERANSLARI = [2, 4, 6]

// Vertical distance is not the same as horizontal: 6 blocks to the side
// counts as arrived, 6 blocks below does not — there is a wall, a ceiling or
// a drop in between. So the two tolerances are kept separate.
const DIKEY_TOLERANS = 3

// Above this height difference the pathfinder may start digging a tunnel to
// reach you; it takes minutes and wrecks the terrain. Warn first.
const TUNEL_ESIGI = 12

/** First solid ground below the given point, for a flying player */
function altindakiZemin (bot, konum, maksDusus = 40) {
  const x = Math.floor(konum.x)
  const z = Math.floor(konum.z)

  for (let y = Math.floor(konum.y); y > Math.floor(konum.y) - maksDusus; y--) {
    const zemin = bot.blockAt(new Vec3(x, y - 1, z))
    const ust = bot.blockAt(new Vec3(x, y, z))
    if (zemin && zemin.boundingBox === 'block' && ust && ust.name === 'air') {
      return new Vec3(x, y, z)
    }
  }
  return null
}

async function gel (bot, kontrol, oyuncuAdi) {
  const oyuncu = bot.players[oyuncuAdi]

  if (!oyuncu) {
    bot.chat(`${oyuncuAdi} diye birini görmüyorum.`)
    return { basarili: false, hata: 'oyuncu_yok' }
  }
  if (!oyuncu.entity) {
    bot.chat('Çok uzaktasın, seni göremiyorum — biraz yaklaş, tekrar "gel" yaz.')
    return { basarili: false, hata: 'oyuncu_gorunmuyor' }
  }

  let sonHata = null

  for (const tolerans of DENEME_TOLERANSLARI) {
    kontrol.kontrolEt()

    // Recompute the target on every attempt, the player may have moved
    const konum = oyuncu.entity.position
    const ayakAlti = bot.blockAt(konum.offset(0, -1, 0))
    const havada = !ayakAlti || ayakAlti.name === 'air'

    let nokta = konum
    if (havada) {
      const zemin = altindakiZemin(bot, konum)
      if (!zemin) {
        bot.chat('Havadasın ve altında basacak zemin göremiyorum. Yere in, tekrar dene.')
        return { basarili: false, hata: 'zemin_yok' }
      }
      nokta = zemin
    }

    const yatay = bot.entity.position.xzDistanceTo(nokta)
    const dikey = Math.abs(bot.entity.position.y - nokta.y)

    // "Already next to you" needs both horizontal closeness and the same level
    if (yatay <= tolerans && dikey <= DIKEY_TOLERANS) {
      bot.chat('Zaten yanındayım.')
      return { basarili: true }
    }

    if (dikey > TUNEL_ESIGI && tolerans === DENEME_TOLERANSLARI[0]) {
      bot.chat(`Aramızda ${dikey.toFixed(0)} blok yükseklik farkı var — ulaşmam uzun sürebilir.`)
    }

    log.bilgi(`Deneme (tolerans ${tolerans}): ${nokta.x.toFixed(0)},${nokta.y.toFixed(0)},${nokta.z.toFixed(0)} — yatay ${yatay.toFixed(1)}, dikey ${dikey.toFixed(1)}`)

    try {
      pathfinderHazirla(bot) // a latch may be left over from the previous command
      await sinirli(
        bot.pathfinder.goto(new goals.GoalNear(nokta.x, nokta.y, nokta.z, tolerans)),
        30000,
        kontrol
      )
      // Check the real position before claiming arrival. Pathfinder can call
      // it close enough while a vertical gap remains; report that instead of
      // hiding it.
      const sonYatay = bot.entity.position.xzDistanceTo(nokta)
      const sonDikey = bot.entity.position.y - nokta.y

      if (Math.abs(sonDikey) > DIKEY_TOLERANS) {
        const yon = sonDikey > 0 ? 'yukarıdayım' : 'aşağıdayım'
        log.uyari(`Yaklaştım ama ${Math.abs(sonDikey).toFixed(0)} blok ${yon}.`)
        bot.chat(`Yaklaştım ama senden ${Math.abs(sonDikey).toFixed(0)} blok ${yon} — tam yanına çıkamadım.`)
        return { basarili: false, hata: 'dikey_fark', dikey: sonDikey }
      }

      log.basari(`Geldim (yatay ${sonYatay.toFixed(1)}, dikey ${sonDikey.toFixed(1)}).`)
      bot.chat('Geldim.')
      return { basarili: true }
    } catch (err) {
      if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }

      sonHata = err.message
      // Print the raw error to the terminal, that is the part worth having
      log.uyari(`Tolerans ${tolerans} başarısız — ham hata: "${err.message}"`)
      pathfinderDurdur(bot)
      await new Promise((r) => setTimeout(r, 400)) // let pathfinder settle
    }
  }

  log.hata(`Üç deneme de başarısız. Son hata: ${sonHata}`)
  bot.chat(`Yanına gelemedim (${sonHata}). Terminaldeki ham hatayı kontrol et.`)
  return { basarili: false, hata: sonHata }
}

module.exports = { gel, altindakiZemin }
