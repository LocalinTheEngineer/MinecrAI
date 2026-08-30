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

// HANGİ CEVHER HANGİ KAZMA SEVİYESİNİ İSTER?
//
// `uygunAlet` "elinde kazma var mı" sorusuna cevap veriyor, "bu cevher
// için YETER Mİ" sorusuna değil. Taş kazmayla elmasa vurmak elması YOK
// EDİYOR — blok kırılıyor, yere hiçbir şey düşmüyor.
//
// Bu tabloyla ajan yetersiz kazmayla cevhere hiç yönlendirilmiyor.
const KAZMA_SEVIYELERI = ['wooden', 'stone', 'iron', 'diamond', 'netherite']

const CEVHER_GEREKSINIMI = [
  { desen: /coal_ore$/, seviye: 'wooden' },
  { desen: /(copper|iron|lapis)_ore$/, seviye: 'stone' },
  { desen: /(gold|redstone|diamond|emerald)_ore$/, seviye: 'iron' }
]

/** Bu cevher için gereken kazma seviyesi (bilinmiyorsa en güvenlisi) */
function gerekenSeviye (ad) {
  for (const { desen, seviye } of CEVHER_GEREKSINIMI) {
    if (desen.test(ad)) return seviye
  }
  return 'iron'
}

/** Envanterdeki en iyi kazmanın seviyesi ve kalan vuruşu */
function kazmaDurumu (bot) {
  let enIyi = -1
  let kalan = 0
  for (const esya of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(esya.name)
    if (!m) continue
    const tur = m[1] === 'golden' ? 'stone' : m[1]
    const i = KAZMA_SEVIYELERI.indexOf(tur)
    if (i < 0) continue
    const vurus = esya.maxDurability
      ? esya.maxDurability - (esya.durabilityUsed || 0)
      : Infinity
    if (i > enIyi) { enIyi = i; kalan = vurus } else if (i === enIyi) kalan += vurus
  }
  return { seviye: enIyi, kalan }
}

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
    engelKirilabilirMi: (bot, blok) => !!blok && YUMUSAK.test(blok.name),

    // Hedef seçerken maliyet: ormanda düz kuş uçuşu mesafe doğru ölçü.
    hedefMaliyeti: (bot, konum) => konum.distanceTo(bot.entity.position),

    // Bölüm başında ajanı hedefe yakın bir yere yürüt.
    // Ormanda meşru: açık arazide yürümek görevi çözmüyor.
    baslangictaYurut: true
  },

  /** Milestone 5: yeraltında cevher topla. */
  maden: {
    ad: 'maden',
    hedefAdet: 5,
    // ENVANTERİ TAMAMEN BOŞALT.
    //
    // Odunda tek bir etiket (`#minecraft:logs`) bütün kütükleri
    // kapsıyordu ve balta envanterde kalıyordu. Cevherlerin böyle tek
    // bir etiketi yok, ben de "o zaman temizlemeyelim" dedim — ve
    // envanter bölümden bölüme doldu.
    //
    // Sonucu ölçtük: 36 slot dolunca `/give iron_pickaxe` sunucu
    // tarafında BAŞARILI oluyor ("Gave 1 [Iron Pickaxe]") ama eşya
    // envantere giremiyor. Kazmasız kalan bot cevheri yok ediyor ve
    // bölümler boşa gidiyor. Aynı hatayı odun görevinde de yaşamıştık.
    //
    // '*' = her şeyi sil. Kazma zaten bölüm kurulumunda veriliyor,
    // yani her bölüm aynı temiz durumdan başlıyor — RL için doğrusu da bu.
    temizlemeEtiketi: '*',
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
      // Kazmam bu cevher için YETİYOR MU? "Kazmam var mı" yetmiyor:
      // taş kazmayla elmasa vurmak elması yok ediyor.
      const { seviye, kalan } = kazmaDurumu(bot)
      if (kalan <= 0) return false
      return seviye >= KAZMA_SEVIYELERI.indexOf(gerekenSeviye(blok.name))
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
    },

    /**
     * DİKEY MESAFE YATAYDAN PAHALI.
     *
     * Kuş uçuşu mesafe madende yanlış ölçü. Ajanın aksiyonları yatay:
     * ileri yürü, sağa dön, sola dön. Yukarı çıkmak için altına blok
     * koyması ya da tavanı kırıp zıplaması gerekiyor — ikisi de aksiyon
     * uzayında yok.
     *
     * Sonuç: 8 blok TAM YUKARIDAKİ bir cevher, 12 blok ötede açık bir
     * tünelin ucundaki cevherden "daha yakın" sayılıyordu. Bot ulaşamadığı
     * hedefe kilitleniyordu.
     *
     * Dikey farkı 3 katına sayıyoruz: 8 blok yukarısı 24 birim, 12 blok
     * ileri 12 birim. Artık ulaşılabilir olan seçiliyor.
     */
    hedefMaliyeti: (bot, konum) => {
      const p = bot.entity.position
      const yatay = Math.hypot(konum.x + 0.5 - p.x, konum.z + 0.5 - p.z)
      const dikey = Math.abs(konum.y - p.y)
      return yatay + dikey * 3
    },

    /**
     * MADENDE BÖLÜM BAŞINDA YÜRÜTME.
     *
     * `baslangicaTasi()` pathfinder ile hedefe yaklaşıyor ve pathfinder
     * `canDig: true` — yani taşın içinden TÜNEL KAZARAK gidiyor.
     *
     * Ormanda bu masum: açık arazide yürümek görevin kendisi değil.
     * Madende ise görevin TAM KENDİSİ. Ortam ajan adına tüneli kazıp
     * onu cevherin dibine bırakıyor; ajan hiçbir şey öğrenmeden ödül
     * alıyor ve öğrenme eğrisi anlamsızlaşıyor.
     *
     * Bu, ajanın aksiyon uzayından "pathfinder ile ağaca git" aksiyonunu
     * kaldırmamızla aynı sebep — sadece bu sefer arka kapıdan giriyordu.
     */
    baslangictaYurut: false
  }
}

function gorevGetir (ad) {
  return GOREVLER[ad] || GOREVLER.odun
}

module.exports = {
  GOREVLER, gorevGetir, cevherSay, kazmaDurumu, gerekenSeviye, KAZMA_SEVIYELERI
}
