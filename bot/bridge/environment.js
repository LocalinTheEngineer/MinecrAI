'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { kutukMu, oduncuSay } = require('../skills/chopTree')
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
const YUMUSAK = /_leaves$|vine|_sapling$|bamboo|cobweb|azalea|moss_|snow|sugar_cane|cactus|_mushroom_block$|shroomlight|_wart_block$/
const HEDEF_ODUN = 5

/**
 * Botu bir RL "environment"ına çeviren katman.
 *
 * Python tarafı sadece şunu bilir: reset() ver, step(action) ver, karşılığında
 * gözlem + ödül al. Minecraft'ın karmaşası bu dosyada kalır.
 */
class MinecraftEnvironment {
  constructor (bot) {
    this.bot = bot
    this.adim = 0
    this.oncekiOdun = 0
    this.oncekiMesafe = null
    this.hedefKonum = null      // kilitli hedef ağaç
    this.bolumBaslangicOdun = 0 // bölüm başındaki envanter — aşağıya bak
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
      if (kutukMu(mevcut)) return mevcut
      this.hedefKonum = null // kesilmiş, yenisini seç
    }

    const adaylar = this.bot.findBlocks({
      matching: (b) => kutukMu(b),
      maxDistance: config.searchRadius,
      count: 128
    })
    if (adaylar.length === 0) return null

    let enIyi = null
    let enIyiMesafe = Infinity
    for (const konum of adaylar) {
      const mesafe = konum.distanceTo(this.bot.entity.position)
      if (mesafe < enIyiMesafe) { enIyiMesafe = mesafe; enIyi = konum }
    }

