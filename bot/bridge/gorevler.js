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

/**
 * GÖREVDEN BAĞIMSIZ EK GÖZLEM — 4 sayı.
 *
 * Önce sadece madende vardı. Ölçüm oradan geldi: bu bilgiler olmadan taklit
 * doğruluğu %25.5 çıkıyordu (dört aksiyonda kör tahmin %25), çünkü uzman
 * adımlarının %39'unu yere düşmüş cevheri toplamaya harcıyor ve gözlemde
 * düşmüş eşya hakkında hiçbir şey yoktu. Aynı gözleme bazen "sağa dön"
 * bazen "sola dön" düşüyordu: öğrenilemez veri.
 *
 * ODUN GÖREVİNDE DE AYNI DURUM VAR — orada da uzman düşen kütükleri
 * kovalıyor. Milestone 6'da (çok görevli tek ajan) iki görev aynı ağı
 * paylaşacağı için gözlemin de ortak olması gerekiyor; o yüzden burası
 * artık paylaşılan bir fonksiyon.
 *
 * Hepsi EGOSENTRİK (ajanın kendi bakışına göre), yani Python tarafında ek
 * bir dönüşüm gerekmiyor:
 *   sin(açı) : eşya sağımda mı solumda mı
 *   cos(açı) : 1 = tam önümde, -1 = tam arkamda
 *   mesafe   : 0..1 (eşya yoksa 1)
 *   kırılabilir engel: önümü kapatan bloğu KIRABİLİYOR muyum
 *
 * Son sayı ayrı bir boşluğu kapatıyor: uzman "kır" ile "dolaş" arasında
 * `onumuKapatan()`e bakarak seçiyor, ama gözlemde sadece "önüm kapalı mı"
 * vardı — "kırılabilir mi" yoktu.
 *
 * Eşya yoksa sin=0 VE cos=0 gönderiliyor; gerçek bir açıda ikisi aynı anda
 * sıfır olamaz, yani "eşya yok" ayırt edilebilir durumda.
 */
