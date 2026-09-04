'use strict'

const { kutukMu, oduncuSay, dogalAgacMi, govdeninDibi } = require('../skills/chopTree')

/**
 * Task definitions.
 *
 * The environment keeps everything a learning algorithm sees — observation,
 * actions, reward shape, episode logic. What differs per task lives here:
 * what counts as a target, whether it is collectable, how to count progress,
 * and how far to look. Two tasks, one environment, one PPO script.
 */

const CEVHER = /_ore$/

// Blocks the wood agent may break to clear a path. Stone and dirt are
// excluded on purpose: mining stone by hand takes minutes and has nothing
// to do with the task.
const YUMUSAK = /_leaves$|vine|_sapling$|bamboo|cobweb|azalea|moss_|snow|sugar_cane|cactus|_mushroom_block$|shroomlight|_wart_block$/

// Required pickaxe tier per ore. `uygunAlet` answers "do I hold a pickaxe",
// not "is it good enough" — hitting diamond with a stone pickaxe destroys
// the ore: the block breaks and nothing drops.
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

    // Target the trunk base, not the log we found — cutting top-down is
    // slower and sends the agent climbing.
    hedefiDuzelt: (bot, blok) => govdeninDibi(bot, blok),

    // Only soft plant blocks may be cleared here.
    engelKirilabilirMi: (bot, blok) => !!blok && YUMUSAK.test(blok.name),

    // Straight-line distance is the right measure in open terrain.
    hedefMaliyeti: (bot, konum) => konum.distanceTo(bot.entity.position),

    // Walking the agent near a target at episode start is fair here:
    // crossing open ground is not the task.
    baslangictaYurut: true,

    // 64 blocks is walkable within one episode in open terrain.
    aramaYaricapi: 64,

    ekGozlem: EK_GOZLEM,

    // Narrow (16) by default: the Milestone 4 models expect 19 inputs and
    // would stop loading if this grew. Multi-task training turns it on via
    // `genisGozlem` because one network needs one input size.
    gozlemProfili: 'dar'
  },

  /** Milestone 5: yeraltında cevher topla. */
  maden: {
    ad: 'maden',
    hedefAdet: 5,
    // Wipe the whole inventory. Ores have no single tag like
    // `#minecraft:logs`, so skipping the clear let the inventory fill up
    // across episodes. Measured: with 36 slots full, `/give iron_pickaxe`
    // succeeds server-side ("Gave 1 [Iron Pickaxe]") but the item never
    // arrives. A pickaxe-less bot destroys ore instead of collecting it, and
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