    this.hedefKonum = enIyi
    return this.bot.blockAt(enIyi)
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
  onundekiKutuk (menzil = 4.5, koniKosinusu = 0.82) {
    const bot = this.bot
    const goz = bot.entity.position.offset(0, bot.entity.height, 0)
    const bakis = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))

    const adaylar = bot.findBlocks({
      matching: (b) => kutukMu(b), maxDistance: menzil + 1, count: 48
    })

    let enIyi = null
    let enIyiSkor = -Infinity

    for (const konum of adaylar) {
      const merkez = konum.offset(0.5, 0.5, 0.5)
      const fark = merkez.minus(goz)
      const yatay = new Vec3(fark.x, 0, fark.z)
      const uzaklik = yatay.norm()

      if (uzaklik > menzil || uzaklik < 0.01) continue
      if (Math.abs(fark.y) > 2.5) continue // ulaşamayacağı kadar yukarıda/aşağıda

      const hiza = yatay.scaled(1 / uzaklik).dot(bakis) // 1 = tam önümde
      if (hiza < koniKosinusu) continue

      const skor = hiza - uzaklik * 0.1 // hem hizalı hem yakın olanı seç
      if (skor > enIyiSkor) { enIyiSkor = skor; enIyi = bot.blockAt(konum) }
    }

    return enIyi
  }

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
    const bakis = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))
    const ayak = bot.entity.position

    for (const yukseklik of [0, 1]) {
      const nokta = ayak.offset(
        bakis.x * menzil, yukseklik + 0.1, bakis.z * menzil
      )
      const blok = bot.blockAt(nokta)
      if (!blok || blok.name === 'air') continue
      if (blok.boundingBox !== 'block') continue // su, çimen vs. engel değil
      if (!YUMUSAK.test(blok.name)) continue      // taş/toprak kazmıyoruz
      if (!bot.canDigBlock(blok)) continue
      return blok
    }
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
      mesafe = Math.min(mesafe / config.searchRadius, 1)
    }

    const baktigi = this.onundekiKutuk()

    return [
      dx, dy, dz,
      mesafe,
      bot.entity.yaw / Math.PI,
      bot.entity.pitch / Math.PI,
      Math.min(this.bolumOdunu() / HEDEF_ODUN, 1),
      (bot.health ?? 20) / 20,
      (bot.food ?? 20) / 20,
      kutukMu(baktigi) ? 1 : 0,
      bot.entity.onGround ? 1 : 0,
      this.adim / MAX_ADIM,
      this.onumuKapatan() ? 1 : 0 // yolum kapali mi
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
    return oduncuSay(this.bot) - this.bolumBaslangicOdun
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
    let kirilanKutuk = 0

    switch (action) {
      case 0: { // ileri yürü
        // Tek bloklu basamaklarda takılmasın diye kısa bir zıplama desteği.
        // Bu bir "makro" değil, oyunun fiziği — insan oyuncu da yürürken
        // önündeki tek bloğa zıplar.
        const oncekiKonum = bot.entity.position.clone()
        bot.setControlState('forward', true)
        await this.bekle(250)

        const ilerleme = bot.entity.position.xzDistanceTo(oncekiKonum)
        if (ilerleme < 0.05 && bot.entity.onGround) {
          bot.setControlState('jump', true)
          await this.bekle(150)
          bot.setControlState('jump', false)
        }

        await this.bekle(250)
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
          const kutuktu = kutukMu(hedef)
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
    this.pathfinderDurdur(bot)
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

    // Yer altina/magaraya dustuyse once yuzeye cik.
    await this.yuzeyeCik()

    // Bolum baslangicini agaca makul bir mesafeye tasi.
    //
    // Bu pathfinder cagrisi ajanin AKSIYONU DEGIL, bolum kurulumu. Ayrimi
    // korumak onemli: ajan hala yurumeyi ve donmeyi kendi ogreniyor, biz
    // sadece her bolume benzer bir baslangic dagilimindan basliyoruz.
    // Aksi halde agaclar kesildikce bot ormanin ortasinda kalip bos
    // bolumler uretiyor ve egitim verisi bozuluyor.
    await this.baslangicaTasi()
    this.oncekiOdun = oduncuSay(this.bot)
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
  async yuzeyeCik (zamanAsimi = 20000) {
    const bot = this.bot
    const p = bot.entity.position.floored()

    // Üstüm kapalı mı? Değilse zaten açıktayım.
    let kapali = false
    for (let dy = 2; dy <= 5; dy++) {
      const b = bot.blockAt(p.offset(0, dy, 0))
      if (b && b.boundingBox === 'block') { kapali = true; break }
    }
    if (!kapali) return false

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
      this.pathfinderDurdur(bot)
      return false
    } finally {
      this.hedefKonum = null
      // pathfinder botu hedefe donuk birakiyor — yonu tekrar rastgelelestir
      await this.bot.look(Math.random() * 2 * Math.PI - Math.PI, 0, true)
    }
  }

  async step (action) {
    this.adim++

    const kirilanKutuk = await this.aksiyonUygula(action)

    // --- ödül hesabı ---
    const odun = oduncuSay(this.bot)
    const yeniOdun = odun - this.oncekiOdun
    this.oncekiOdun = odun

    const mesafe = this.hamMesafe()
    let yaklasma = 0
    if (mesafe !== null && this.oncekiMesafe !== null) {
      yaklasma = this.oncekiMesafe - mesafe
    }
    this.oncekiMesafe = mesafe

    const reward =
      1.00 * yeniOdun +
      0.20 * kirilanKutuk +
      0.05 * yaklasma -
      0.01

    const bolumOdun = this.bolumOdunu()
    const terminated = bolumOdun >= HEDEF_ODUN || this.bot.health <= 0
    const truncated = this.adim >= MAX_ADIM

    return {
      obs: this.gozlem(),
      reward,
      terminated,
      truncated,
      info: { odun: bolumOdun, envanter: odun, adim: this.adim, yeniOdun, kirilanKutuk }
    }
  }

  /** Uzman politikanin bu durumda sececeği aksiyon (Milestone 3) */
  uzmanAksiyonu () {
    const { uzmanAksiyonu } = require('./expert')
    return uzmanAksiyonu(this.bot, this)
  }

  // ---------------------------------------------------------------- yardımcı

  bekle (ms) {
    return new Promise((r) => setTimeout(r, ms))
  }

  zamanAsimiyla (soz, ms) {
    return Promise.race([
      soz,
      new Promise((_, red) => setTimeout(() => red(new Error('zaman asimi')), ms))
    ])
  }
}

module.exports = { MinecraftEnvironment, MAX_ADIM, HEDEF_ODUN, DONUS_ACISI }
