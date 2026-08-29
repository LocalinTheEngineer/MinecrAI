'use strict'

const Vec3 = require('vec3')
const log = require('../utils/log')

/**
 * SKILL: Erit (fırın)
 *
 * Tezgah ile fırın arasındaki fark tarif tablosunda değil, ZAMANDA.
 * Tezgahta üretim anlık; fırında her eşya 10 saniye pişiyor ve yakıt
 * tüketiyor. minecraft-data'nın tarif tablosu da sadece TEZGAH tariflerini
 * içeriyor — eritme tarifleri orada yok. O yüzden küçük bir tablo
 * elde tutuyoruz.
 *
 * Bu dosyanın varlık sebebi: demir kazma yapmak için demir külçesi lazım,
 * külçe tezgahta üretilemiyor, sadece eritilerek elde ediliyor. Fırın
 * olmadan taş kazmanın ötesine geçilemiyor.
 */

// girdi -> çıktı. minecraft-data'da olmadığı için elle.
const ERITME = {
  raw_iron: 'iron_ingot',
  raw_gold: 'gold_ingot',
  raw_copper: 'copper_ingot',
  iron_ore: 'iron_ingot',
  deepslate_iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  deepslate_gold_ore: 'gold_ingot',
  copper_ore: 'copper_ingot',
  ancient_debris: 'netherite_scrap',
  sand: 'glass',
  cobblestone: 'stone',
  clay_ball: 'brick',
  oak_log: 'charcoal',
  birch_log: 'charcoal',
  spruce_log: 'charcoal'
}

// Yakıtlar ve kaç eşya pişirdikleri. Kömür en verimlisi.
// Odun listede var çünkü botun elinde her zaman odun oluyor.
const YAKITLAR = [
  { desen: /^coal$|^charcoal$/, adet: 8 },
  { desen: /^coal_block$/, adet: 80 },
  { desen: /_log$|_stem$/, adet: 1.5 },
  { desen: /_planks$/, adet: 1.5 },
  { desen: /^stick$/, adet: 0.5 }
]

/** Bu eşya eritilerek neye dönüşür? */
function eritmeSonucu (ad) {
  return ERITME[ad] || null
}

/** `hedefAd`ı üretmek için hangi ham maddeyi eritmek gerekir? */
function eritmeGirdisi (hedefAd) {
  for (const [girdi, cikti] of Object.entries(ERITME)) {
    if (cikti === hedefAd) return girdi
  }
  return null
}

function sayim (bot, ad) {
  return bot.inventory.items()
    .filter((i) => i.name === ad)
    .reduce((t, i) => t + i.count, 0)
}

/** Envanterdeki en uygun yakıt ve kaç eşya pişirebileceği */
function yakitBul (bot, gerekenAdet) {
  for (const { desen, adet } of YAKITLAR) {
    const esya = bot.inventory.items().find((i) => desen.test(i.name))
    if (!esya) continue
    const gerekenYakit = Math.ceil(gerekenAdet / adet)
    if (esya.count >= gerekenYakit) return { esya, kullan: gerekenYakit }
    // Elimizdeki kadarıyla idare et
    return { esya, kullan: esya.count }
  }
  return null
}

/** Yakında fırın var mı, yoksa envanterdekini yere koy */
async function firinBul (bot) {
  const mcData = require('minecraft-data')(bot.version)
  const firin = bot.findBlock({ matching: mcData.blocksByName.furnace.id, maxDistance: 4 })
  if (firin) return firin

  const esya = bot.inventory.items().find((i) => i.name === 'furnace')
  if (!esya) return null

  const p = bot.entity.position.floored()
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) {
    const zemin = bot.blockAt(new Vec3(p.x + dx, p.y - 1, p.z + dz))
    const ust = bot.blockAt(new Vec3(p.x + dx, p.y, p.z + dz))
    if (!zemin || !ust) continue
    if (zemin.boundingBox !== 'block' || ust.name !== 'air') continue
    try {
      await bot.equip(esya, 'hand')
      await bot.placeBlock(zemin, new Vec3(0, 1, 0))
      return bot.findBlock({ matching: mcData.blocksByName.furnace.id, maxDistance: 4 })
    } catch (err) { /* başka yön dene */ }
  }
  return null
}

/**
 * `adet` tane `hedefAd` eritir.
 * Girdi ve yakıtın envanterde OLDUĞU varsayılır — tedarik `uret`in işi.
 */
async function erit (bot, kontrol, hedefAd, adet = 1) {
  const girdiAd = eritmeGirdisi(hedefAd)
  if (!girdiAd) return { basarili: false, mesaj: `${hedefAd} fırında elde edilmiyor.` }

  const elde = sayim(bot, girdiAd)
  if (elde <= 0) return { basarili: false, mesaj: `${girdiAd} yok, eritemem.`, eksik: girdiAd }

  const pisecek = Math.min(adet, elde)

  const yakit = yakitBul(bot, pisecek)
  if (!yakit) return { basarili: false, mesaj: 'Yakıtım yok (kömür veya odun lazım).', eksik: 'coal' }

  const firin = await firinBul(bot)
  if (!firin) return { basarili: false, mesaj: 'Fırınım yok veya koyacak yer bulamadım.', eksik: 'furnace' }

  const mcData = require('minecraft-data')(bot.version)
  const girdiEsya = mcData.itemsByName[girdiAd]

  let f
  try {
    f = await bot.openFurnace(firin)
    await f.putFuel(yakit.esya.type, null, yakit.kullan)
    await f.putInput(girdiEsya.id, null, pisecek)
  } catch (err) {
    try { if (f) f.close() } catch (e) {}
    return { basarili: false, mesaj: `Fırını dolduramadım: ${err.message}` }
  }

  // Pişmesini bekle. Her eşya ~10 saniye; iptal edilebilir olması şart,
  // yoksa "dur" komutu 10 dakika beklemek zorunda kalır.
  log.bilgi(`${pisecek}x ${girdiAd} eritiliyor (~${pisecek * 10} sn)...`)
  let alinan = 0
  const bitis = Date.now() + pisecek * 12000 + 8000

  try {
    while (alinan < pisecek && Date.now() < bitis) {
      kontrol.kontrolEt()
      await kontrol.bekle(1000)
      try {
        while (f.outputItem()) {
          const cikti = await f.takeOutput()
          if (!cikti) break
          alinan += cikti.count
        }
      } catch (err) { /* henüz hazır değil */ }
    }
  } finally {
    try { f.close() } catch (err) {}
  }

  if (alinan === 0) {
    return { basarili: false, mesaj: `${hedefAd} çıkmadı — yakıt yetmemiş olabilir.` }
  }
  return { basarili: true, alinan, mesaj: `${alinan}x ${hedefAd} eritildi.` }
}

module.exports = { erit, eritmeGirdisi, eritmeSonucu, yakitBul, ERITME, YAKITLAR }
