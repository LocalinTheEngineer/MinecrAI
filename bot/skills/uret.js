'use strict'

const log = require('../utils/log')
const { tezgahKoy } = require('./alet')
const { erit, eritmeGirdisi, yakitBul } = require('./erit')

/**
 * SKILL: Üret  ("uret taş kazma")
 *
 * `baltaYap` tek bir eşyanın tarifini ELLE yazıyordu:
 * odun → tahta → çubuk → tezgah → balta. Beş adım, hepsi kodda sabit.
 * Kazma için aynısını yazmak, kürek için aynısını yazmak... her yeni eşya
 * yeni bir fonksiyon demekti.
 *
 * Bu dosya onu genelleştiriyor: eşyanın adını söylüyorsun, tarif ağacını
 * KENDİSİ çözüyor. "Taş kazma yap" dediğinde:
 *
 *   taş kazma  ← 3 taş + 2 çubuk
 *     çubuk    ← 2 tahta        (yoksa yap)
 *       tahta  ← 1 kütük        (yoksa yap)
 *     taş      ← envanterde olmalı (kazılır, üretilemez)
 *
 * Özyinelemeli (recursive): eksik olan her ara malzeme için kendini
 * tekrar çağırıyor. Yeni bir eşya eklemek için kod yazmak gerekmiyor,
 * Minecraft'ın tarif tablosunda varsa yapabiliyor.
 */

// Türkçe → Minecraft adı. Kullanıcı "taş kazma" yazacak, "stone_pickaxe" değil.
const MALZEMELER = {
  tahta: 'wooden',
  ahsap: 'wooden',
  ahşap: 'wooden',
  odun: 'wooden',
  tas: 'stone',
  taş: 'stone',
  demir: 'iron',
  altin: 'golden',
  altın: 'golden',
  elmas: 'diamond',
  netherit: 'netherite',
  netherite: 'netherite'
}

const ALETLER = {
  kazma: 'pickaxe',
  balta: 'axe',
  kurek: 'shovel',
  kürek: 'shovel',
  kilic: 'sword',
  kılıç: 'sword',
  capa: 'hoe',
  çapa: 'hoe'
}

// Alet olmayan, tek parça eşyalar
const ESYALAR = {
  tahta: 'oak_planks',
  cubuk: 'stick',
  çubuk: 'stick',
  tezgah: 'crafting_table',
  tezgâh: 'crafting_table',
  masa: 'crafting_table',
  firin: 'furnace',
  fırın: 'furnace',
  sandik: 'chest',
  sandık: 'chest',
  mesale: 'torch',
  meşale: 'torch',
  merdiven: 'ladder',
  kapi: 'oak_door',
  kapı: 'oak_door',
  kova: 'bucket',
  makas: 'shears'
}

/**
 * "taş kazma" → "stone_pickaxe",  "çubuk" → "stick"
 * Zaten İngilizce yazılmışsa (stone_pickaxe) olduğu gibi geçiyor.
 */
function adiCoz (girdi) {
  const kelimeler = String(girdi).toLowerCase().trim().split(/\s+/)

  // Doğrudan Minecraft adı mı? ("stone_pickaxe")
  if (kelimeler.length === 1 && kelimeler[0].includes('_')) return kelimeler[0]

  let malzeme = null
  let alet = null
  for (const k of kelimeler) {
    if (MALZEMELER[k]) malzeme = MALZEMELER[k]
    else if (ALETLER[k]) alet = ALETLER[k]
  }

  if (alet) return `${malzeme || 'wooden'}_${alet}`

  const tek = kelimeler.join('_')
  if (ESYALAR[kelimeler[0]] && kelimeler.length === 1) return ESYALAR[kelimeler[0]]
  return ESYALAR[tek] || tek
}

// Kazarak / keserek elde edilebilen temel malzemeler.
// Tedarikçinin gerçekten getirebildikleriyle aynı liste olmalı.
const TOPLANABILIR = /_log$|_stem$|^cobblestone$|^stone$|^deepslate$|_ore$|^raw_|^coal$|^diamond$|^redstone$|^lapis_lazuli$|^emerald$/

