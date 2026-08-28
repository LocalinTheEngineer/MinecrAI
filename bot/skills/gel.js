'use strict'

const { goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const log = require('../utils/log')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')

/**
 * SKILL: Bir oyuncunun yanına git.
 *
 * Üç tuzak vardı:
 *
 *  1) `GoalFollow` + `goto()` yanlış kullanım. GoalFollow sürekli güncellenen
 *     bir hedef; `goto()` ile kullanılınca yol her güncellemede sıfırlanıyor ve
 *     "Path was stopped before it could be completed" hatası veriyor. Canlı
 *     takip isteniyorsa `setGoal(hedef, true)` kullanılmalı. Burada statik
 *     `GoalNear` kullanıp her denemede yeniden hesaplıyoruz.
 *
 *  2) Hedef hücre tam olarak ulaşılamaz olabiliyor (çit, basamak, yaprak).
 *     Tolerans kademeli olarak gevşetiliyor: 2 -> 4 -> 6 blok.
 *
 *  3) Oyuncu havadaysa (creative'de uçarken) hedef boşlukta kalıyordu.
 *     Artık altındaki zemin hedefleniyor.
 */

const DENEME_TOLERANSLARI = [2, 4, 6]

/** Verilen noktanın altındaki ilk sağlam zemini bul (uçan oyuncu için) */
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

    // Hedefi HER DENEMEDE yeniden hesapla — oyuncu bu arada yürümüş olabilir
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

    const mesafe = bot.entity.position.distanceTo(nokta)
    if (mesafe <= tolerans) {
      bot.chat('Zaten yanındayım.')
      return { basarili: true }
    }

    log.bilgi(`Deneme (tolerans ${tolerans}): ${nokta.x.toFixed(0)},${nokta.y.toFixed(0)},${nokta.z.toFixed(0)} — ${mesafe.toFixed(1)} blok`)

    try {
      pathfinderHazirla(bot) // önceki komuttan mandal kalmış olabilir
      await sinirli(
        bot.pathfinder.goto(new goals.GoalNear(nokta.x, nokta.y, nokta.z, tolerans)),
        30000,
        kontrol
      )
      log.basari('Geldim.')
      bot.chat('Geldim.')
      return { basarili: true }
    } catch (err) {
      if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }

      sonHata = err.message
      // HAM hatayı terminale bas — teşhis için asıl bilgi bu
      log.uyari(`Tolerans ${tolerans} başarısız — ham hata: "${err.message}"`)
      pathfinderDurdur(bot)
      await new Promise((r) => setTimeout(r, 400)) // pathfinder toparlansın
    }
  }

  log.hata(`Üç deneme de başarısız. Son hata: ${sonHata}`)
  bot.chat(`Yanına gelemedim (${sonHata}). Terminaldeki ham hatayı kontrol et.`)
  return { basarili: false, hata: sonHata }
}

module.exports = { gel, altindakiZemin }