const EK_GOZLEM = (env) => {
  const bot = env.bot
  const esya = env.yakinEsya()

  let sin = 0
  let cos = 0
  let mesafe = 1
  if (esya) {
    const fark = esya.position.minus(bot.entity.position)
    const uzaklik = Math.max(Math.hypot(fark.x, fark.z), 0.001)
    const esyaYaw = Math.atan2(-fark.x, -fark.z)
    let aci = esyaYaw - bot.entity.yaw
    aci = ((aci + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
    sin = Math.sin(aci)
    cos = Math.cos(aci)
    mesafe = Math.min(uzaklik / 8, 1)
  }

  return [sin, cos, mesafe, env.onumuKapatan() ? 1 : 0]
}

// Kaç sayı eklediğini tek yerden bildir — testler ve env.py bunu kullanıyor
EK_GOZLEM.uzunluk = 4

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
    baslangictaYurut: true,

    // Kaynak ararken kaç blok uzağa bakılsın. Ormanda 64 blok makul:
    // arazi açık, ajan 64 bloğu bir bölümde yürüyebiliyor.
    aramaYaricapi: 64,

    ekGozlem: EK_GOZLEM,

    /**
     * ODUN GÖREVİNİN VARSAYILAN GÖZLEMİ DAR (16 sayı).
     *
     * `ekGozlem` tanımlı ama varsayılan olarak KAPALI, çünkü Milestone 4'ün
     * eğitilmiş modelleri (`bc_policy.pt`, `ppo_son.zip`) 19 boyutlu girdi
     * bekliyor. Genişletmek onları yüklenemez hale getirirdi — ölçülmüş ve
     * yayınlanmış sonuçları yeni bir görev uğruna bozmak doğru takas değil.
     *
     * Python tarafı `genisGozlem: true` isterse açılıyor. Çok görevli
     * eğitim (Milestone 6) bunu istiyor, çünkü tek ağ iki görevi de
     * görecekse gözlem genişliği ortak olmak zorunda.
     */
    gozlemProfili: 'dar'
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
      if (uygunAlet(bot, blok)) return true
      // Kürek işi bloklar (toprak, çakıl, kum, kil, çamur) ELLE de hızlı
      // kırılır; kürek taşımıyoruz diye yolumuzu kapatmalarına gerek yok.
      // Taş için bu geçerli değil: elle taş kazmak dakikalar sürer.
      return /^mineable\/shovel$/.test(blok.material || '') ||
        /dirt|gravel|sand/.test(blok.name)
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
    baslangictaYurut: false,

    /**
     * MADENDE ARAMA YARIÇAPI KÜÇÜK OLMAK ZORUNDA.
     *
     * Bu, PPO eğitiminin 2. bölümden sonra tamamen çökmesinin sebebiydi:
     * 1. bölüm 5 cevher topladı, 2-18 arası HEPSİ sıfır aldı.
     *
     * `findBlocks` DUVARIN ARDINI DA görüyor. Yer altında, y=15'te, 64
     * blok yarıçapında her zaman bir cevher vardır — taşın 40 blok
     * gerisinde. Ajan yerel damarı bitirdikten sonra ortam hâlâ "hedef
     * var" diyordu, bu yüzden `tazeMadeneIsinla()` hiç çalışmadı ve ajan
     * her bölümü ulaşamayacağı bir cevhere doğru tünel kazarak geçirdi.
     * Bölümler tam 60 adımda (yerinde sayma kesme eşiği) bitiyordu.
     *
     * Ormanda bu sorun yok: orada 64 blok AÇIK arazi, ajan yürüyerek
     * gidebiliyor. Madende bir bloğu geçmek dönme + kırma + yürüme
     * demek; bir bölümde gerçekçi menzil ~15 blok.
     *
     * 16'ya indirince ortamın değişmez kuralı geri geliyor:
     * "bölüm başında ULAŞILABİLİR bir hedef vardır."
     */
    aramaYaricapi: 16,

    /**
     * DİKEY HEDEFİ HIZLI BIRAK.
     *
     * Ajanın aksiyon uzayında yukarı gitmek yok. Tam tepemizdeki bir
     * cevher, menzilde değilse, bizim için ULAŞILAMAZ.
     *
     * Bu mantık önce sadece `expert.js`teydi. PPO direksiyona geçince
     * kimse çağırmadı ve ajan bölümün tamamını ulaşılamaz bir hedefe
     * kilitli geçirdi. Aynı dersin yeni bir hâli: uzman, öğrencinin
     * etkileyemeyeceği bir ortam durumuna dayanamaz — dolayısıyla bu
     * karar ORTAMIN işi, uzmanın değil.
     */
    dikeyBirakma: true,

    /**
     * MADENE ÖZEL EK GÖZLEM — UZMANIN GÖRDÜĞÜNÜ AJAN DA GÖRSÜN.
     *
     * Ölçüm: taklit doğruluğu %25.5 çıktı. Dört aksiyon var, kör tahmin
     * %25; "her zaman kır" desek %33 tutturur. Yani ağ hiçbir şey
     * öğrenemedi. BC ve pretrain'in ikisi de aynı yeri gösterdi, yani
     * veri bölme hatası değil — veri gerçekten öğrenilemezdi.
     *
     * Sebep: uzman adımlarının %39'unu YERE DÜŞMÜŞ CEVHERİ toplamaya
     * harcıyor (`yakin_cevheri_aliyorum_*`), ama gözlemde düşmüş eşya
     * hakkında hiçbir şey yoktu. Aynı gözlemde bazen "sağa dön" bazen
     * "sola dön" yazıyordu; ayrımı yapan bilgi ajana hiç gösterilmiyordu.
     *
     * Bu, projede üçüncü kez karşımıza çıkan aynı kural:
     * UZMAN, ÖĞRENCİNİN GÖREMEDİĞİ BİLGİYE DAYANAMAZ.
     *
     * Neden şimdi patladı: görüş hattı düzeltmesinden önce bot cevheri
     * duvarın ardından kırıyordu, düşen eşya ulaşılamaz yerlere düşüyordu
     * ve bu dal neredeyse hiç çalışmıyordu. Bot düzelince dal çalışmaya
     * başladı ve gözlemdeki boşluk ortaya çıktı.
     *
     * Neden SADECE madende: odun görevi 16 sayıyla Milestone 4'te
     * ölçüldü ve modelleri kayıtlı. Gözlemi orada da büyütmek o
     * modelleri yüklenemez hale getirirdi.
     *
     * Dört sayı, hepsi EGOSENTRİK (ajanın kendi bakışına göre), yani
     * Python tarafında ek bir dönüşüm gerekmiyor:
     *   sin(açı) : eşya sağımda mı solumda mı
     *   cos(açı) : 1 = tam önümde, -1 = tam arkamda
     *   mesafe   : 0..1 (eşya yoksa 1)
     *   kırılabilir engel: önümü kapatan bloğu KIRABİLİYOR muyum
     *
     * Son sayı ayrı bir boşluğu kapatıyor: uzman "kır" ile "dolaş"
     * arasında `onumuKapatan()`e bakarak seçiyor, ama gözlemde sadece
     * "önüm kapalı mı" vardı — "kırılabilir mi" yoktu.
     *
     * Eşya yoksa sin=0 VE cos=0 gönderiyoruz; gerçek bir açıda bu ikisi
     * aynı anda sıfır olamaz, yani "eşya yok" ayırt edilebilir durumda.
     */
    ekGozlem: EK_GOZLEM,

    // Madende ek gözlem VARSAYILAN OLARAK AÇIK: bu görevin ölçülmüş
    // sonuçları (Milestone 5b) zaten 20 sayılık gözlemle alındı.
    gozlemProfili: 'genis'
  }
}

function gorevGetir (ad) {
  return GOREVLER[ad] || GOREVLER.odun
}

module.exports = {
  GOREVLER, gorevGetir, cevherSay, kazmaDurumu, gerekenSeviye, KAZMA_SEVIYELERI,
  EK_GOZLEM
}