/**
 * Bir malzemeyi elde etmek NE KADAR makul?
 *
 * Bu fonksiyonun varlık sebebi somut bir hata: bot "demir kazma yapamadım,
 * eksik olan stripped_birch_log" dedi. Sebep şu — Minecraft'ta tahta DÖRT
 * ayrı tariften yapılabiliyor:
 *
 *     birch_planks <- birch_log
 *     birch_planks <- birch_wood
 *     birch_planks <- stripped_birch_log      <-- bunu seçmişti
 *     birch_planks <- stripped_birch_wood
 *
 * Dördü de geçerli tarif. Ama soyulmuş kütük DOĞADA YOK — bir kütüğü
 * baltayla soyarak elde ediliyor. Bot onu "toplanamıyor" diye rapor edip
 * pes etti, oysa iki satır aşağıdaki normal kütük tarifi gayet uygundu.
 *
 * Eski kod tarifleri sadece "malzemesi ELİMDE VAR MI" diye puanlıyordu.
 * Hiçbiri elde yoksa dördü de sıfır puan alıyor ve sıra rastgele kalıyordu.
 * Artık "elde YOKSA nasıl elde edilir" de puanlanıyor.
 */
function malzemePuani (bot, mcData, isim, derinlik = 0) {
  if (sayim(bot, isim) > 0) return 4 // zaten var, en iyisi
  if (isim.startsWith('stripped_')) return -4 // doğada yok, elle soyulur
  if (/_wood$|_hyphae$/.test(isim)) return -2 // 6 kütükten yapılır, israf
  if (TOPLANABILIR.test(isim)) return 3 // kazılır/kesilir
  if (eritmeGirdisi(isim)) return 1 // eritilir

  const e = mcData.itemsByName[isim]
  if (!e) return -3
  const tarifler = bot.recipesAll(e.id, null, true)
  if (tarifler.length === 0) return -3 // çıkmaz sokak

  // BİR KAT DAHA DERİNE BAK.
  //
  // Bu olmadan bot şuna takılıyordu: çubuk için tahta lazım, tahtanın da
  // 11 çeşidi var (meşe, huş, kiraz...). Hiçbiri elde yokken hepsi aynı
  // puanı alıyor ve bot listedeki ilkini — meşeyi — seçiyor. Oysa
  // envanterde KİRAZ KÜTÜĞÜ var; kiraz tahtası bir adım ötede, meşe
  // tahtası imkânsız.
  //
  // Tek kat bakınca ikisi de "üretilebilir" görünüyor. İki kat bakınca
  // fark ortaya çıkıyor: kirazın malzemesi elimizde.
  if (derinlik >= 2) return 1

  let enIyi = 1
  for (const t of tarifler.slice(0, 8)) {
    const { girdi } = tarifGirdileri(mcData, t)
    const isimler = Object.keys(girdi)
    if (isimler.length === 0) continue
    const enZayif = Math.min(
      ...isimler.map((x) => malzemePuani(bot, mcData, x, derinlik + 1))
    )
    // En zayıf halka neyse tarif o kadar sağlam
    if (enZayif >= 4) enIyi = Math.max(enIyi, 3) // malzemesi hazır
    else if (enZayif >= 3) enIyi = Math.max(enIyi, 2) // toplanabilir
  }
  return enIyi
}

/** Envanterde bu addan kaç tane var */
function sayim (bot, ad) {
  return bot.inventory.items()
    .filter((i) => i.name === ad)
    .reduce((t, i) => t + i.count, 0)
}

/** Yakında masa var mı, yoksa koyabilir miyiz */
async function masaBul (bot, mcData) {
  const masa = bot.findBlock({
    matching: mcData.blocksByName.crafting_table.id, maxDistance: 4
  })
  if (masa) return masa
  if (!bot.inventory.items().some((i) => i.name === 'crafting_table')) return null
  if (!(await tezgahKoy(bot))) return null
  return bot.findBlock({
    matching: mcData.blocksByName.crafting_table.id, maxDistance: 4
  })
}

