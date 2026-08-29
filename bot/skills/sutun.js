'use strict'

const Vec3 = require('vec3')
const log = require('../utils/log')
const { IptalEdildi, sinirli } = require('../utils/gorev')

/**
 * SKILL: Sütun yap / sütundan in  ("pillar jumping")
 *
 * PROBLEM
 * Ağacın tepesindeki kütükler yerden 5-7 blok yukarıda. Botun kolu ancak
 * ~4.5 blok uzanıyor. Pathfinder de oraya yürüyemiyor çünkü havada
 * basılacak bir zemin yok. Sonuç: bot ağacın ortasını kesip tepedeki
 * 3-4 kütüğü bırakıp gidiyordu.
 *
 * ÇÖZÜM
 * Oyuncuların yaptığının aynısı: zıpla, havadayken ayağının altına blok
 * koy, tekrarla. Her tur 1 blok yükseliyorsun.
 *
 * NEDEN PATHFINDER'IN KENDİ KULE ÖZELLİĞİ DEĞİL?
 * mineflayer-pathfinder'da `allow1by1towers` var ve varsayılan olarak açık.
 * Kapattık (bot/index.js), çünkü açıkken bot NORMAL yürürken de canı
 * istedikçe kule dikiyordu — iki blokluk bir tepeyi dolaşmak yerine
 * yanına kule örüyordu. Kuleyi tamamen kapatmak yerine, ne zaman kule
 * gerektiğine BİZ karar ediyoruz: sadece "yukarıdaki kütüğe uzanamıyorum"
 * durumunda bu dosya çağrılıyor. Aynı yetenek, kontrollü kullanım.
 */

// Sütun için kullanılabilecek bloklar — tercih sırasıyla.
// Toprak/taş en ucuzu; odun listede EN SONDA çünkü asıl toplamak
// istediğimiz şey o (yine de geri kazanıyoruz, sadece son çare).
const SUTUN_ADAYLARI = [
  /^dirt$|^coarse_dirt$|^rooted_dirt$|^grass_block$/,
  /^cobblestone$|^cobbled_deepslate$|^stone$|^netherrack$|^andesite$|^diorite$|^granite$/,
  /_planks$/,
  /_log$|_stem$/
]

/** Envanterde sütun yapmaya uygun bir blok var mı? */
function sutunBlogu (bot) {
  for (const desen of SUTUN_ADAYLARI) {
    const esya = bot.inventory.items().find((i) => desen.test(i.name))
    if (esya) return esya
  }
  return null
}

/** Ayağımızın hemen altındaki blok */
function ayakAlti (bot) {
  return bot.blockAt(bot.entity.position.offset(0, -0.5, 0))
}

/**
 * Bir kat yükseliyor: zıpla → havadayken ayağının altına blok koy.
 *
 * Zamanlama kritik. Bloğu çok erken koyarsan bot henüz o kareyi terk
 * etmemiştir ve sunucu reddeder; çok geç koyarsan bot düşmeye başlamıştır.
 * O yüzden sabit bir süre beklemek yerine botun GERÇEK yüksekliğini
 * izliyoruz: 1 blok yükseldiği an koyuyoruz.
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

  // Dümdüz aşağı bak — blok koyarken referans yüzeyi görmek gerekiyor
  await bot.look(bot.entity.yaw, Math.PI / 2, true)

  bot.setControlState('jump', true)

  let kondu = false
  const bitis = Date.now() + 1200
  while (Date.now() < bitis) {
    kontrol.kontrolEt()
    await new Promise((r) => setTimeout(r, 40))

    // Bir blok yükseldik mi? O an ayağımızın altı boşta.
    if (bot.entity.position.y - baslangicY >= 1.0) {
      try {
        await bot.placeBlock(zemin, new Vec3(0, 1, 0))
        kondu = true
      } catch (err) {
        // Sunucu reddettiyse blok gerçekten kondu mu diye bakalım —
        // placeBlock bazen konmuş bloğa rağmen hata fırlatıyor
        const b = bot.blockAt(hedefKonum)
        kondu = !!(b && b.name !== 'air')
      }
      break
    }
  }

  bot.setControlState('jump', false)
  await kontrol.bekle(250) // bloğun üstüne oturmasını bekle

  if (!kondu) return { ok: false, sebep: 'blok_konmadi' }
  return { ok: true }
}

/**
 * Ayakları `hedefY` seviyesine gelene kadar sütun ör.
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
 * Sütunu sökerek in. Kırdığımız bloklar geri envantere giriyor —
 * sütun bedava, sadece ödünç.
 */
async function sutundanIn (bot, hedefY, kontrol, { maksKat = 16 } = {}) {
  let inilen = 0

  while (Math.floor(bot.entity.position.y) > hedefY && inilen < maksKat) {
    kontrol.kontrolEt()

    const alt = ayakAlti(bot)
    if (!alt || alt.name === 'air') {
      // Havadayız, düşüyoruz — yere değmesini bekle
      await kontrol.bekle(200)
      continue
    }
    if (!bot.canDigBlock(alt)) break

    try {
      await bot.look(bot.entity.yaw, Math.PI / 2, true)
      await sinirli(bot.dig(alt), 8000, kontrol)
    } catch (err) {
      if (err instanceof IptalEdildi) { bot.stopDigging(); throw err }
      break
    }

    inilen++
    await kontrol.bekle(300) // düşüşü bekle
  }

  // Sütunu kırarken düşen bloklar için kısa bir bekleme —
  // botun üstünden geçince kendiliğinden toplanıyorlar
  await kontrol.bekle(200)
  return inilen
}

module.exports = { sutunaCik, sutundanIn, birKatCik, sutunBlogu }
