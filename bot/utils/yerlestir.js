'use strict'

const Vec3 = require('vec3')
const log = require('./log')
const koruma = require('./koruma')

/**
 * Blok yerleştirme — tezgah, fırın, sandık.
 *
 * PROBLEM
 * Hem `tezgahKoy` hem `firinBul` aynı naif aramayı yapıyordu: yanındaki
 * 6 sabit noktaya bak, birinde zemin dolu + üstü boş ise oraya koy.
 * Tünelde, mağarada, dar bir yarıkta bu altı nokta çoğu zaman tutmuyor
 * ve bot "koyacak yer bulamadım" deyip pes ediyordu — envanterinde iki
 * fırınla birlikte.
 *
 * ÇÖZÜM
 * İki aşama. Önce daha geniş bir alanda hazır yer ara (5x5x3, en yakından
 * başlayarak). Bulamazsa YER AÇ: yanındaki bir bloğu kır. Bot zaten
 * kazma taşıyan bir madenci; "yer yok" diye pes etmesi saçma.
 */

const TEHLIKELI = /lava|water|bedrock/

/** Yerleştirmeye uygun hazır bir nokta var mı? */
function hazirYerBul (bot) {
  const p = bot.entity.position.floored()
  const adaylar = []

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dz === 0) continue // tam üstümüze/altımıza koyma
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
 * Yanındaki bir bloğu kırarak yer aç.
 * Bot zaten kazma taşıyor; "yer yok" demek yerine yer açması doğal.
 */
async function yerAc (bot, kontrol) {
  const { aletKusan } = require('../skills/alet') // döngüsel require olmasın diye burada
  const p = bot.entity.position.floored()

  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (kontrol) kontrol.kontrolEt()

    const hedef = p.offset(dx, 0, dz)
    const blok = bot.blockAt(hedef)
    const zemin = bot.blockAt(hedef.offset(0, -1, 0))
    if (!blok || !zemin) continue
    if (blok.boundingBox !== 'block') continue // zaten boş
    if (zemin.boundingBox !== 'block') continue // altı boşluk, koyamayız
    if (TEHLIKELI.test(blok.name) || TEHLIKELI.test(zemin.name)) continue
    if (koruma.korumaliMi(hedef)) continue
    if (!bot.canDigBlock(blok)) continue

    try {
      await aletKusan(bot, blok)
      await bot.lookAt(blok.position.offset(0.5, 0.5, 0.5), true)
      await bot.dig(blok)
      log.bilgi('Yer açtım.')
      return true
    } catch (err) { /* başka yön dene */ }
  }
  return false
}

/**
 * `esyaAdi` bloğunu yere koy ve konan bloğu döndür (koyamazsa null).
 * Yer yoksa kendi açar.
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
      } catch (err) { /* aşağıda yer açıp tekrar deneriz */ }
    }

    if (!(await yerAc(bot, kontrol))) break
  }
  return null
}

module.exports = { blokKoy, hazirYerBul, yerAc }