/**
 * Bir tarifin girdilerini {ad: adet} olarak verir.
 *
 * mineflayer tarifi `delta` dizisinde tutuyor: eksi sayılar TÜKETİLEN,
 * artı sayı ÜRETİLEN. inShape/ingredients formatları tarife göre
 * değiştiği için delta'yı okumak tek güvenilir yol.
 */
function tarifGirdileri (mcData, tarif) {
  const girdi = {}
  let uretilen = 1
  for (const d of tarif.delta) {
    const isim = (mcData.items[d.id] || {}).name
    if (!isim) continue
    if (d.count < 0) girdi[isim] = (girdi[isim] || 0) + Math.abs(d.count)
    else uretilen = d.count
  }
  return { girdi, uretilen: Math.max(1, uretilen) }
}

/**
 * Eritme denemesi: ham maddeyi, fırını ve yakıtı sağlayıp fırına ver.
 * Hem "önce eritmeyi düşün" kestirmesi hem de normal B adımı bunu kullanıyor.
 */
async function eritmeyiDene (bot, mcData, ad, adet, kontrol, altSaglama) {
  const hamMadde = eritmeGirdisi(ad)
  if (!hamMadde) return { ok: false }

  const eksik = adet - sayim(bot, ad)

  const ham = await altSaglama(hamMadde, eksik)
  if (!ham.ok) return { ok: false, hata: ham }

  // Fırın da tezgahta üretiliyor — kendi tarif ağacından geçiyor
  const f = await altSaglama('furnace', 1)
  if (!f.ok) return { ok: false, hata: f }

  // Yakıt: kömür yoksa odun da yanıyor, o yüzden zorunlu değil
  if (!yakitBul(bot, eksik)) await altSaglama('coal', 1)

  const sonuc = await erit(bot, kontrol, ad, eksik)
  if (sonuc.basarili && sayim(bot, ad) >= adet) return { ok: true }
  return { ok: false, hata: { ok: false, eksik: sonuc.eksik || ad, mesaj: sonuc.mesaj } }
}

