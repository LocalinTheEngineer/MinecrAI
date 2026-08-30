'use strict'

const { kutukMu, oduncuSay, dogalAgacMi, govdeninDibi } = require('../skills/chopTree')

/**
 * GÖREV TANIMLARI
 *
 * Ortam bugüne kadar tek bir işi biliyordu: odun topla. "Kütük mü?",
 * "kaç odunum var?", "5 odunda bitir" — hepsi environment.js'in içine
 * gömülüydü. Madencilik eklemek için ya her satırı ikiye bölmek ya da
 * ikinci bir ortam yazıp yarısını kopyalamak gerekiyordu.
 *
 * Üçüncü yol: ortamın DEĞİŞMEYEN kısmını (gözlem, aksiyonlar, ödül
 * şekli, bölüm mantığı) yerinde bırakıp, göreve göre değişen dört
 * soruyu dışarı çıkarmak:
 *
 *   1. Bu blok hedefim mi?
 *   2. Bu blok gerçekten toplanabilir mi? (oyuncunun evi değil, doğru
 *      kazmam var mı...)
 *   3. Envanterimde bu kaynaktan kaç tane var?
 *   4. Bölüm kaçta biter?
 *
 * Böylece iki görev aynı gözlem uzayını, aynı aksiyonları ve aynı PPO
 * kodunu paylaşıyor. Çok görevli öğrenmeye geçmek istersek gözleme tek
 * bir "hangi görevdeyim" alanı eklemek yetecek — ortamı yeniden yazmak
 * gerekmeyecek.
 */

const CEVHER = /_ore$/

// Odun görevinde ajanın kırmasına izin verilen "yol açma" blokları.
// Taş ve toprak BİLEREK dışarıda: bot bir mağaraya düşünce elleriyle taş
// kazmaya çalışıyordu; elle taş kazmak dakikalar sürer ve görevle ilgisi yok.
const YUMUSAK = /_leaves$|vine|_sapling$|bamboo|cobweb|azalea|moss_|snow|sugar_cane|cactus|_mushroom_block$|shroomlight|_wart_block$/

// Madende hiçbir koşulda kazılmayacak bloklar
const MADEN_TEHLIKE = /lava|water|bedrock|_spawner$|chest|obsidian/
const DEEPSLATE_HARIC = /^(coal|iron|copper|gold|redstone|emerald|lapis|diamond)_ore$|^deepslate_(coal|iron|copper|gold|redstone|emerald|lapis|diamond)_ore$/

/** Envanterdeki cevher ve külçe sayısı (kırılan cevher külçe/parça düşürüyor) */
function cevherSay (bot) {
  return bot.inventory.items()
    .filter((i) => /^raw_|^coal$|^diamond$|^emerald$|^redstone$|^lapis_lazuli$|_ore$/.test(i.name))
    .reduce((toplam, i) => toplam + i.count, 0)
}

const GOREVLER = {
  /** Varsayılan görev: ormanda odun topla. Milestone 1-4 bunun üstüne kuruldu. */
  odun: {
    ad: 'odun',
    hedefAdet: 5,
    temizlemeEtiketi: '#minecraft:logs',
    yuzeyGorevi: true,

    hedefMi: (blok) => kutukMu(blok),
    dogalMi: (bot, blok) => dogalAgacMi(bot, blok),
    say: (bot) => oduncuSay(bot),

    // Ağacın ortasındaki kütüğü değil GÖVDENİN DİBİNİ hedefle: yukarıdan
    // aşağı kesmek hem daha yavaş hem de ajanı tepeye tırmandırıyor.
    hedefiDuzelt: (bot, blok) => govdeninDibi(bot, blok),

    // Yolu kapatan neyi kırabiliriz? Odunda sadece yumuşak bitki blokları.
    engelKirilabilirMi: (bot, blok) => !!blok && YUMUSAK.test(blok.name)
  },

  /** Milestone 5: yeraltında cevher topla. */
  maden: {
    ad: 'maden',
    hedefAdet: 5,
    temizlemeEtiketi: null, // cevher etiketi yok, envanteri elle temizliyoruz
    yuzeyGorevi: false,

    // Bölüm bu derinlikte başlar. Demir y=15 civarında yoğun; elmas
    // (y=-58) daha zengin ama bedrock'a yakın ve lav çok — eğitim için
    // gereksiz ölüm riski.
    baslangicY: 15,

    // Bölüm başında ajana verilen kazma.
    //
    // NEDEN VERİYORUZ: yanlış kazmayla cevher kırmak onu YOK EDİYOR.
    // Ajanın öğrenmesi gereken şey "cevheri bul ve kır"; alet tedariki
    // ayrı bir problem ve onu elle yazılmış `kaz.js` zaten çözüyor.
    // Ağaç görevinde de baltayı ajan üretmiyor.
    aletVer: 'iron_pickaxe',

    hedefMi: (blok) => !!blok && CEVHER.test(blok.name) && DEEPSLATE_HARIC.test(blok.name),

    // Cevherde "oyuncunun yapısı mı" sorusu yok — cevher inşa edilmiyor.
    // Ama YANLIŞ KAZMAYLA kırmak cevheri yok ediyor, o yüzden asıl soru
    // "kırabilir miyim": elimdeki kazma yetiyor mu?
    dogalMi: (bot, blok) => {
      if (!blok) return false
      const { uygunAlet } = require('../skills/alet')
      return !!uygunAlet(bot, blok)
    },

    say: (bot) => cevherSay(bot),
    hedefiDuzelt: (bot, blok) => blok, // damarın kendisi, düzeltme gerekmiyor

    // MADENDE TAŞ KIRMAK GÖREVİN KENDİSİ.
    //
    // Odun görevinde taşı kırmayı yasaklamıştık — orada taş kazmak bir
    // kayıptı. Madende tam tersi: cevhere ulaşmanın tek yolu taşın içinden
    // geçmek ve ajanın elinde kazma var. Aynı soruya iki görev iki farklı
    // cevap veriyor; bu yüzden karar burada, ortamda değil.
    engelKirilabilirMi: (bot, blok) => {
      if (!blok || blok.boundingBox !== 'block') return false
      if (MADEN_TEHLIKE.test(blok.name)) return false
      const { uygunAlet } = require('../skills/alet')
      return !!uygunAlet(bot, blok) || /dirt|gravel|sand/.test(blok.name)
    }
  }
}

function gorevGetir (ad) {
  return GOREVLER[ad] || GOREVLER.odun
}

module.exports = { GOREVLER, gorevGetir, cevherSay }
