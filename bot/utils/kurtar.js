'use strict'

const log = require('./log')
const koruma = require('./koruma')

/**
 * SIKIŞMADAN KURTULMA
 *
 * Bir önceki adımda takılmayı TESPİT etmeyi ekledim: bot 4 saniye
 * kıpırdamazsa "takıldım" diyor. Ama tespit tek başına yarım çözüm —
 * bot hâlâ sıkışmış olduğu yerde duruyor, sadece artık bunu biliyor.
 * Çağıran taraf başka bir hedefe geçiyor, pathfinder aynı dar yarıkta
 * yine yol bulamıyor, döngü baştan başlıyor.
 *
 * Eksik olan parça buydu: botu FİİLEN kurtarmak.
 *
 * Bot kendi kazdığı 1 blok genişliğindeki bir kuyuya sıkışıyor. Bir
 * oyuncu bu durumda ne yapar? Etrafına bakar, açık bir yön varsa
 * zıplayarak oraya geçer; yoksa kazmasını çıkarıp kendine yol açar.
 * Aynısını yapıyoruz.
 */

const TEHLIKELI = /lava|bedrock/
const YONLER = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function bekle (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Bu yönde ayak ve baş hizası boş mu? */
function acikMi (bot, p, dx, dz) {
  const ayak = bot.blockAt(p.offset(dx, 0, dz))
  const bas = bot.blockAt(p.offset(dx, 1, dz))
  if (!ayak || !bas) return false
  return ayak.boundingBox !== 'block' && bas.boundingBox !== 'block'
}

/** Bir bloğu kırmayı dene (güvenliyse) */
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
 * Botu sıkıştığı yerden kurtarmayı dene.
 * @returns {Promise<boolean>} konum değiştiyse true
 */
async function kurtar (bot, kontrol = null) {
  const baslangic = bot.entity.position.clone()

  try { bot.pathfinder.stop(); bot.pathfinder.setGoal(null) } catch (err) {}
  try { bot.clearControlStates() } catch (err) {}
  await bekle(200)

  const p = bot.entity.position.floored()
  const acikYonler = YONLER.filter(([dx, dz]) => acikMi(bot, p, dx, dz))

  // 1) Açık bir yön varsa zıplayarak oraya geç.
  //    Sıkışmaların çoğu blok kenarına takılma; küçük bir zıplama yetiyor.
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

  // 2) Her yön kapalı: kendimize yol kaz.
  //    Bot zaten kazma taşıyor; dar bir kuyuda beklemesinin anlamı yok.
  for (const [dx, dz] of YONLER) {
    const ayakKondu = await kirmayiDene(bot, p.offset(dx, 0, dz))
    const basKondu = await kirmayiDene(bot, p.offset(dx, 1, dz))
    if (ayakKondu || basKondu) {
      log.bilgi('Sıkıştım, kendime yol açtım.')
      return true
    }
    if (kontrol) kontrol.kontrolEt()
  }

  // 3) Son çare: yukarı kaz. Kendi kazdığımız kuyunun dibindeysek
  //    çıkış yukarıdadır.
  if (await kirmayiDene(bot, p.offset(0, 2, 0))) {
    log.bilgi('Sıkıştım, yukarı doğru yol açtım.')
    return true
  }

  log.uyari('Sıkıştım ve kurtulamadım.')
  return false
}

module.exports = { kurtar, acikMi }
