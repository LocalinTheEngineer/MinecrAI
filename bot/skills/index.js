'use strict'

const { chopTree, chopTrees, oduncuSay, kutukMu, agaciTopla, dusenleriTopla } = require('./chopTree')
const { gel } = require('./gel')
const { baltaYap, aletKusan, uygunAlet } = require('./alet')
const { takipBaslat, takipBirak, takipVarMi } = require('./takip')
const { ver } = require('./ver')
const { uret } = require('./uret')
const { kaz, kazmaSeviyesi } = require('./kaz')
const { erit } = require('./erit')
const { sutunaCik, sutundanIn, yuzeyeSutunla } = require('./sutun')

/**
 * TEMEL MALZEME TEDARİKÇİSİ
 *
 * `uret` tarif ağacını çözerken yaprağa varıyor: kütük, taş, demir cevheri.
 * Bunlar üretilemez, TOPLANIR. Toplamayı `kaz` ve `chopTrees` biliyor.
 *
 * Peki `uret` neden doğrudan onları çağırmıyor? Çünkü `kaz` da kazma yapmak
 * için `uret`i çağırıyor. İki dosya birbirini require ederse Node döngüsel
 * bağımlılıkta birine yarım modül verir ve hata çalışma zamanında,
 * anlaşılmaz bir yerde patlar. (Aynı sebeple environment.js ile expert.js
 * arasına sabitler.js koymuştuk.)
 *
 * Çözüm: `uret` "nasıl toplanır" bilmiyor, sadece "toplanabilir mi" diye
 * soruyor. Cevabı buradan, dışarıdan enjekte ediyoruz. Bağımlılık tek yönlü
 * kalıyor: index.js -> uret, index.js -> kaz.
 */
const ESYA_KAYNAGI = {
  raw_iron: 'demir',
  iron_ore: 'demir',
  raw_gold: 'altin',
  gold_ore: 'altin',
  raw_copper: 'bakir',
  copper_ore: 'bakir',
  coal: 'komur',
  coal_ore: 'komur',
  diamond: 'elmas',
  diamond_ore: 'elmas',
  redstone: 'redstone',
  lapis_lazuli: 'lapis',
  emerald: 'zumrut',
  cobblestone: 'tas',
  stone: 'tas',
  cobbled_deepslate: 'tas',
  deepslate: 'tas'
}

/**
 * KAYNAK SINIFI: "hangi tür kütük" değil, "kütük".
 *
 * Botun sonsuz ağaç kesmesinin sebebi buydu. Çubuğun ~12 tarifi var,
 * her ağaç türü için bir tane. `uret` sırayla hepsini deniyordu:
 *
 *   spruce_planks <- spruce_log  -> tedarikçi: AĞAÇ KES
 *   birch_planks  <- birch_log   -> tedarikçi: AĞAÇ KES
 *   jungle_planks <- jungle_log  -> tedarikçi: AĞAÇ KES
 *   ... 12 kez
 *
 * Her seferinde eline meşe geçiyor, istenen tür gelmiyor, sıradaki
 * tarife geçiliyor ve TEKRAR ağaç kesiliyordu. Log'da bunu gördük:
 * tek bir "uret tas kazma" komutu 4 ağaç kesti ve hâlâ bitmemişti.
 *
 * Çözüm: tedarikçi eşya adına değil KAYNAK SINIFINA bakıyor. Bir kez
 * odun getirdiyse, bu komut boyunca bir daha ağaç kesmiyor — envanterde
 * zaten odun var, `uret`in yeniden puanlaması doğru türü seçecek.
 */
function kaynakSinifi (ad) {
  if (/_log$|_stem$/.test(ad)) return 'odun'
  return ESYA_KAYNAGI[ad] || null
}

/**
 * Her komut için YENİ bir tedarikçi üretir.
 *
 * Neden fabrika? "Bu komutta zaten odun topladım" hafızasının komut
 * bitince sıfırlanması gerekiyor. Modül seviyesinde tek bir Set tutmak,
 * ikinci komutta botun hiç ağaç kesmemesine yol açardı.
 */
function tedarikciYap () {
  const verilen = new Set() // bu komutta zaten toplanan kaynak sınıfları
  const yol = new Set() // şu an toplanmakta olanlar (döngü koruması)

  return async function tedarikci (bot, kontrol, ad, adet) {
    const sinif = kaynakSinifi(ad)
    if (!sinif) return false
    if (verilen.has(sinif)) return false // bu komutta bir kez topladık
    if (yol.has(sinif)) return false // şu an topluyoruz, tekrar girme
    if (yol.size > 3) return false // zincir çok derinleşti

    yol.add(sinif)
    try {
      let getirdi = false

      if (sinif === 'odun') {
        const r = await chopTrees(bot, kontrol, Math.max(1, Math.ceil(adet / 5)))
        getirdi = r.kazanilanOdun > 0
      } else {
        const r = await kaz(bot, kontrol, sinif, Math.max(1, adet), { tedarikci })
        getirdi = r.kirilan > 0
      }

      if (getirdi) verilen.add(sinif)
      return getirdi
    } finally {
      yol.delete(sinif)
    }
  }
}

/** `uret`i taze bir tedarikçiyle çağıran kısayol — komutlar bunu kullanır */
function getir (bot, kontrol, istek, adet = 1) {
  return uret(bot, kontrol, istek, adet, { tedarikci: tedarikciYap() })
}

/**
 * Bütün "skill"ler (botun yapabildiği işler) buradan dışa açılır.
 * Yeni bir yetenek eklediğinde sadece buraya bir satır ekleyeceksin.
 */
module.exports = {
  chopTree,
  chopTrees,
  gel,
  baltaYap,
  aletKusan,
  uygunAlet,
  takipBaslat,
  takipBirak,
  takipVarMi,
  ver,
  uret,
  getir,
  tedarikciYap,
  kaz,
  kazmaSeviyesi,
  erit,
  sutunaCik,
  sutundanIn,
  yuzeyeSutunla,
  oduncuSay,
  kutukMu,
  agaciTopla,
  dusenleriTopla
}
