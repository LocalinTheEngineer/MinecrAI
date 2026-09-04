'use strict'

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

/**
 * Pick a fuel and say honestly whether it covers the job.
 *
 * Three bugs lived in the previous version and together they produced the
 * symptom "the bot placed a furnace, under-fuelled it, waited, and gave up":
 *
 *   1. It returned the same shape whether the fuel was enough or not, so no
 *      caller could tell. `uret.js` has a "fetch coal if there is no fuel"
 *      check that therefore never fired — the bot almost always holds planks.
 *   2. `find()` sees one stack per fuel type. Coal split across two stacks
 *      counted as half.
 *   3. A furnace has one fuel slot, so types cannot be mixed — but the code
 *      also never checked whether the chosen type alone could finish.
 *
 * Returns null if there is no fuel at all, otherwise:
 *   { esya, kullan, yeterli, pisebilecek }
 */
function yakitBul (bot, gerekenAdet) {
  const secenekler = []
  for (const { desen, adet } of YAKITLAR) {
    const yiginlar = bot.inventory.items().filter((i) => desen.test(i.name))
    if (yiginlar.length === 0) continue
    const toplam = yiginlar.reduce((t, i) => t + i.count, 0)
    secenekler.push({
      esya: yiginlar[0],
      toplam,
      birim: adet,
      kapasite: Math.floor(toplam * adet)
    })
  }
  if (secenekler.length === 0) return null

  // YAKITLAR is in PREFERENCE order, not efficiency order — a coal block
  // burns 80 items against coal's 8, but spending a block on a two-item job
  // is waste. Take the first listed type that can finish alone; if none can,
  // take whichever gets furthest.
  const yeterli = secenekler.find((y) => y.kapasite >= gerekenAdet)
  const secim = yeterli || secenekler.reduce((a, b) => (b.kapasite > a.kapasite ? b : a))

  const kullan = Math.min(secim.toplam, 64, Math.ceil(gerekenAdet / secim.birim))
  return {
    esya: secim.esya,
    kullan,
    yeterli: Boolean(yeterli),
    pisebilecek: Math.floor(kullan * secim.birim)
  }
}

/**
 * Yakında fırın var mı, yoksa envanterdekini yere koy.
 *
 * `blast_furnace` da listede: cevher eritmede normal fırınla aynı işi
 * görüyor (üstelik iki kat hızlı). Botun envanterinde bir tane vardı ama
 * kod onu tanımadığı için görmezden geliyordu.
 */
const FIRINLAR = ['furnace', 'blast_furnace']

async function firinBul (bot, kontrol = null) {
  const mcData = require('minecraft-data')(bot.version)
  const { blokKoy } = require('../utils/yerlestir')

  const idler = FIRINLAR
    .map((n) => (mcData.blocksByName[n] || {}).id)
    .filter((x) => x !== undefined)

  const mevcut = bot.findBlock({ matching: idler, maxDistance: 4 })
  if (mevcut) return mevcut

  for (const ad of FIRINLAR) {
    if (!bot.inventory.items().some((i) => i.name === ad)) continue
    const konan = await blokKoy(bot, ad, kontrol)
    if (konan) return konan
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

  let pisecek = Math.min(adet, elde)

  const yakit = yakitBul(bot, pisecek)
  if (!yakit || yakit.pisebilecek < 1) {
    return { basarili: false, mesaj: 'Yakıtım yok (kömür veya odun lazım).', eksik: 'coal' }
  }

  // Not enough fuel to finish: smelt what we can rather than nothing, but
  // say so, so the production loop can fetch coal and come back. Silently
  // under-fuelling is what made the bot sit at a furnace and then fail.
  const hedeflenen = pisecek
  if (!yakit.yeterli) {
    pisecek = Math.min(pisecek, yakit.pisebilecek)
    log.uyari(`Yakıt ${hedeflenen} için yetmiyor, ${pisecek} tane eritebilirim.`)
  }

  const firin = await firinBul(bot, kontrol)
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
    return {
      basarili: false,
      eksik: yakit.yeterli ? undefined : 'coal',
      mesaj: yakit.yeterli
        ? `${hedefAd} çıkmadı — fırın çalışmamış olabilir.`
        : `${hedefAd} çıkmadı — yakıt yetmedi, kömür lazım.`
    }
  }
  if (alinan < hedeflenen) {
    return {
      basarili: true,
      alinan,
      eksik: 'coal',
      mesaj: `${alinan}/${hedeflenen}x ${hedefAd} eritildi — yakıt bitti.`
    }
  }
  return { basarili: true, alinan, mesaj: `${alinan}x ${hedefAd} eritildi.` }
}

module.exports = { erit, eritmeGirdisi, eritmeSonucu, yakitBul, ERITME, YAKITLAR }