async function saglamaAl (bot, mcData, ad, adet, kontrol, secenekler = {}, iz = new Set(), derinlik = 0) {
  kontrol.kontrolEt()

  if (sayim(bot, ad) >= adet) return { ok: true }
  if (derinlik > 8) return { ok: false, eksik: ad, mesaj: 'tarif ağacı çok derin' }
  if (iz.has(ad)) return { ok: false, eksik: ad, mesaj: 'döngüsel tarif' }

  const esya = mcData.itemsByName[ad]
  if (!esya) return { ok: false, eksik: ad, mesaj: `"${ad}" diye bir eşya tanımıyorum` }

  iz.add(ad)
  let sonHata = null
  const altSaglama = (isim, n) =>
    saglamaAl(bot, mcData, isim, n, kontrol, secenekler, iz, derinlik + 1)

  try {
    // İKİ TUR.
    //
    // Neden: bot "spruce_log toplanamıyor" dedi. Minecraft'ta çubuk ~12
    // tarifle yapılabiliyor (her ağaç türü için bir tahta çeşidi). Envanter
    // boşken hepsi aynı puanı alıyor ve bot rastgele birini — ladin —
    // seçip ısrar ediyordu. Oysa ormanda meşe vardı.
    //
    // Birinci tur tedarikçiyi tetikliyor ("bana kütük lazım"), tedarikçi
    // eline NE GEÇERSE onu getiriyor (meşe). İkinci turda tarifler
    // yeniden puanlanıyor; artık elde meşe kütüğü olduğu için meşe tarifi
    // +4 alıp öne geçiyor ve zincir devam ediyor.
    //
    // Yani "hangi ağaç türü" sorusunu tahmin etmiyoruz — ormanın cevabını
    // görüp ona uyuyoruz.
    // Tedarik sayacı: bu turda ALT DALLARDA bile bir şey toplandı mı?
    //
    // Eskiden her kare sadece KENDİ tedarik çağrısına bakıyordu. Ama
    // "çubuk" karesi hiçbir zaman kendi tedarikini yapmıyor — tedarik
    // torunlarında (tahta > kütük) oluyor. Çubuk karesi bunu göremediği
    // için "12 tarifi de denedim, olmadı" deyip pes ediyordu; oysa bu
    // arada envantere meşe kütüğü girmişti ve meşe tarifi artık
    // çalışacaktı. Ortak bir sayaç bunu görünür kılıyor.
    const durum = secenekler._durum || (secenekler._durum = { tedarik: 0 })

    for (let tur = 0; tur < 3; tur++) {
      const turBasiTedarik = durum.tedarik
      // ---- ÖNCE ERİTMEYİ DÜŞÜN ----
      //
      // Demir külçenin TEZGAH tarifleri de var: demir bloğundan 9, demir
      // parçasından (nugget) 9. İkisi de külçeden yapıldığı için çıkmaz
      // sokak — ama tarif listesinde göründükleri için bot önce onları
      // deniyor, boşuna özyineleme yapıyordu. Ham madde zaten elimizdeyse
      // fırın kestirme yol: doğrudan oraya git.
      const hamElde = eritmeGirdisi(ad)
      if (hamElde && sayim(bot, hamElde) > 0) {
        const hizli = await eritmeyiDene(bot, mcData, ad, adet, kontrol, altSaglama)
        if (hizli.ok) return { ok: true }
        sonHata = hizli.hata || sonHata
      }

      // ================= A) TEZGAHTA ÜRET =================
      //
      // PLANLAMA için tarifleri masa VARMIŞ GİBİ soruyoruz (üçüncü argüman true).
      // mineflayer'ın `recipesAll(id, meta, masa)` fonksiyonu masa verilmezse
      // 3x3 tarifleri listeden ELİYOR. Taş kazma 3x3'tür; masasızken sorunca
      // boş liste dönüyor ve "üretilemiyor" sanıyorduk. Tavuk-yumurta:
      // masayı almak için tarifi bilmen, tarifi görmek için masan olması
      // gerekiyordu. Planlarken masa varmış gibi bak, üretmeden hemen önce
      // masayı gerçekten yap ve yere koy.
      const tarifler = bot.recipesAll(esya.id, null, true)

      // Envanterdekine en çok uyan tarifi önce dene: aynı eşyanın birçok
      // varyantı var (meşe tahtası, huş tahtası...), elimizdekine uyanı seç.
      const sirali = tarifler
        .map((t) => {
          const { girdi } = tarifGirdileri(mcData, t)
          const isimler = Object.keys(girdi)
          const puan = isimler
            .reduce((toplam, isim) => toplam + malzemePuani(bot, mcData, isim), 0)
          return { t, puan }
        })
        .sort((a, b) => b.puan - a.puan)
        .slice(0, 6) // 3'tü: tahtanın 4 varyantı var, iyi olan listeye girmiyordu
        .map((x) => x.t)

      for (const tarif of sirali) {
        kontrol.kontrolEt()
        const { girdi, uretilen } = tarifGirdileri(mcData, tarif)
        const kere = Math.max(1, Math.ceil((adet - sayim(bot, ad)) / uretilen))

        let girdilerTamam = true
        for (const [isim, n] of Object.entries(girdi)) {
          const alt = await altSaglama(isim, n * kere)
          if (!alt.ok) {
          // İLK (en iyi puanlı) tarifin hatasını sakla, sonuncununkini değil.
          // Kullanıcıya "stripped_birch_log eksik" demek yanıltıcıydı:
          // o, denenen son ve en kötü tarifin hatasıydı.
            if (!sonHata) sonHata = alt
            girdilerTamam = false
            break
          }
        }
        if (!girdilerTamam) continue

        let kullanilacakMasa = null
        if (tarif.requiresTable) {
          const m = await altSaglama('crafting_table', 1)
          if (!m.ok) { sonHata = m; continue }
          kullanilacakMasa = await masaBul(bot, mcData)
          if (!kullanilacakMasa) {
            sonHata = { ok: false, eksik: 'crafting_table', mesaj: 'tezgahı koyacak düz yer yok' }
            continue
          }
        }

        try {
          await bot.craft(tarif, kere, kullanilacakMasa)
          log.bilgi(`${kere}x ${ad} üretildi.`)
          if (sayim(bot, ad) >= adet) return { ok: true }
        } catch (err) {
          sonHata = { ok: false, eksik: ad, mesaj: err.message }
        }
      }

      // ================= B) FIRINDA ERİT =================
      //
      // Demir külçesi tezgahta ÜRETİLEMİYOR, sadece eritiliyor. Bu adım
      // olmadan taş kazmanın ötesine geçilemez: demir kazma için külçe,
      // külçe için fırın gerekiyor. Tarif ağacı burada tezgahtan fırına
      // atlıyor ve aynı özyineleme devam ediyor.
      if (eritmeGirdisi(ad)) {
        const sonuc = await eritmeyiDene(bot, mcData, ad, adet, kontrol, altSaglama)
        if (sonuc.ok) return { ok: true }
        sonHata = sonuc.hata || sonHata
      }

      // ================= C) DIŞARIDAN TEDARİK =================
      //
      // Ne üretiliyor ne eritiliyor: kütük, taş, cevher. Bunlar toplanır.
      // `tedarikci` dışarıdan enjekte ediliyor (bot/skills/index.js) —
      // burada doğrudan `kaz`ı çağırsaydık kaz->uret->kaz döngüsel bağımlılık
      // olurdu. Bu yüzden uret "nasıl toplanacağını" bilmiyor, sadece
      // "toplanabilir mi" diye soruyor.
      if (secenekler.tedarikci && tur === 0) {
        const eksik = adet - sayim(bot, ad)
        try {
          if (await secenekler.tedarikci(bot, kontrol, ad, eksik)) durum.tedarik++
          if (sayim(bot, ad) >= adet) return { ok: true }
        } catch (err) {
          if (err && err.name === 'IptalEdildi') throw err
          sonHata = { ok: false, eksik: ad, mesaj: `toplayamadım: ${err.message}` }
        }
      }

      if (!sonHata && tarifler.length === 0) {
        sonHata = { ok: false, eksik: ad, mesaj: `${ad} üretilemiyor, eritilemiyor, toplanamıyor` }
      }

      // Hiçbir yerde (alt dallarda dahil) yeni malzeme gelmediyse dur
      if (durum.tedarik === turBasiTedarik) break
      sonHata = null // yeni malzemeyle baştan dene
    }

    return sonHata || { ok: false, eksik: ad, mesaj: 'tarif uygulanamadı' }
  } finally {
    iz.delete(ad)
  }
}

/**
 * Dışarıya açılan komut.
 * @param {string} istek "taş kazma", "çubuk", "stone_pickaxe"
 */
async function uret (bot, kontrol, istek, adet = 1, secenekler = {}) {
  const mcData = require('minecraft-data')(bot.version)
  const ad = adiCoz(istek)

  if (!mcData.itemsByName[ad]) {
    return { basarili: false, mesaj: `"${istek}" neydi bilmiyorum (${ad} diye aradım).` }
  }

  const oncesi = sayim(bot, ad)
  const sonuc = await saglamaAl(bot, mcData, ad, oncesi + adet, kontrol, secenekler)

  if (!sonuc.ok) {
    return {
      basarili: false,
      mesaj: `${ad} yapamadım — ${sonuc.mesaj}. Eksik olan: ${sonuc.eksik}.`
    }
  }

  const kazanilan = sayim(bot, ad) - oncesi
  return { basarili: true, mesaj: `${kazanilan}x ${ad} hazır.`, ad, adet: kazanilan }
}

module.exports = { uret, adiCoz, saglamaAl, sayim, malzemePuani }
