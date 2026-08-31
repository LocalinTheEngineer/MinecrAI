'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')

const { gorevGetir } = require('./gorevler')
const log = require('../utils/log')
const { aletKusan } = require('../skills/alet')
const { pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')
const config = require('../config')

const MAX_ADIM = 500

// Her donus aksiyonunda kac radyan donulecek.
// DIKKAT: bu deger expert.js'teki YAW_TOLERANS ile uyumlu olmali.
// Donus adimi tolerans*2'den buyukse ajan hedefi hicbir zaman tutturamaz,
// saga-sola salinip durur (bu hatayi bir kez yaptik).
const DONUS_ACISI = Math.PI / 8  // 22.5 derece

// Yolu kapattiginda kirilmasi mantikli olan bloklar: yaprak, sarmasik, fidan,
// mantar vb. Tas, toprak, cevher BILEREK disarida — elle kazmak cok uzun surer
// ve gorevle ilgisi yok.
const HEDEF_ODUN = 5

// Ölüm cezası. Envanter kaybını ödüle yazmak yerine sabit bir ceza:
// ajan uçurumdan kaçınmayı öğrensin ama tek olay bütün eğitimi bozmasın.
const OLUM_CEZASI = -5

// Bölüm başında bu yarıçaptaki düşmüş eşyalar silinir.
// Her bölüm aynı temiz koşullardan başlasın diye.
const TEMIZLIK_YARICAPI = 100

// Ortak sabitler (expert.js de aynılarını kullanıyor)
const {
  DURGUNLUK_SINIRI, TAKILMA_ESIGI, KACINMA_SURESI, HEDEF_SABIR, DIKEY_SABIR
} = require('./sabitler')

/**
 * Botu bir RL "environment"ına çeviren katman.
 *
 * Python tarafı sadece şunu bilir: reset() ver, step(action) ver, karşılığında
 * gözlem + ödül al. Minecraft'ın karmaşası bu dosyada kalır.
 */
class MinecraftEnvironment {
  constructor (bot, secenekler = {}) {
    this.bot = bot

    // Beklemeleri ölçekleyen çarpan. Oyunda 1 (gerçek süreler).
    // Testte 0 veriliyor: sahte botla oynarken ışınlanma/chunk yüklenmesi
    // beklemenin bir anlamı yok. Bu olmadan smoke testi 43 saniye sürüyordu
    // ve süresinin çoğu `tazeAlanaIsinla`nın 4 x 4 saniyelik beklemesiydi.
    this.zamanCarpani = secenekler.zamanCarpani ?? 1

    // HANGİ GÖREV?
    //
    // Ortamın değişmeyen kısmı (gözlem, aksiyonlar, ödül şekli, bölüm
    // mantığı) tek; göreve göre değişen dört soru `gorevler.js`te.
    // Varsayılan 'odun' — Milestone 1-4 hiç etkilenmiyor.
    this.gorev = gorevGetir(secenekler.gorev || 'odun')

    // Arama yarıçapı GÖREVE bağlı (bkz. gorevler.js `aramaYaricapi`).
    // Hem hedef seçiminde hem de gözlemin mesafe normalizasyonunda
    // AYNI sayı kullanılmalı, yoksa gözlem ölçeği görevden göreve kayar
    // ve önceden eğitilmiş ağ anlamsız girdi görür.
    this.yaricap = this.gorev.aramaYaricapi ?? config.searchRadius
    this.adim = 0
    this.oncekiOdun = 0
    this.oncekiMesafe = null
    this.hedefKonum = null      // kilitli hedef ağaç
    this.bolumBaslangicOdun = 0 // bölüm başındaki envanter — aşağıya bak
    this.takilmaSayaci = 0      // üst üste kaç adımdır ilerleyemiyoruz
    this.durgunlukSayaci = 0    // üst üste kaç adımdır hiçbir ilerleme yok
    this.yerindeSayma = 0       // kaç adımdır fiilen yer değiştirmiyor
    this.esyaKovalama = 0       // kaç adımdır aynı düşmüş eşyanın peşinde
    this.sonOlcum = null
    this.sonOlcumOdun = 0
    this.kacinmaAdimi = 0       // engelden kaçınma modunda kalan adım
    this.kacinmaYonu = 1        // 1 = sağa, 2 = sola
    this.karaListe = new Set()  // ulaşılamadığı anlaşılan hedefler
    this.yol = []               // uzmanın planladığı yol (ara noktalar)
    this.yolZamani = 0
    this.yolHedefi = null
    this.hedefDenemesi = 0      // mevcut hedefte kaç adımdır ilerleme yok
    this.dikeyDenemesi = 0      // dikey hedefte kaç adımdır kıramıyoruz
    this.oldu = false           // bu bölümde öldü mü

    // ÖLÜM TAKİBİ
    //
    // Minecraft'ta ölünce envanterdeki her şey yere düşüyor. Bunu ele
    // almadığımız için bir bölümde "-451 odun" ve "-452 ödül" gördük:
    // bot 451 kütükle başlamış, uçurumdan düşüp ölmüş, envanteri sıfırlanmış
    // ve biz bunu "451 odun kaybetti" diye ödüle yazmışız.
    //
    // PPO'da böyle bir aykırı değer politikayı tek güncellemede mahvedebilir.
    this.bot.on('death', () => { this.oldu = true })
  }

  // ---------------------------------------------------------------- gözlem

  /**
   * Hedef kütük.
   *
   * İki tuzak vardı ve ikisi de eğitim verisini bozuyordu:
   *
   *  1) `bot.findBlock` mesafeye göre garanti sıralı dönmüyor — bazen 6 blok
   *     ötedeki ağaç dururken 26 blok ötedekini veriyordu. Artık bütün
   *     adayları alıp mesafeyi kendimiz hesaplıyoruz.
   *
   *  2) Hedef her adımda yeniden seçilince, benzer mesafedeki iki ağaç
   *     arasında sürekli gidip geliyordu. Gözlemdeki "ağaç yönü" her adımda
   *     zıplayınca ne uzman ne de ajan tutarlı davranabiliyor. Artık hedef
   *     kilitleniyor: seçilen ağaç yok olana kadar aynı ağaç.
   */
  enYakinKutuk () {
    // Kilitli hedef hâlâ duruyorsa onu kullan
    if (this.hedefKonum) {
      const mevcut = this.bot.blockAt(this.hedefKonum)
      if (this.gorev.hedefMi(mevcut)) return mevcut
      this.hedefKonum = null // kesilmiş, yenisini seç
    }

    const adaylar = this.bot.findBlocks({
      matching: (b) => this.gorev.hedefMi(b),
      maxDistance: this.yaricap,
      count: 128
    })
    if (adaylar.length === 0) return null

    // Yakından uzağa sırala, oyuncunun yapılarını atlayarak ilk DOĞAL ağacı seç
    // Maliyet ölçüsü GÖREVE bağlı: ormanda kuş uçuşu mesafe, madende
    // dikey farkı cezalandıran bir ölçü (ajan yatay hareket ediyor).
    const maliyet = this.gorev.hedefMaliyeti ||
      ((bot, konum) => konum.distanceTo(bot.entity.position))
    adaylar.sort((a, b) => maliyet(this.bot, a) - maliyet(this.bot, b))

    for (const konum of adaylar) {
      const anahtar = `${konum.x},${konum.y},${konum.z}`
      if (this.karaListe.has(anahtar)) continue

      const blok = this.bot.blockAt(konum)
      if (!this.gorev.dogalMi(this.bot, blok)) continue

      // Gövdenin DİBİNİ hedefle, bulduğumuz kütüğü değil.
      //
      // Ormanda 3 boyutlu en yakın kütük çoğu zaman tepedeki bir daldır.
      // Ona kilitlenen bot ulaşamadığı bir noktaya doğru arazide dolanıp
      // duruyordu. Dibi hedefleyince yanına gidip yukarı doğru kırarak
      // çıkabiliyor — insan oyuncunun yaptığı da bu.
      // Odunda gövdenin dibi, madende bloğun kendisi
      const dip = this.gorev.hedefiDuzelt(this.bot, this.bot.blockAt(konum))?.position || konum
      this.hedefKonum = dip
      return this.bot.blockAt(dip)
    }
    return null
  }

  /**
   * Şu anki hedefi bırak ve bir daha seçme.
   *
   * Uzman bazen hedefin ULAŞILAMAZ olduğunu ortamdan önce anlıyor
   * (örneğin tam tepemizdeki bir cevher: aksiyon uzayında yukarı
   * gitmek yok). Böyle bir hedefin etrafında dönüp durmak yerine
   * onu bırakıp başkasına geçmesi gerekiyor.
   */
  hedefiBirak () {
    if (!this.hedefKonum) return false
    const k = this.hedefKonum
    this.karaListe.add(`${k.x},${k.y},${k.z}`)
    this.hedefKonum = null
    this.hedefDenemesi = 0
    return true
  }

  /**
   * Botun ÖNÜNDEKİ kırılabilir kütük.
   *
   * Neden `blockAtCursor` değil: ajanın yukarı-aşağı bakma aksiyonu yok
   * (bkz. docs/architecture.md, aksiyon uzayı). Bakış yatayda sabit olduğu
   * için ışın sadece göz hizasındaki tek bloğu tarıyordu ve gövdenin diğer
   * katlarını hiç göremiyordu — bot ağacın dibine gelip hiçbir şey kıramadan
   * bekliyordu.
   *
   * Çözüm: dikey nişanı otomatik yapıyoruz (zaten ajanın kontrolünde değil),
   * yatay hizalama ajanın işi olarak kalıyor. Yani ajan hâlâ ağaca dönmeyi ve
   * yaklaşmayı öğrenmek zorunda; sadece "başını kaldırmayı" öğrenmesi
   * gerekmiyor.
   */
  onundekiKutuk (menzil = 4.4, koniKosinusu = 0.82) {
    const bot = this.bot
    const goz = bot.entity.position.offset(0, bot.entity.height, 0)
    const bakis = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))

    const adaylar = bot.findBlocks({
      matching: (b) => this.gorev.hedefMi(b), maxDistance: menzil + 1, count: 48
    })

    let enIyi = null
    let enIyiSkor = -Infinity

    for (const konum of adaylar) {
      const merkez = konum.offset(0.5, 0.5, 0.5)
      const fark = merkez.minus(goz)
      const yatay = new Vec3(fark.x, 0, fark.z)
      const uzaklik = yatay.norm()

      // Minecraft'ta menzil GÖZDEN itibaren 3 boyutlu mesafedir. Eskiden
      // sadece yatay mesafeye bakıp dikey farkı 2.5 ile sınırlıyorduk; bu,
      // hemen yanı başındaki gövdenin üst katlarını "erişilemez" sayıyordu.
      // Bot da kıracağı yerde o seviyeye tırmanmanın yolunu arıyordu.
      if (fark.norm() > menzil) continue

      // Tam tepemizdeki bloğa yatay hizalama anlamsız — doğrudan kırılabilir
      if (uzaklik > 0.9) {
        const hiza = yatay.scaled(1 / uzaklik).dot(bakis) // 1 = tam önümde
        if (hiza < koniKosinusu) continue
      }

      const aday = bot.blockAt(konum)
      if (!this.gorev.dogalMi(bot, aday)) continue // oyuncunun yapısını kırma

      // Alttan üste kesmek daha verimli: alçak olana öncelik ver
      const skor = -fark.norm() - Math.max(0, fark.y) * 0.3
      if (skor > enIyiSkor) { enIyiSkor = skor; enIyi = aday }
    }

    return enIyi
  }

  /**
   * Önümde tek bloklu bir basamak var mı?
   *
   * Ayak hizasında katı blok + baş hizasında boşluk = zıplayarak çıkılabilir
   * basamak. İki blok yüksekse zıplamak işe yaramaz, oraya girmiyoruz.
   */
  onumdeBasamakVar () {
    const bot = this.bot
    const bakis = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))
    const p = bot.entity.position

    const ayakHizasi = bot.blockAt(p.offset(bakis.x * 0.8, 0.1, bakis.z * 0.8))
    const basHizasi = bot.blockAt(p.offset(bakis.x * 0.8, 1.2, bakis.z * 0.8))
    const ustu = bot.blockAt(p.offset(bakis.x * 0.8, 2.2, bakis.z * 0.8))

    if (!ayakHizasi || ayakHizasi.boundingBox !== 'block') return false
    if (basHizasi && basHizasi.boundingBox === 'block') return false // 2 blok, zıplanmaz
    if (ustu && ustu.boundingBox === 'block') return false           // tavan var

    return true
  }

  /**
   * Önümü kapatan HERHANGİ bir katı blok var mı? (kırılabilir olmasa da)
   *
   * `onumuKapatan` sadece kırılabilir yumuşak blokları (yaprak vb.) sayıyor,
   * çünkü "kır" aksiyonu onları hedefliyor. Ama toprak duvara toslamak da
   * ilerlemeyi engelliyor ve ajanın bunu GÖREBİLMESİ lazım — göremezse
   * duvara toslamayı bırakmayı öğrenemez.
   *
   * Zıplanabilir tek bloklu basamak engel sayılmaz, oradan geçebiliyoruz.
   */
  /**
   * Botun önündeki noktaları örnekler — SADECE ORTA ÇİZGİ DEĞİL.
   *
   * Hem engel sensörü hem "önümü kapatan blok" tek bir noktaya bakıyordu:
   * tam ileri, tam ortadan. Ama oyuncu kutusu 0.6 blok geniş. Tam ortası
   * boş olsa bile ÇAPRAZDAKİ bir blok yürümeyi engelliyor.
   *
   * Sonucu oyunda gördük: ajanın önünde sol ve sağ çaprazda yaprak var,
   * ortası boş. Sensör "önüm açık" diyor, ajan ileri basıyor, oyun onu
   * geçirmiyor. Zıplıyor, yine geçemiyor. Kırmayı da denemiyor çünkü
   * "önümü kapatan blok" da aynı kör noktadan bakıyor.
   *
   * Üç nokta örnekliyoruz: sol kenar, orta, sağ kenar.
   */
  onumdekiNoktalar (menzil, yukseklikler) {
    const yaw = this.bot.entity.yaw
    const ileri = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const yan = new Vec3(-Math.cos(yaw), 0, Math.sin(yaw)) // ileriye dik
    const p = this.bot.entity.position

    const noktalar = []
    for (const yukseklik of yukseklikler) {
      for (const kayma of [-0.35, 0, 0.35]) {
        noktalar.push(p.offset(
          ileri.x * menzil + yan.x * kayma,
          yukseklik,
          ileri.z * menzil + yan.z * kayma
        ))
      }
    }
    return noktalar
  }

  onumdeEngelVar () {
    if (this.onumdeBasamakVar()) return false

    for (const nokta of this.onumdekiNoktalar(0.8, [0.1, 1.2])) {
      const blok = this.bot.blockAt(nokta)
      if (blok && blok.boundingBox === 'block') return true
    }
    return false
  }

  /** Verilen kütükten aşağı inerek gövdenin en alt kütüğünü bulur */
  govdeninDibi (konum) {
    let en_alt = konum
    for (let i = 0; i < 24; i++) {
      const alt = en_alt.offset(0, -1, 0)
      if (!this.gorev.hedefMi(this.bot.blockAt(alt))) break
      en_alt = alt
    }
    return en_alt
  }

  /**
   * Verilen yaw yönünde engel var mı?
   *
   * Ajanın SOLUNU ve SAĞINI görebilmesi kritik. Uzman tıkandığında bir yöne
   * dönmek zorunda; o yönü rastgele seçersek karar hiçbir gözlemden
   * öğrenilemez hale gelir. "Sağım kapalı olduğu için sola döndüm" ise
   * gözlemden anlaşılır bir karardır.
   *
   * Taklitle öğrenmenin temel kuralı: uzman, öğrencinin göremediği bilgiye
   * dayanmamalı. Bu yordamlar o kuralı sağlamak için var.
   */
  yondeEngelVar (yawFarki) {
    const bot = this.bot
    const yaw = bot.entity.yaw + yawFarki
    const bakis = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const p = bot.entity.position

    // Ayak hizası dolu ama baş hizası boşsa: zıplanabilir basamak, engel değil
    const ayak = bot.blockAt(p.offset(bakis.x * 0.8, 0.1, bakis.z * 0.8))
    const bas = bot.blockAt(p.offset(bakis.x * 0.8, 1.2, bakis.z * 0.8))

    if (bas && bas.boundingBox === 'block') return true
    if (ayak && ayak.boundingBox === 'block') {
      const ust = bot.blockAt(p.offset(bakis.x * 0.8, 2.2, bakis.z * 0.8))
      if (ust && ust.boundingBox === 'block') return true // zıplanamaz
      return false // tek bloklu basamak, geçilebilir
    }
    return false
  }

  solumKapali () { return this.yondeEngelVar(Math.PI / 2) }
  sagimKapali () { return this.yondeEngelVar(-Math.PI / 2) }

  /** Yerdeki en yakın eşya (kırılan kütükten düşen odun) */
  yakinEsya (yaricap = 8) {
    let enIyi = null
    let enIyiMesafe = Infinity
    for (const e of Object.values(this.bot.entities)) {
      if (e.name !== 'item') continue
      const m = e.position.distanceTo(this.bot.entity.position)
      if (m < yaricap && m < enIyiMesafe) { enIyiMesafe = m; enIyi = e }
    }
    return enIyi
  }

  /**
   * Yolumu kapatan, kırılabilir blok.
   *
   * Ajan ağaca yürürken yaprak duvarına çarpıp orada kalıyordu: elinde
   * "kütüğü kır" vardı ama "önümü açan şeyi kır" yoktu. Gerçek oyuncu da
   * bu durumda yaprağı kırıp geçer.
   *
   * Göz hizasına ve ayak hizasına bakıyoruz — ikisinden biri doluysa
   * ileri gidemiyoruz demektir.
   */
  onumuKapatan (menzil = 1.6) {
    // DIKKAT: burada "her kirilabilir blok" demek buyuk hataydi — bot bir
    // magaraya dusunce elleriyle TAS kazmaya calisiyordu. Elle tas kazmak
    // dakikalar surer ve gorevle hicbir ilgisi yok.
    // Sadece agacin etrafindaki yumusak bitki bloklarini engel sayiyoruz.
    const bot = this.bot

    const kirilabilir = (blok) => {
      if (!blok || blok.name === 'air') return false
      if (blok.boundingBox !== 'block') return false // su, çimen vs. engel değil
      // Neyi kırabileceğimiz GÖREVE bağlı: odunda sadece yaprak vb.,
      // madende taşın kendisi. Karar gorevler.js'te.
      if (!this.gorev.engelKirilabilirMi(bot, blok)) return false
      return bot.canDigBlock(blok)
    }

    // Önümüz: üç nokta genişliğinde, ayak ve baş hizası, İKİ MESAFEDE.
    //
    // Tek mesafeye bakmak yetmiyordu: varsayılan 1.6 blok, komşu bloğun
    // ötesine düşüyor ve hemen önümüzdeki yaprağı ıskalıyordu. Engel
    // sensörü 0.8'e bakıyor, kırma 1.6'ya — ikisi farklı yerlere bakınca
    // ajan "önüm kapalı" görüp kırmaya çalışıyor ama kıracak bir şey
    // bulamıyordu.
    for (const uzaklik of [0.8, menzil]) {
      for (const nokta of this.onumdekiNoktalar(uzaklik, [0.1, 1.1])) {
        const blok = bot.blockAt(nokta)
        if (kirilabilir(blok)) return blok
      }
    }

    // BAŞIMIZIN ÜSTÜ.
    //
    // Ajanın tek çıkış yolu bazen zıplamak oluyor ama kafasının üstünde
    // yaprak varsa zıplayamıyor. Oyunda tam olarak bu görüldü: bot
    // zıplayıp zıplayıp yerinde sayıyordu. Yukarısı da engeldir.
    const ustu = bot.blockAt(bot.entity.position.offset(0, 2.1, 0))
    if (kirilabilir(ustu)) return ustu

    return null
  }

  gozlem () {
    const bot = this.bot
    const p = bot.entity.position
    const kutuk = this.enYakinKutuk()

    let dx = 0; let dy = 0; let dz = 0; let mesafe = 1
    if (kutuk) {
      const fark = kutuk.position.minus(p)
      mesafe = Math.max(fark.norm(), 0.001)
      dx = fark.x / mesafe
      dy = fark.y / mesafe
      dz = fark.z / mesafe
      mesafe = Math.min(mesafe / this.yaricap, 1)
    }

    const baktigi = this.onundekiKutuk()

    return [
      dx, dy, dz,
      mesafe,
      bot.entity.yaw / Math.PI,
      bot.entity.pitch / Math.PI,
      Math.min(this.bolumOdunu() / this.gorev.hedefAdet, 1),
      (bot.health ?? 20) / 20,
      (bot.food ?? 20) / 20,
      this.gorev.hedefMi(baktigi) ? 1 : 0,
      bot.entity.onGround ? 1 : 0,
      this.adim / MAX_ADIM,
      this.onumdeEngelVar() ? 1 : 0, // önüm kapalı mı
      this.solumKapali() ? 1 : 0,    // solum kapalı mı
      this.sagimKapali() ? 1 : 0,    // sağım kapalı mı
      this.onumdeBasamakVar() ? 1 : 0 // önümde zıplanabilir basamak var mı
    ]
  }

  /**
   * BU BÖLÜMDE toplanan odun.
   *
   * Envanterin toplamı değil — envanter bölümler arasında sıfırlanmıyor.
   * Mutlak sayıya bakarken ilk bölümde 5 odun toplandıktan sonra her yeni
   * bölüm "zaten hedefe ulaşılmış" diye tek adımda bitiyordu ve eğitim
   * verisinin neredeyse tamamı kayboluyordu.
   */
  bolumOdunu () {
    return this.gorev.say(this.bot) - this.bolumBaslangicOdun
  }

  /** Ham mesafe (normalize edilmemiş) — ödül hesabı için */
  hamMesafe () {
    const kutuk = this.enYakinKutuk()
    if (!kutuk) return null
    return kutuk.position.distanceTo(this.bot.entity.position)
  }

  // ---------------------------------------------------------------- aksiyon

  async aksiyonUygula (action) {
    const bot = this.bot
    const oncekiKonum = bot.entity.position.clone()
    let kirilanKutuk = 0

    switch (action) {
      case 0: { // ileri yürü
        // Tek bloklu basamaklarda takılmasın diye zıplama desteği.
        //
        // Eskiden bu "yürü, 250ms sonra ilerledim mi diye bak, ilerlemediysen
        // zıpla" şeklindeydi — zamanlamaya dayalı olduğu için güvenilmezdi:
        // bot ilk yarıda biraz ilerleyip ikinci yarıda takılırsa kontrol hiç
        // tetiklenmiyor, bot duvara sürtüp yan yan kayıyordu.
        //
        // Artık tahmin etmek yerine ÖNCEDEN bakıyoruz: önümdeki blok katı ve
        // üstü boşsa bu bir basamaktır, zıplamayı baştan basılı tutuyoruz.
        // Bu bir makro değil, oyunun fiziği — Bedrock sürümünde "auto jump"
        // diye bir ayar olarak zaten var.
        const basamakVar = this.onumdeBasamakVar()

        bot.setControlState('forward', true)
        if (basamakVar) bot.setControlState('jump', true)
        await this.bekle(280)

        // Yine de takıldıysak (öngöremediğimiz bir engel) bir kez daha zıpla
        if (!basamakVar && bot.entity.onGround &&
            bot.entity.position.xzDistanceTo(oncekiKonum) < 0.08) {
          bot.setControlState('jump', true)
        }
        await this.bekle(280)

        bot.setControlState('jump', false)
        bot.setControlState('forward', false)
        break
      }

      case 1: // sağa dön (22.5°)
        await bot.look(bot.entity.yaw - DONUS_ACISI, 0, true)
        break

      case 2: // sola dön (22.5°)
        await bot.look(bot.entity.yaw + DONUS_ACISI, 0, true)
        break

      case 3: { // önündeki bloğu kır (kütük yoksa yolu kapatan blok)
        const hedef = this.onundekiKutuk() || this.onumuKapatan()
        if (hedef && bot.canDigBlock(hedef)) {
          const kutuktu = this.gorev.hedefMi(hedef)
          try {
            // Uygun alet varsa eline al — elle kesmek ~8 kat yavas
            await aletKusan(bot, hedef)
            // Dikey nişan otomatik; sonra bakışı tekrar yatayda sabitliyoruz
            await bot.lookAt(hedef.position.offset(0.5, 0.5, 0.5), true)
            await bot.dig(hedef)
            if (kutuktu) kirilanKutuk = 1 // ödül sadece kütük için
          } catch (err) { /* kıramadıysa zaman cezası zaten var */ }
          await bot.look(bot.entity.yaw, 0, true)
        }
        break
      }

      case 4: // bekle
      default:
        await this.bekle(200)
        break
    }

    return kirilanKutuk
  }

  // ---------------------------------------------------------------- döngü

  async reset () {
    this.adim = 0
    this.hedefKonum = null
    this.takilmaSayaci = 0
    this.durgunlukSayaci = 0
    this.yerindeSayma = 0
    this.esyaKovalama = 0
    this.sonOlcum = null
    this.sonOlcumOdun = 0
    this.kacinmaAdimi = 0
    this.karaListe.clear()
    this.hedefDenemesi = 0
    this.dikeyDenemesi = 0
    this.yol = []
    this.yolZamani = 0
    this.yolHedefi = null
    this.oldu = false
    pathfinderDurdur(this.bot)
    this.bot.clearControlStates()

    // Ajanin yukari-asagi bakma aksiyonu yok. Bakisi yatayda sabitliyoruz ki
    // "kir" aksiyonu her zaman goz hizasindaki blogu hedeflesin.
    await this.bot.look(this.bot.entity.yaw, 0, true)

    // Bolumu RASTGELE bir yone bakarak basla.
    //
    // Neden: uzman her bolume agaca donuk basliyordu, dolayisiyla demo
    // verisinin nerdeyse tamami "kir" aksiyonundan olusuyordu ve "sola don"
    // hic gorunmuyordu. Boyle bir veriyle egitilen ag sadece kirmayi
    // ogreniyor, onunde agac olmayinca ne yapacagini bilemiyor.
    // Rastgele baslangic yonu, demolarda donme ve yurume ornekleri olusturur.
    await this.bot.look(Math.random() * 2 * Math.PI - Math.PI, 0, true)

    // BÖLÜM ORTAMINI GÖREVE GÖRE HAZIRLA.
    //
    // Odun ve maden görevlerinin kurulumu birbirinin TERSİ: biri yüzeye
    // çıkmak ister, diğeri yeraltına inmek. Ortak olan tek şey, bölüm
    // başlamadan önce ortamda toplanacak bir şey OLDUĞUNDAN emin olmak.
    // SUDAN ÇIKMAK GÖREVDEN BAĞIMSIZ.
    //
    // Bunu yüzey kurulumunun içine koymuştum ve maden görevinde bot
    // boğularak öldü: yeraltında su cebine girmek çok olağan, ama
    // kurtarma sadece odun görevinde çalışıyordu. Ajanın aksiyon
    // uzayında yüzme yok — hangi görevde olursa olsun boğulmaktan
    // ortam sorumlu.
    await this.sudanCik()

    // ENVANTERİ ÖNCE TEMİZLE, SONRA KURULUM.
    //
    // Sıra kritik: kurulum ajana kazma veriyor. Temizliği sonra yapsaydık
    // az önce verdiğimiz kazmayı silerdik. Bir kez tersini yazdım ve
    // envanter bölümden bölüme dolarak `/give`i işlevsiz bıraktı.
    if (this.gorev.temizlemeEtiketi === '*') {
      this.bot.chat(`/clear ${this.bot.username}`)
      await this.bekle(300)
    } else if (this.gorev.temizlemeEtiketi) {
      this.bot.chat(`/clear ${this.bot.username} ${this.gorev.temizlemeEtiketi}`)
    }

    if (this.gorev.yuzeyGorevi) {
      await this.yuzeyKurulumu()
    } else {
      await this.yeraltiKurulumu()
    }

    // HEDEFSİZ BÖLÜMLERİ SESSİZ GEÇME.
    //
    // Bot boğulup öldükten sonra ağaçsız bir yere doğdu ve 50'den fazla
    // bölüm üst üste "0 kaynak, 60 adım, -0.60 ödül" ile bitti. Rakamlar
    // akıp gidiyordu ama hiçbir şey "burada öğrenilecek bir şey yok"
    // demiyordu. PPO o gürültüden öğrenmeye çalıştı.
    //
    // Ölçebildiğimiz bir arıza sessiz kalmamalı.
    if (!this.enYakinKutuk()) {
      this.hedefsizBolum = (this.hedefsizBolum || 0) + 1
      if (this.hedefsizBolum >= 3) {
        const p = this.bot.entity.position
        log.hata(
          `${this.hedefsizBolum} bölümdür ${this.gorev.ad} bulamıyorum! ` +
          `Konum: x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} z=${p.z.toFixed(0)}. ` +
          'Bu bölümler eğitime ZARAR veriyor — eğitimi durdurup botu ' +
          'uygun bir yere ışınla (/tp MinecrAI <x> <y> <z>).'
        )
      }
    } else {
      this.hedefsizBolum = 0
    }

    // Bolum baslangicini agaca makul bir mesafeye tasi.
    //
    // Bu pathfinder cagrisi ajanin AKSIYONU DEGIL, bolum kurulumu. Ayrimi
    // korumak onemli: ajan hala yurumeyi ve donmeyi kendi ogreniyor, biz
    // sadece her bolume benzer bir baslangic dagilimindan basliyoruz.
    // Aksi halde agaclar kesildikce bot ormanin ortasinda kalip bos
    // bolumler uretiyor ve egitim verisi bozuluyor.
    // Bölüm başında hedefe yaklaştırma — sadece bunun görevi çözmediği
    // görevlerde. Madende pathfinder tüneli ajan adına kazardı.
    if (this.gorev.baslangictaYurut !== false) await this.baslangicaTasi()
    // ENVANTERİ BOŞALT.
    //
    // Bölümler arasında odun birikiyor ve envanter (36 slot × 64) eninde
    // sonunda doluyor. Dolduğunda kırılan kütükler envantere GİRMİYOR:
    // "odun = 0" ama ödül hâlâ pozitif çıkıyor, çünkü ödülün içinde
    // 0.2×kırılan-kütük terimi var. Ölçtük: ~110. bölümden sonra bütün
    // bölümler 0 odunla ve 500 adımda bitiyordu.
    //
    // Sonuç: hedefe (5 odun) asla ulaşılamıyor, bölümler hiç bitmiyor ve
    // ödülün asıl kaynağı kalıcı olarak sıfırlanıyor. PPO bozuk bir
    // dünyadan öğreniyor.
    //
    // `#minecraft:logs` etiketi bütün kütük türlerini kapsıyor; balta ve
    // diğer aletler envanterde kalıyor.
    // Görev hangi kaynağı topluyorsa onu temizliyoruz. Madencilikte
    // etiket yok (cevherler tek bir etikette toplanmıyor), o yüzden
    // temizleme atlanıyor ve envanter sayacı bölüm başında sıfırlanıyor.

    // YERDEKİ EŞYALARI DA TEMİZLE.
    //
    // Envanteri temizleyip yeri bırakmak yetmiyor: her bölüm bir öncekinin
    // çöpünün üstüne biniyor. İlerleyen bölümlerde ajan eski yığınların
    // üstünden geçip bedava ödül topluyor — kendi becerisiyle alakasız.
    //
    // Ajan bundan yanlış şeyi öğreniyor ("yürürsem odun geliyor"), ölçümler
    // de şişiyor: değerlendirmede rastgele ajan bu yüzden 4.6 odun
    // "toplamıştı".
    //
    // Her bölüm aynı temiz koşullardan başlasın.
    this.bot.chat(`/kill @e[type=item,distance=..${TEMIZLIK_YARICAPI}]`)
    await this.bekle(500)

    const kalanOdun = this.gorev.say(this.bot)
    if (kalanOdun > 0) {
      // Bot op değilse /clear çalışmaz — sessizce bozulmaktansa uyar
      log.uyari(
        `Envanter temizlenemedi (${kalanOdun} kütük kaldı). ` +
        `Bot op mu? Sunucu konsoluna: op ${this.bot.username}`
      )
    }

    this.oncekiOdun = kalanOdun
    this.bolumBaslangicOdun = this.oncekiOdun
    this.oncekiMesafe = this.hamMesafe()

    return { obs: this.gozlem(), info: { odun: 0, adim: 0 } }
  }

  /**
   * Bölüm kurulumu: bot yer altındaysa yüzeye çıkar.
   *
   * Ajan ileri yürürken bir çukura/mağaraya düşebiliyor. Elindeki 5 aksiyonla
   * oradan çıkması pratikte imkânsız, bölüm de boşa gidiyor. Bu bir ajan
   * aksiyonu değil, bölüm kurulumu — tıpkı başlangıç konumunu ayarlamak gibi.
   */
  /**
   * Başımın üstü gökyüzü mü?
   *
   * Eski kontrol sadece 5 blok yukarı bakıyordu ve BÜYÜK bir mağarada
   * yanılıyordu: tavan 20 blok yukarıdaysa "üstüm açık" diyordu, oysa
   * bot yerin 40 blok altındaydı. Bot madene düşüp çıkamadığında olan
   * buydu — kurtarma hiç tetiklenmedi çünkü ortam sıkışmış olduğunu
   * fark etmedi.
   *
   * Doğru soru "yakınımda tavan var mı" değil, "yukarısı SONUNA KADAR
   * açık mı". Gökyüzünü görüyorsam yüzeydeyim.
   */
  acikHavadaMi (tavan = 200) {
    const p = this.bot.entity.position.floored()
    for (let y = p.y + 2; y < tavan; y++) {
      const b = this.bot.blockAt(new Vec3(p.x, y, p.z))
      if (b && b.boundingBox === 'block') return false
    }
    return true
  }

  async yuzeyeCik (zamanAsimi = 20000) {
    const bot = this.bot
    const p = bot.entity.position.floored()

    if (this.acikHavadaMi()) return false

    // Yukarı doğru ilk "ayak basılacak zemin + üstünde iki blok hava" noktası
    for (let y = p.y + 2; y < p.y + 48; y++) {
      const alt = bot.blockAt(new Vec3(p.x, y - 1, p.z))
      const orta = bot.blockAt(new Vec3(p.x, y, p.z))
      const ust = bot.blockAt(new Vec3(p.x, y + 1, p.z))
      if (!alt || !orta || !ust) continue
      if (alt.boundingBox !== 'block') continue
      if (orta.name !== 'air' || ust.name !== 'air') continue

      try {
        pathfinderHazirla(bot)
        await Promise.race([
          bot.pathfinder.goto(new goals.GoalBlock(p.x, y, p.z)),
          new Promise((_, red) => setTimeout(() => red(new Error('zaman_asimi')), zamanAsimi))
        ])
        return true
      } catch (err) {
        pathfinderDurdur(bot)
        return false
      }
    }
    return false
  }

  /**
   * Yakında ağaç kalmadıysa taze bir bölgeye ışınlan.
   *
   * NEDEN GEREKLİ: ajan öğrendiği ormanı kesiyor. Eğitim ilerledikçe ağaçlar
   * bitiyor, bot daha uzağa yürümek zorunda kalıyor, bölümler uzuyor ve ödül
   * düşüyor. Ölçtük: ilk bölümler 30-120 adım, 50. bölümden sonra 280-320.
   *
   * Bu, RL'in temel varsayımını ihliyor — algoritma ortamın SABİT kaldığını
   * varsayar. Ortam kendiliğinden zorlaşırken öğrenme eğrisi ölçülemez hale
   * geliyor: düz bir çizgi bile aslında iyileşme olabilir ama ayırt edemeyiz.
   *
   * `/spreadplayers` kullanıyoruz: rastgele bir noktaya, KATI ZEMİN ÜSTÜNE
   * güvenle yerleştiriyor. Bot op olduğu için komutu çalıştırabiliyor.
   *
   * Bu bir ajan aksiyonu değil, bölüm kurulumu — tıpkı başlangıç konumunu
   * ayarlamak gibi.
   */
  async tazeAlanaIsinla (deneme = 4) {
    const bot = this.bot

    for (let i = 0; i < deneme; i++) {
      const p = bot.entity.position
      // Merkezden uzaklaş ki hep aynı bölgeyi tüketmeyelim
      const menzil = 120 + i * 80

      bot.chat(`/spreadplayers ${Math.round(p.x)} ${Math.round(p.z)} 40 ${menzil} false ${bot.username}`)

      // Işınlanma + chunk yüklenmesi
      await this.bekle(2500)
      this.hedefKonum = null
      this.karaListe.clear()

      if (this.enYakinKutuk()) return true
      await this.bekle(1500) // chunk'lar geç geldiyse bir şans daha
      if (this.enYakinKutuk()) return true
    }
    return false
  }

  /** Ayak veya göz hizasında su var mı? */
  suyunIcindeMi () {
    const p = this.bot.entity.position
    for (const dy of [0, 1]) {
      const b = this.bot.blockAt(p.offset(0, dy, 0))
      if (b && /water|bubble_column/.test(b.name)) return true
    }
    return false
  }

  /**
   * Sudan çık.
   *
   * Ajanın aksiyon uzayında yüzme yok — ileri, sağa, sola, kır, bekle.
   * Suya düşerse boğulmaktan başka yapabileceği bir şey yok ve gerçekten
   * boğuldu: eğitim kaydında ölümden sonra 50'den fazla bölüm üst üste
   * "0 odun, 60 adım, -0.60 ödül" ile bitti. Ajanın öğrenemeyeceği bir
   * durumda ceza yemesi öğrenme değil gürültüdür — ORTAM düzeltmeli.
   */
  async sudanCik () {
    if (!this.suyunIcindeMi()) return false

    log.uyari('Sudayım — çıkmaya çalışıyorum.')
    this.bot.setControlState('jump', true) // suda zıplamak = yüzerek yükselmek
    const bitis = Date.now() + 6000
    while (Date.now() < bitis && this.suyunIcindeMi()) {
      await this.bekle(300)
    }
    this.bot.setControlState('jump', false)

    // Hâlâ sudaysak karaya ışınlanmak tek çare
    if (this.suyunIcindeMi()) {
      await this.tazeAlanaIsinla()
      return true
    }
    return true
  }

  /**
   * Yüzey görevi kurulumu (odun): suya/mağaraya düştüyse çıkar,
   * etrafta ağaç kalmadıysa taze bir bölgeye ışınla.
   */
  async yuzeyKurulumu () {
    await this.yuzeyeCik()

    // Ajanın aksiyon uzayında "yüzeye tırman" diye bir şey yok;
    // mağarada kalmak ORTAMIN sorunu.
    if (!this.acikHavadaMi()) {
      log.uyari('Yeraltındayım — yüzeye ışınlanıyorum.')
      await this.tazeAlanaIsinla()
    }

    // Ajan öğrendiği ormanı kesiyor; ortam sabit kalmazsa öğrenme eğrisi
    // ölçülemez hale geliyor.
    if (!this.enYakinKutuk()) await this.tazeAlanaIsinla()
  }

  /**
   * Taze bir maden bölgesine ışınlan.
   *
   * PROBLEM: 40 bölümlük demo toplamada ilk 18 bölüm iyi sonuç verdi
   * (8, 6, 22, 12 cevher), sonra 19-35 arası neredeyse tamamen sıfır.
   * Bot bulunduğu bölgenin cevherini bitirmişti. Odun görevinde bunu
   * `/spreadplayers` ile çözmüştük ama o komut oyuncuyu YÜZEYE koyuyor —
   * madende işe yaramaz, her seferinde baştan inmek gerekirdi.
   *
   * ÇÖZÜM: aynı derinlikte, uzak bir XZ noktasına ışınlan. Ama oraya
   * körlemesine ışınlanmak botu taşın içinde bırakır ve boğulur; önce
   * `/fill` ile 1x2'lik bir cep açıp altına zemin koyuyoruz. İkisi de
   * op komutu — bot zaten op olmak zorunda (kazmayı da öyle veriyoruz).
   */
  async tazeMadeneIsinla (deneme = 4) {
    const bot = this.bot

    // IŞINLANDIKTAN SONRA DOĞRULA.
    //
    // Arama yarıçapını 16'ya indirince (bkz. gorevler.js) rastgele bir
    // noktanın yakınında hiç cevher OLMAMASI mümkün hale geldi. Odun
    // görevindeki `tazeAlanaIsinla` bunu zaten deneme döngüsüyle
    // çözüyor; maden tarafı tek atışlıktı ve hedefsiz bölüm üretiyordu.
    // Hedefsiz bölüm PPO için saf gürültü.
    for (let i = 0; i < deneme; i++) {
      const p = bot.entity.position
      const y = Math.floor(p.y)

      // 60-140 blok ötede rastgele bir yön
      const aci = Math.random() * 2 * Math.PI
      const uzaklik = 60 + Math.random() * 80
      const x = Math.round(p.x + Math.cos(aci) * uzaklik)
      const z = Math.round(p.z + Math.sin(aci) * uzaklik)

      // Önce cebi aç, SONRA ışınlan — sırası önemli, tersi boğulma demek
      bot.chat(`/fill ${x} ${y} ${z} ${x} ${y + 1} ${z} air`)
      bot.chat(`/setblock ${x} ${y - 1} ${z} stone keep`)
      await this.bekle(300)
      bot.chat(`/tp ${bot.username} ${x + 0.5} ${y} ${z + 0.5}`)
      await this.bekle(600)

      this.hedefKonum = null
      this.karaListe.clear()

      if (this.enYakinKutuk()) {
        log.bilgi(`Taze maden bölgesi: x=${x} y=${y} z=${z}`)
        return true
      }
      await this.bekle(900) // chunk geç geldiyse bir şans daha
      this.hedefKonum = null
      if (this.enYakinKutuk()) {
        log.bilgi(`Taze maden bölgesi: x=${x} y=${y} z=${z}`)
        return true
      }
    }
    log.uyari(`${deneme} denemede ${this.yaricap} blok içinde cevher bulamadım.`)
    return false
  }

  /**
   * Yeraltı görevi kurulumu (maden).
   *
   * İNİŞİ AJANA ÖĞRETMİYORUZ ve bu bilinçli bir karar: y=64'ten cevher
   * seviyesine inmek binlerce adım, bir bölüm ise 500 adım. Ajan hiçbir
   * zaman ödüle ulaşamaz, dolayısıyla hiçbir şey öğrenemez.
   *
   * Görev şu şekilde SINIRLANDIRILDI: "cevher seviyesindesin, kazman
   * elinde — 500 adımda 5 cevher topla". Bu, ağaç göreviyle aynı
   * büyüklükte ve aynı PPO koduyla eğitilebilir. İniş, tıpkı odun
   * görevindeki `baslangicaTasi` gibi, bölüm KURULUMUNUN işi.
   */
  async yeraltiKurulumu () {
    const bot = this.bot

    // 1) Kazma olmadan cevher kırmak onu YOK EDER — önce aleti garantile
    if (this.gorev.aletVer) {
      const { uygunAlet } = require('../skills/alet')
      if (!uygunAlet(bot, { name: 'iron_ore' })) {
        bot.chat(`/give ${bot.username} ${this.gorev.aletVer} 1`)
        await this.bekle(600)

        // VERDİĞİMİZİ DOĞRULA.
        //
        // `/give` op yetkisi ister ve sessizce başarısız olur. Kazmasız
        // bir bot cevheri kırıyor ama HİÇBİR ŞEY DÜŞMÜYOR — ölçümde
        // tam olarak bunu gördük: %63 "önümde cevher var", 0 kaynak.
        // Sessiz başarısızlık en pahalı hata türü.
        if (!uygunAlet(bot, { name: 'iron_ore' })) {
          // Sunucu log'u `/give`in BAŞARILI olduğunu gösteriyordu; eşya
          // envantere giremiyordu çünkü 36 slot doluydu. "Op değilsin"
          // demek yanlış teşhisti ve beni saatlerce yanlış yere baktırdı.
          const dolu = bot.inventory.items().length
          log.hata(
            `${this.gorev.aletVer} envantere giremedi (${dolu} slot dolu). ` +
            'Envanter dolu olabilir ya da bot op değildir — sunucu ' +
            'konsolunda /give çıktısına bak.'
          )
        }
      }
    }

    // 2) DERİNLİĞE GÖRE İN, "cevher görüyor muyum"a göre DEĞİL.
    //
    // Burada bir kez "zaten cevher görüyorsam inmeye gerek yok" yazdım ve
    // görev hiç çalışmadı. Sebep: yüzeyde de cevher görünüyor — uçurum
    // yüzündeki bir kömür damarı, mağara ağzındaki demir. Bot 30 blok
    // ötedeki ulaşılamaz bir cevhere kilitlenip yüzeyde dönüp duruyordu.
    //
    // Ölçüm bunu söylüyordu: %63 "cevhere dönüyorum", %10 yürüme ve
    // HİÇ kırma yok. Yerin altında olsaydı önü taş olurdu ve kırardı.
    //
    // Görev "cevher seviyesinde başla" diyor; ölçüt derinlik.
    const hedefY = this.gorev.baslangicY ?? 15
    if (Math.floor(bot.entity.position.y) > hedefY + 6) {
      // İNİŞİ BÖLÜMLERE YAY.
      //
      // y=70'ten y=15'e inmek ~55 basamak, her basamak 3 blok kırmak:
      // dakikalar sürüyor. İlk denemede Python soketi zaman aşımına
      // uğrayıp eğitimi düşürdü. Reset dakikalarca bloke olmamalı.
      //
      // Çözüm: her reset en fazla 12 basamak insin. Bot yeraltında
      // kaldığı için birkaç bölüm sonra hedefe varıyor ve o noktadan
      // sonra iniş hiç çalışmıyor. Toplam süre aynı, ama tek bir
      // çağrıda kilitlenmiyor.
      log.bilgi(`Maden görevi: y=${hedefY} hedefi, şu an y=${Math.floor(bot.entity.position.y)}`)
      const { seviyeyeIn } = require('../skills/kaz')
      const sahteKontrol = { kontrolEt () {}, bekle: (ms) => this.bekle(ms) }
      try {
        await seviyeyeIn(bot, hedefY, sahteKontrol, { seviye: 'stone', maksBasamak: 12 })
      } catch (err) {
        log.uyari(`İniş yarıda kaldı: ${err.message}`)
      }
      return
    }

    // 4) Derinlikteyiz ama cevher yok: bölge tükenmiş, taze alana geç.
    //    Ajan öğrendiği madeni kazıp bitiriyor; ortam sabit kalmazsa
    //    öğrenme eğrisi ölçülemez hale geliyor — odun görevinde de
    //    aynı sebeple ışınlanma var.
    if (!this.enYakinKutuk()) {
      await this.tazeMadeneIsinla()
    }
  }

  /** Bölüm kurulumu: yakınlarda ağaç varsa makul bir mesafeye yürü */
  async baslangicaTasi (idealMesafe = 10, zamanAsimi = 15000) {
    const hedef = this.enYakinKutuk()
    if (!hedef) return false

    const mesafe = hedef.position.distanceTo(this.bot.entity.position)
    if (mesafe <= idealMesafe + 5) return false

    try {
      pathfinderHazirla(this.bot)
      await Promise.race([
        this.bot.pathfinder.goto(new goals.GoalNear(
          hedef.position.x, hedef.position.y, hedef.position.z, idealMesafe
        )),
        new Promise((_, red) => setTimeout(() => red(new Error('zaman_asimi')), zamanAsimi))
      ])
      return true
    } catch (err) {
      pathfinderDurdur(this.bot)
      return false
    } finally {
      this.hedefKonum = null
      // pathfinder botu hedefe donuk birakiyor — yonu tekrar rastgelelestir
      await this.bot.look(Math.random() * 2 * Math.PI - Math.PI, 0, true)
    }
  }

  /**
   * Suda mıyız? Öyleyse yüzerek yüksel.
   *
   * Ajanın aksiyon uzayında yüzme yok. Suya girerse ne yaparsa yapsın
   * dibe iner ve boğulur — bir kez gerçekten oldu, ardından 50 bölüm
   * boyunca çöp veri üretildi. Bölüm BAŞINDA sudan çıkarıyorduk ama
   * bölüm ORTASINDA suya girerse orada ölüyordu.
   *
   * Zıplama tuşu suda "yüzerek yüksel" demek. Ajan adına basmak aksiyon
   * uzayını genişletmiyor; onun etkileyemediği bir ölümü engelliyor —
   * tıpkı can barını da onun yönetmemesi gibi.
   */
  async suUstundeKal () {
    if (!this.suyunIcindeMi()) return false
    this.bot.setControlState('jump', true)
    await this.bekle(150)
    this.bot.setControlState('jump', false)
    return true
  }

  /**
   * Kazma bölüm ORTASINDA kırılırsa.
   *
   * Demir kazma 250 vuruş; bir bölüm 500 adım ve tünel açmak çok vuruş
   * yiyor. Yani kırılması istisna değil, beklenen durum.
   *
   * Kırıldıktan sonra ajan cevhere vurmaya devam eder ve her vuruş bir
   * cevheri YOK EDER — daha önce tam olarak bunu ölçtük: "%63 önümde
   * cevher var, 0 kaynak". Ajan bunu gözleminden anlayamaz; alet
   * durumu gözlemde yok ve olması da gerekmiyor.
   *
   * Alet tedariki bu görevin konusu değil (elle yazılmış `kaz.js` onu
   * zaten çözüyor). Ajanın öğrendiği şey "cevheri bul ve kır".
   */
  async aletiTazele () {
    if (!this.gorev.aletVer) return
    const { kazmaDurumu } = require('./gorevler')
    if (kazmaDurumu(this.bot).kalan > 0) return

    this.bot.chat(`/give ${this.bot.username} ${this.gorev.aletVer} 1`)
    await this.bekle(300)
    if (kazmaDurumu(this.bot).kalan <= 0) {
      log.hata(
        `Kazma kırıldı ve yenisini veremedim (bot op değil mi?). ` +
        'Bu bölümde kırılan her cevher YOK OLUYOR.'
      )
    }
  }

  async step (action) {
    this.adim++
    await this.suUstundeKal()
    if (action === 3) await this.aletiTazele()
    const oncekiKonum = this.bot.entity.position.clone()

    const kirilanKutuk = await this.aksiyonUygula(action)

    // İlerleyebildik mi? "İleri yürü" dedik ama yerimizden kıpırdamadıysak
    // bir engele toslamışız demektir.
    const ilerleme = this.bot.entity.position.xzDistanceTo(oncekiKonum)
    if (action === 0 && ilerleme < 0.08) this.takilmaSayaci++
    else if (action === 0) this.takilmaSayaci = 0

    // --- ödül hesabı ---
    const odun = this.gorev.say(this.bot)

    // Envanter AZALDIYSA bu toplama değil kayıptır (ölüm, dolu envanter).
    // Ajanın öğrenmesi gereken şey odun toplamak; envanter kaybını ödüle
    // yazmak devasa negatif aykırı değerler üretiyor.
    const yeniOdun = Math.max(0, odun - this.oncekiOdun)

    // Bir şey topladıysak eşya kovalama sayacı sıfırlanır — demek ki
    // kovalamak işe yarıyormuş.
    if (yeniOdun > 0) this.esyaKovalama = 0
    this.oncekiOdun = odun

    const mesafe = this.hamMesafe()
    let yaklasma = 0
    if (mesafe !== null && this.oncekiMesafe !== null) {
      yaklasma = this.oncekiMesafe - mesafe
    }
    this.oncekiMesafe = mesafe

    let reward =
      1.00 * yeniOdun +
      0.20 * kirilanKutuk +
      0.05 * yaklasma -
      0.01

    // Ölüm: sabit ve makul bir ceza. Envanter kaybı kadar değil — ajan
    // uçurumdan kaçınmayı öğrenmeli, travma geçirmemeli.
    if (this.oldu) reward += OLUM_CEZASI

    // Hiçbir ilerleme yoksa (ne odun, ne yaklaşma) sayacı artır.
    // Bölümün 300 adımını duvara toslayarak geçirmek hem veriyi bozuyor hem
    // de PPO eğitiminde saatler yiyor — 2 dakikalık bir bölüm hiçbir şey
    // öğretmeden bitiyor.
    if (yeniOdun <= 0 && kirilanKutuk === 0 && Math.abs(yaklasma) < 0.05) {
      this.durgunlukSayaci++
    } else {
      this.durgunlukSayaci = 0
    }

    // Hedefe yakınız ama bir şey kıramıyorsak o hedef ulaşılamıyordur
    // (tepede, suyun ortasında, uçurumun ardında). Kara listeye alıp
    // başkasına geç — yoksa bölümün tamamını orada geçiriyor.
    if (this.hedefKonum) {
      const yakin = this.hedefKonum.xzDistanceTo(this.bot.entity.position) < 4
      if (yakin && kirilanKutuk === 0 && yeniOdun <= 0) this.hedefDenemesi++
      else this.hedefDenemesi = 0

      if (this.hedefDenemesi >= HEDEF_SABIR) {
        this.karaListe.add(
          `${this.hedefKonum.x},${this.hedefKonum.y},${this.hedefKonum.z}`)
        this.hedefKonum = null
        this.hedefDenemesi = 0
      }
    }

    // DİKEY HEDEFTEN VAZGEÇME — UZMANIN DEĞİL ORTAMIN İŞİ.
    //
    // Hedefin tam altında/üstündeysek (yatay mesafe < 2) ve menzilde
    // kırılacak bir şey yoksa o hedef bize göre değil: aksiyon uzayında
    // yukarı gitmek yok. `HEDEF_SABIR` (20 adım) bunun için çok yavaş —
    // yerinde sayma kesme eşiği 60 adım, yani üç kötü hedef bölümün
    // tamamını yiyor.
    //
    // Bu mantık `expert.js`te vardı ve PPO direksiyona geçince kimse
    // çağırmadı; eğitimde 2-18. bölümlerin hepsi sıfır kaynakla bitti.
    // Ortam kuralı, uzman kuralı değil.
    if (this.gorev.dikeyBirakma && this.hedefKonum) {
      const p = this.bot.entity.position
      const yatay = Math.hypot(
        this.hedefKonum.x + 0.5 - p.x,
        this.hedefKonum.z + 0.5 - p.z
      )
      if (yatay < 2 && !this.onumuKapatan() && kirilanKutuk === 0) {
        this.dikeyDenemesi++
      } else {
        this.dikeyDenemesi = 0
      }
      if (this.dikeyDenemesi >= DIKEY_SABIR) {
        this.hedefiBirak()
        this.dikeyDenemesi = 0
      }
    }

    const bolumOdun = Math.max(0, this.bolumOdunu())

    // YERİNDE SAYMA TESPİTİ.
    //
    // `durgunlukSayaci` "hedefe yaklaşma" değişimine bakıyor ve en ufak
    // kıpırdanmada sıfırlanıyor. Yaprakların içine gömülen ajan sürekli
    // biraz sağa biraz sola oynadığı için sayaç hiç dolmuyordu: eğitim
    // kaydında 455 adımlık, 0 odunlu, -4.53 ödüllü bir bölüm var —
    // bölüm sınırının neredeyse tamamı bir ağacın tepesinde harcandı.
    //
    // Bu ölçüt farklı: 20 adımda bir GERÇEK KONUMU işaretliyoruz. Ajan
    // 60 adımda 2 bloktan az yer değiştirdiyse ve odun da toplamadıysa,
    // ne kadar kıpırdanırsa kıpırdansın ilerlemiyor demektir.
    if (this.adim % 20 === 0) {
      const suan = this.bot.entity.position
      if (this.sonOlcum &&
          suan.distanceTo(this.sonOlcum) < 2 &&
          bolumOdun === this.sonOlcumOdun) {
        this.yerindeSayma += 20
      } else {
        this.yerindeSayma = 0
      }
      this.sonOlcum = suan.clone()
      this.sonOlcumOdun = bolumOdun
    }

    const terminated = bolumOdun >= this.gorev.hedefAdet || this.oldu
    const truncated = this.adim >= MAX_ADIM ||
      this.durgunlukSayaci >= DURGUNLUK_SINIRI ||
      this.yerindeSayma >= 60

    return {
      obs: this.gozlem(),
      reward,
      terminated,
      truncated,
      info: {
        odun: bolumOdun, envanter: odun, adim: this.adim, yeniOdun, kirilanKutuk,
        takildi: this.takilmaSayaci, durgun: this.durgunlukSayaci, oldu: this.oldu
      }
    }
  }

  /**
   * Tanı bilgisi: uzman neden o kararı verdi, ortamda ne var?
   *
   * "Uzman hiçbir şey yapmıyor" gözlemiyle karşılaşınca sebebini bilmeden
   * tahmin yürütmek zorunda kaldık. Bu yordam ortamın uzmana nasıl
   * göründüğünü tek bakışta veriyor.
   */
  taniBilgisi () {
    const hedef = this.enYakinKutuk()
    const esya = this.yakinEsya()
    const p = this.bot.entity.position

    return {
      konum: [Math.round(p.x), Math.round(p.y), Math.round(p.z)],
      hedefVar: !!hedef,
      hedefMesafe: hedef ? +hedef.position.distanceTo(p).toFixed(1) : null,
      menzildeKutuk: !!this.onundekiKutuk(),
      yerdeEsya: !!esya,
      esyaMesafe: esya ? +esya.position.distanceTo(p).toFixed(1) : null,
      onumKapali: this.onumdeEngelVar(),
      karaListe: this.karaListe.size,
      envanterOdun: this.gorev.say(this.bot)
    }
  }

  /** Uzman politikanin bu durumda sececeği aksiyon (Milestone 3) */
  uzmanAksiyonu () {
    const { uzmanAksiyonu } = require('./expert')
    return uzmanAksiyonu(this.bot, this)
  }

  // ---------------------------------------------------------------- yardımcı

  bekle (ms) {
    return new Promise((r) => setTimeout(r, ms * this.zamanCarpani))
  }

  zamanAsimiyla (soz, ms) {
    return Promise.race([
      soz,
      new Promise((_, red) => setTimeout(() => red(new Error('zaman asimi')), ms))
    ])
  }
}

module.exports = {
  MinecraftEnvironment, MAX_ADIM, HEDEF_ODUN, DONUS_ACISI, OLUM_CEZASI,
  DURGUNLUK_SINIRI, TAKILMA_ESIGI, KACINMA_SURESI
}
