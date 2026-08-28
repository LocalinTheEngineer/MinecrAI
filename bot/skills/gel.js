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

// Dikey mesafe yatayla aynı şey değil: 6 blok yanındaki bota "geldim" denir
// ama 6 blok altındaki bota denmez — arada duvar, tavan, uçurum vardır.
// Bu yüzden yatay ve dikey toleransı ayrı tutuyoruz.
const DIKEY_TOLERANS = 3

// Bu kadar dikey fark varsa pathfinder sana ulaşmak için tünel kazmaya
// kalkışabilir; dakikalar sürer ve araziyi mahveder. Önce uyarıyoruz.
const TUNEL_ESIGI = 12

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

    const yatay = bot.entity.position.xzDistanceTo(nokta)
    const dikey = Math.abs(bot.entity.position.y - nokta.y)

    // "Zaten yanındayım" demek için HEM yatayda yakın HEM aynı seviyede olmalı
    if (yatay <= tolerans && dikey <= DIKEY_TOLERANS) {
      bot.chat('Zaten yanındayım.')
      return { basarili: true }
    }

    if (dikey > TUNEL_ESIGI && tolerans === DENEME_TOLERANSLARI[0]) {
      bot.chat(`Aramızda ${dikey.toFixed(0)} blok yükseklik farkı var — ulaşmam uzun sürebilir.`)
    }

    log.bilgi(`Deneme (tolerans ${tolerans}): ${nokta.x.toFixed(0)},${nokta.y.toFixed(0)},${nokta.z.toFixed(0)} — yatay ${yatay.toFixed(1)}, dikey ${dikey.toFixed(1)}`)

    try {
      pathfinderHazirla(bot) // önceki komuttan mandal kalmış olabilir
      await sinirli(
        bot.pathfinder.goto(new goals.GoalNear(nokta.x, nokta.y, nokta.z, tolerans)),
        30000,
        kontrol
      )
      // Ulaştığını iddia etmeden ÖNCE gerçekten nerede olduğuna bak.
      // Pathfinder hedefe "yeterince yakın" sayabilir ama arada dikey fark
      // kalmış olabilir — bunu gizlemek yerine söylüyoruz.
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
