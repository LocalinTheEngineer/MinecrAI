'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')
const { uygunAlet } = require('./alet')
const { uret } = require('./uret')
const { dusenleriTopla } = require('./chopTree')
const koruma = require('../utils/koruma')

/**
 * SKILL: Kaz  ("kaz demir", "kaz elmas 5")
 *
 * Madencilik ağaç kesmekten üç noktada ayrılıyor:
 *
 * 1) ALET ZORUNLU. Taşı elle kırarsan blok yok olur, hiçbir şey düşmez.
 *    Demir cevheri taş kazma ister, elmas demir kazma ister. Yanlış
 *    kazmayla kırmak cevheri YOK ETMEK demek — botun kendi ayağına
 *    sıkması. O yüzden kırmadan önce seviye kontrolü yapıyoruz.
 *
 * 2) CEVHER GÖRÜNMÜYOR. Ağaç yüzeyde duruyor, cevher taşın içinde.
 *    Önce doğru derinliğe inmek, sonra aramak gerekiyor.
 *
 * 3) AŞAĞISI ÖLDÜRÜR. Dümdüz aşağı kazmak Minecraft'ın en klasik ölüm
 *    sebebi: altında lav gölü veya 30 bloklu bir mağara olabilir, ikisini
 *    de bloğu kırmadan göremezsin. Bu yüzden merdiven şeklinde iniyoruz —
 *    her adımda bir ileri bir aşağı, ayağının altı hep dolu.
 */

// Türkçe ad -> blok adları. Derinlerde taş yerine deepslate var,
// cevherin adı da değişiyor (iron_ore / deepslate_iron_ore) — ikisi de listede.
const CEVHERLER = {
  komur: { bloklar: ['coal_ore', 'deepslate_coal_ore'], seviye: 'wooden', y: 50 },
  kömür: { bloklar: ['coal_ore', 'deepslate_coal_ore'], seviye: 'wooden', y: 50 },
  bakir: { bloklar: ['copper_ore', 'deepslate_copper_ore'], seviye: 'stone', y: 48 },
  bakır: { bloklar: ['copper_ore', 'deepslate_copper_ore'], seviye: 'stone', y: 48 },
  demir: { bloklar: ['iron_ore', 'deepslate_iron_ore'], seviye: 'stone', y: 15 },
  altin: { bloklar: ['gold_ore', 'deepslate_gold_ore'], seviye: 'iron', y: -16 },
  altın: { bloklar: ['gold_ore', 'deepslate_gold_ore'], seviye: 'iron', y: -16 },
  redstone: { bloklar: ['redstone_ore', 'deepslate_redstone_ore'], seviye: 'iron', y: -58 },
  lapis: { bloklar: ['lapis_ore', 'deepslate_lapis_ore'], seviye: 'stone', y: 0 },
  elmas: { bloklar: ['diamond_ore', 'deepslate_diamond_ore'], seviye: 'iron', y: -58 },
  zumrut: { bloklar: ['emerald_ore', 'deepslate_emerald_ore'], seviye: 'iron', y: 100 },
  zümrüt: { bloklar: ['emerald_ore', 'deepslate_emerald_ore'], seviye: 'iron', y: 100 },
  tas: { bloklar: ['stone', 'deepslate', 'andesite', 'diorite', 'granite'], seviye: 'wooden', y: null },
  taş: { bloklar: ['stone', 'deepslate', 'andesite', 'diorite', 'granite'], seviye: 'wooden', y: null }
}

// Kazma seviyeleri, zayıftan güçlüye. "iron" isteyen bir cevheri
// elmas kazmayla da kırabilirsin — index karşılaştırması bunun için.
const SEVIYELER = ['wooden', 'stone', 'iron', 'diamond', 'netherite']

// Kazarken karşımıza çıkarsa DURACAĞIMIZ bloklar
const TEHLIKELI = /lava|bedrock/
const SU = /water|bubble_column/

// Kazma kırılmadan önce yenisini yapmaya başladığımız eşik.
// Sıfırı beklemek geç: kırıldığı anda elin boş kalıyor ve kırdığın
// bir sonraki cevher YOK OLUYOR (alet olmadan kırılan cevher düşmez).
const KRITIK_DAYANIKLILIK = 20

// Yeterlilik ölçüsü KAZMA SAYISI değil, TOPLAM VURUŞ.
//
// Bu ayrım bir hataya mal oldu: bot elinde ELMAS KAZMA varken gidip
// demir kazma yapıyordu. Sebep, stok kontrolünün "3 kazmam var mı?"
// diye sorması. Bir elmas kazma tek başına 1561 vuruş — üç taş
// kazmanın (393) dört katı. Sayarak bakınca "1 tane, az" görünüyor;
// vuruşla bakınca fazlasıyla yeterli.
//
// Referans dayanıklılıklar: tahta 59, taş 131, demir 250, elmas 1561.
// y=64'ten y=15'e inmek ~49 basamak x 3 blok = ~147 vuruş.
const GUVENLIK_PAYI = 40

/** Bu eşyada kaç vuruş kaldı? (aleti olmayan eşyalar için sonsuz) */
function kalanDayaniklilik (esya) {
  if (!esya || !esya.maxDurability) return Infinity
  return esya.maxDurability - (esya.durabilityUsed || 0)
}

/**
 * Gerekli seviyeyi karşılayan kazmaların TOPLAM kalan vuruşu.
 * Tek tek değil toplam bakıyoruz: iki yarı ömürlü kazma bir tam kazma eder.
 */
function kazmaGucu (bot, gerekliSeviye) {
  const gerekli = SEVIYELER.indexOf(gerekliSeviye)
  let toplam = 0
  let adet = 0
  for (const esya of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(esya.name)
    if (!m) continue
    const seviye = SEVIYELER.indexOf(m[1] === 'golden' ? 'stone' : m[1])
    if (seviye < gerekli) continue
    toplam += kalanDayaniklilik(esya)
    adet++
  }
  return { toplam, adet }
}

/**
 * Bu iş kaç vuruş tutar? İniş + kazma + güvenlik payı.
 * Tahminle değil, yapılacak işin boyutundan hesaplanıyor.
 */
function gerekenVurus (bot, hedefY, adet) {
  const su = Math.floor(bot.entity.position.y)
  const derinlik = hedefY === null ? 0 : Math.max(0, su - hedefY)
  return derinlik * 3 + adet * 2 + GUVENLIK_PAYI
}

/**
 * Kazma stoğunu VURUŞ hedefine göre tazele.
 *
 * Kazdığımız taş zaten envanterde olduğu için yeraltında taş kazma
 * yapmak mümkün — tek şart yanımızda tezgah olması, o yüzden inmeden
 * önce bir tane üretiyoruz.
 */
async function kazmaStokla (bot, kontrol, seviye, hedefVurus, secenekler = {}) {
  const istek = seviye === 'wooden'
    ? 'tahta kazma'
    : seviye === 'stone'
      ? 'tas kazma'
      : seviye === 'iron' ? 'demir kazma' : 'elmas kazma'

  let yapilan = 0
  for (let i = 0; i < 5; i++) {
    kontrol.kontrolEt()
    if (kazmaGucu(bot, seviye).toplam >= hedefVurus) break
    const r = await uret(bot, kontrol, istek, 1, secenekler)
    if (!r.basarili) break
    yapilan++
  }
  return yapilan
}

// Canın bu değerin altına düşmesi "buradan çık" demek.
// 20 tam can; 12 = üç kalp gitmiş. Lav saniyede ~4 can götürüyor,
// yani 12'de fark edip kaçmak ancak yetiyor.
const KACIS_CANI = 12

// Tünel açmadan önce önümüzü kaç blok ileriye kadar lav için tarıyoruz
const LAV_TARAMA = 4

/**
 * Şu an tehlikede miyiz? Değilse null, tehlikedeysek sebebi.
 *
 * Bu fonksiyonun olmaması bir ölüme mal oldu: bot lav gölüne girdi ve
 * kod hiçbir yerde canına bakmadığı için kazmaya devam etti. Kırdığı
 * blokları güvenlik açısından kontrol ediyorduk ama BOTUN KENDİ
 * durumunu hiç sormuyorduk.
 */
function tehlikedeMi (bot) {
  if (typeof bot.health === 'number' && bot.health < KACIS_CANI) {
    return `canım azaldı (${bot.health.toFixed(0)}/20)`
  }
  const ayak = bot.blockAt(bot.entity.position)
  const alt = bot.blockAt(bot.entity.position.offset(0, -1, 0))
  for (const b of [ayak, alt]) {
    if (b && /lava/.test(b.name)) return 'lavın içindeyim'
  }
  return null
}

/**
 * Gitmek istediğimiz yönde lav var mı?
 *
 * `guvenliMi` sadece KIRACAĞIMIZ bloğun komşularına bakıyordu — bir blok
 * ötesi kör nokta. Tünel açarken lav gölünün duvarını delip içine
 * yürümek tam olarak böyle oluyor.
 */
function ondeLavVarMi (bot, yon, menzil = LAV_TARAMA) {
  const ayak = bot.entity.position.floored()
  for (let i = 1; i <= menzil; i++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (const yan of [-1, 0, 1]) {
        const p = ayak.offset(
          yon.x * i + (yon.x === 0 ? yan : 0),
          dy,
          yon.z * i + (yon.z === 0 ? yan : 0)
        )
        const b = bot.blockAt(p)
        if (b && /lava/.test(b.name)) return true
      }
    }
  }
  return false
}

/** Envanterdeki en iyi kazmanın seviyesi (yoksa null) */
function kazmaSeviyesi (bot) {
  let enIyi = -1
  for (const esya of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(esya.name)
    if (!m) continue
    const i = SEVIYELER.indexOf(m[1] === 'golden' ? 'stone' : m[1])
    if (i > enIyi) enIyi = i
  }
  return enIyi < 0 ? null : SEVIYELER[enIyi]
}

/** Botun baktığı yönün en yakın ana yönü (kuzey/güney/doğu/batı) */
function ileriYon (bot) {
  const yaw = bot.entity.yaw
  const x = -Math.sin(yaw)
  const z = -Math.cos(yaw)
  return Math.abs(x) > Math.abs(z)
    ? new Vec3(Math.sign(x), 0, 0)
    : new Vec3(0, 0, Math.sign(z))
}

/** Bu bloğu kırmak güvenli mi? Komşularında lav/su var mı? */
/**
 * Bu bloğu kırmak güvenli mi?
 *
 * SU, NEREYE GİTTİĞİNE GÖRE TEHLİKELİ.
 *
 * Eskiden su da lav gibi mutlak engeldi ve bu yüzden ulaşılabilir
 * elmaslar sessizce reddediliyordu — derinlerde su cebi çok yaygın.
 * Ama ayrım şurada:
 *
 *  - Uzaktan bir CEVHERE vuruyorsak yanındaki su önemsiz; en fazla
 *    biraz sel olur, biz yerimizde dururuz.
 *  - MERDİVEN kazıyorsak o boşluğa kendimiz gireceğiz. Su cebini açıp
 *    içine girmek boğulmak demek.
 *
 * O yüzden `suTehlikeli` çağıran tarafın kararı: merdiven true diyor,
 * cevher kırma false.
 */
function guvenliMi (bot, konum, { suTehlikeli = false } = {}) {
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const b = bot.blockAt(konum.offset(dx, dy, dz))
    if (!b) continue
    if (TEHLIKELI.test(b.name)) return false
    if (suTehlikeli && SU.test(b.name)) return false
  }
  return true
}

/** Tek bir bloğu kır (kırılabiliyorsa) */
async function blogoKir (bot, konum, kontrol, gerekliSeviye = null, { suTehlikeli = false } = {}) {
  const b = bot.blockAt(konum)
  if (!b || b.name === 'air' || b.boundingBox !== 'block') return true

  // NEDEN kıramadığını SÖYLE.
  //
  // Bot ulaşabildiği bir elması kıramayıp döngüye girdi ve log'da tek
  // satır sebep yoktu — kodu okuyup tahmin yürütmek zorunda kaldım.
  // Reddin sebebi artık konsola yazılıyor; bir dahakine tahmin yok.
  const reddet = (sebep) => {
    log.uyari(`${b.name} @ ${konum} kırılmadı: ${sebep}`)
    return false
  }

  if (koruma.korumaliMi(konum)) return reddet('koruma bölgesi')
  if (!guvenliMi(bot, konum, { suTehlikeli })) return reddet('yanında lav, su veya bedrock var')
  if (!bot.canDigBlock(b)) {
    const goz = bot.entity.position.offset(0, bot.entity.height || 1.62, 0)
    const uzaklik = goz.distanceTo(konum.offset(0.5, 0.5, 0.5))
    return reddet(`kazılamıyor (uzaklık ${uzaklik.toFixed(1)}, görüş kapalı olabilir)`)
  }

  const alet = uygunAlet(bot, b)

  // ALETSİZ CEVHERE VURMA.
  //
  // `canDigBlock` "kırabilir misin"e bakıyor, "düşer mi"ye değil. Elle
  // vurunca taş da cevher de kırılıyor ama YERE HİÇBİR ŞEY DÜŞMÜYOR.
  // Kazma kırıldıktan sonra bot çalışmaya devam ederse elmas damarını
  // sessizce siler. Kırılan kazma bu yüzden sadece bir yavaşlama değil,
  // veri kaybı.
  if (gerekliSeviye && /ore$|ancient_debris/.test(b.name)) {
    const { toplam } = kazmaGucu(bot, gerekliSeviye)
    if (toplam <= 0) return reddet(`${gerekliSeviye} kazma gerekiyor, yok`)
  }

  if (alet) { try { await bot.equip(alet, 'hand') } catch (err) { /* elle dene */ } }

  await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true)
  await sinirli(bot.dig(b), 12000, kontrol)
  return true
}

/**
 * Merdiven şeklinde bir basamak in.
 *
 * Her basamakta üç blok kırılıyor: önümüzdeki ayak ve baş hizası (geçmek
 * için) ve onun altındaki (inmek için). Ayağımızın altı hiçbir zaman
 * boşalmıyor, o yüzden ne düşüyoruz ne de lavın içine giriyoruz.
 * Lav/su görürsek basamağı hiç kırmadan duruyoruz.
 */
async function birBasamakIn (bot, kontrol, gerekliSeviye = null) {
  const yon = ileriYon(bot)
  if (ondeLavVarMi(bot, yon)) return { ok: false, sebep: 'onde_lav' }
  const ayak = bot.entity.position.floored()

  const onAyak = ayak.plus(yon)
  const onBas = onAyak.offset(0, 1, 0)
  const onAlt = onAyak.offset(0, -1, 0)

  for (const konum of [onBas, onAyak, onAlt]) {
    kontrol.kontrolEt()
    // İçine gireceğimiz boşluk: su da tehlike (boğulma)
    if (!guvenliMi(bot, konum, { suTehlikeli: true })) return { ok: false, sebep: 'tehlike' }
  }

  // AÇIK MAĞARA DURUMU.
  //
  // Merdiven algoritması "önümüz dolu taş" varsayıyor. 1.18 sonrası
  // devasa mağaralarda bu varsayım çöküyor: önümüz zaten boşluk, kıracak
  // bir şey yok, sonra da havadaki bir noktaya yürümeye çalışıp
  // "yuruyemedim" diyorduk. Ekran görüntüsünde bot tam olarak bunu
  // yaşıyordu — bir mağara çıkıntısında durup inemiyordu.
  //
  // Önümüz boşsa kazmaya gerek yok; iş pathfinder'ın işi.
  const onuBos = [onBas, onAyak, onAlt].every((k) => {
    const b = bot.blockAt(k)
    return !b || b.boundingBox !== 'block'
  })
  if (onuBos) return { ok: false, sebep: 'acik_alan' }

  for (const konum of [onBas, onAyak, onAlt]) {
    kontrol.kontrolEt()
    if (!(await blogoKir(bot, konum, kontrol, gerekliSeviye, { suTehlikeli: true }))) {
      return { ok: false, sebep: 'kirilamadi' }
    }
  }

  // Açtığımız boşluğa yürü
  try {
    pathfinderHazirla(bot)
    await sinirli(
      bot.pathfinder.goto(new goals.GoalBlock(onAlt.x, onAlt.y, onAlt.z)),
      8000, kontrol
    )
  } catch (err) {
    if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }
    pathfinderDurdur(bot)
    return { ok: false, sebep: 'yuruyemedim' }
  }
  return { ok: true }
}

/**
 * Bir adım YATAY tünel aç (aşağı inmeden).
 *
 * `birBasamakIn` her çağrıldığında BİR BLOK AŞAĞI iniyor. Arama
 * döngüsünde onu kullanmak şu hataya yol açtı: cevher bulamayınca
 * "biraz ilerle, tekrar bak" derken bot her seferinde bir kat daha
 * iniyordu ve sonunda BEDROCK'a dayanıyordu. Aramak yatay bir iş;
 * derinliği zaten `seviyeyeIn` ayarladı, orada kalmalıyız.
 */
async function birAdimIlerle (bot, kontrol, gerekliSeviye = null) {
  const yon = ileriYon(bot)
  if (ondeLavVarMi(bot, yon)) return { ok: false, sebep: 'onde_lav' }
  const ayak = bot.entity.position.floored()

  const onAyak = ayak.plus(yon)
  const onBas = onAyak.offset(0, 1, 0)

  for (const konum of [onBas, onAyak]) {
    kontrol.kontrolEt()
    if (!guvenliMi(bot, konum, { suTehlikeli: true })) return { ok: false, sebep: 'tehlike' }
  }
  for (const konum of [onBas, onAyak]) {
    kontrol.kontrolEt()
    if (!(await blogoKir(bot, konum, kontrol, gerekliSeviye, { suTehlikeli: true }))) {
      return { ok: false, sebep: 'kirilamadi' }
    }
  }

  try {
    pathfinderHazirla(bot)
    await sinirli(
      bot.pathfinder.goto(new goals.GoalBlock(onAyak.x, onAyak.y, onAyak.z)),
      8000, kontrol
    )
  } catch (err) {
    if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }
    pathfinderDurdur(bot)
    return { ok: false, sebep: 'yuruyemedim' }
  }
  return { ok: true }
}

/** Hedef Y seviyesine merdivenle in */
async function seviyeyeIn (bot, hedefY, kontrol, { maksBasamak = 120, seviye = 'stone', tedarikci = null } = {}) {
  let basamak = 0
  let takilma = 0

  while (Math.floor(bot.entity.position.y) > hedefY && basamak < maksBasamak) {
    kontrol.kontrolEt()

    const tehlike = tehlikedeMi(bot)
    if (tehlike) return { ok: false, basamak, sebep: `tehlike: ${tehlike}` }

    const oncekiY = Math.floor(bot.entity.position.y)

    // İNİŞ SIRASINDA KAZMA BİTERSE.
    //
    // Her basamak 3 blok. y=64'ten y=15'e inmek ~147 blok eder; tahta
    // kazma 59, taş kazma 131 vuruş dayanır. Yani inişin ortasında
    // kalmak istisna değil, KURAL. Eşiğe gelince duruyoruz ve kazdığımız
    // taştan yenisini yapıyoruz — malzeme zaten envanterde.
    const guc = kazmaGucu(bot, seviye)
    if (guc.toplam < KRITIK_DAYANIKLILIK) {
      log.uyari(`Kazma bitmek üzere (${guc.toplam} vuruş), yenisini yapıyorum.`)
      await kazmaStokla(bot, kontrol, seviye, gerekenVurus(bot, hedefY, 0), { tedarikci })
      if (kazmaGucu(bot, seviye).toplam < KRITIK_DAYANIKLILIK) {
        return { ok: false, basamak, sebep: 'kazma_bitti' }
      }
    }

    // ÖNCE PATHFINDER, SONRA MERDİVEN.
    //
    // Pathfinder mağarayı, çıkıntıyı, merdiveni, tüneli hepsini biliyor
    // ve `canDig` açık olduğu için gerekirse taş da kırıyor. Elle yazdığım
    // merdiven onun yapamadığı tek şeyi yapıyor: DÜMDÜZ TAŞIN İÇİNDE yol
    // açmak. Doğru sıra bu — önce hazır çözümü dene, olmazsa kaz.
    //
    // 10 bloklu parçalar halinde iniyoruz: 50 bloğun tamamını tek seferde
    // istemek pathfinder'a devasa bir arama uzayı veriyor.
    const araHedef = Math.max(hedefY, oncekiY - 10)
    try {
      pathfinderHazirla(bot)
      await sinirli(bot.pathfinder.goto(new goals.GoalY(araHedef)), 20000, kontrol)
    } catch (err) {
      if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }
      pathfinderDurdur(bot)
    }

    if (Math.floor(bot.entity.position.y) < oncekiY) {
      basamak++
      takilma = 0
      continue
    }

    // Pathfinder ilerletemedi: elle merdiven kaz
    const r = await birBasamakIn(bot, kontrol, seviye)
    if (!r.ok) {
      if (++takilma >= 3) return { ok: false, basamak, sebep: r.sebep }
      continue
    }
    takilma = 0
    basamak++
    if (basamak % 10 === 0) {
      log.bilgi(`y=${Math.floor(bot.entity.position.y)} (${basamak} basamak)`)
    }
  }
  return { ok: true, basamak }
}

/**
 * Bir cevherden başlayıp DAMARIN TAMAMINI bulur (flood fill).
 *
 * Cevherler tek tek değil damar halinde bulunuyor: bir demir damarı
 * genelde 4-9 blok. Eskiden kod her turda "en yakın cevheri" seçip
 * kırıyor, sonra yeniden arıyordu. Sorun şu: bir bloğu kırdıktan sonra
 * en yakın aday bazen başka bir damarın kenarı oluyor — bot 2 blok
 * kırıp 3-4'ünü bırakarak gidiyordu. Ekranda gördüğün buydu.
 *
 * Ağaç kesmede aynı şeyi `agaciTopla` ile çözmüştük; burada da damarın
 * tamamını bir liste yapıp bitirene kadar üstünde duruyoruz.
 */
function damarTopla (bot, baslangic, isimler, limit = 24) {
  const bulunan = []
  const gorulen = new Set()
  const kuyruk = [baslangic]

  while (kuyruk.length > 0 && bulunan.length < limit) {
    const p = kuyruk.shift()
    const anahtar = `${p.x},${p.y},${p.z}`
    if (gorulen.has(anahtar)) continue
    gorulen.add(anahtar)

    const b = bot.blockAt(p)
    if (!b || !isimler.includes(b.name)) continue
    if (koruma.korumaliMi(p)) continue
    bulunan.push(p)

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          kuyruk.push(p.offset(dx, dy, dz))
        }
      }
    }
  }
  return bulunan
}

/** Yakındaki hedef cevherleri, gerçek uzaklığa göre sıralı */
function cevherBul (bot, isimler, yaricap, karaListe) {
  const idler = isimler
    .map((n) => (bot.registry.blocksByName[n] || {}).id)
    .filter((x) => x !== undefined)
  if (idler.length === 0) return []

  return bot.findBlocks({ matching: idler, maxDistance: yaricap, count: 64 })
    .filter((p) => !karaListe.has(`${p.x},${p.y},${p.z}`) && !koruma.korumaliMi(p))
    .sort((a, b) =>
      a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
}

/**
 * Ana komut.
 * @param {string} istek "demir", "elmas", "tas"
 * @param {number} adet kaç blok kırılsın
 */
async function kaz (bot, kontrol, istek, adet = 8, secenekler = {}) {
  const ad = String(istek || 'tas').toLowerCase().trim()
  const cevher = CEVHERLER[ad]
  if (!cevher) {
    return {
      basarili: false,
      mesaj: `"${istek}" nedir bilmiyorum. Bildiklerim: ${Object.keys(CEVHERLER).join(', ')}`
    }
  }

  // --- 1) Doğru kazma elimizde mi? Yoksa yapmayı dene ---
  const gerekli = SEVIYELER.indexOf(cevher.seviye)
  let mevcut = SEVIYELER.indexOf(kazmaSeviyesi(bot))

  if (mevcut < gerekli) {
    log.bilgi(`${cevher.seviye} kazma lazım, yapmayı deniyorum...`)
    const yapim = await uret(bot, kontrol, `${cevher.seviye === 'wooden' ? 'tahta' : cevher.seviye === 'stone' ? 'tas' : 'demir'} kazma`, 1, secenekler)
    mevcut = SEVIYELER.indexOf(kazmaSeviyesi(bot))
    if (mevcut < gerekli) {
      return {
        basarili: false,
        mesaj: `${ad} için ${cevher.seviye} kazma gerekiyor, yapamadım — ${yapim.mesaj}`
      }
    }
  }

  const baslangicKonum = bot.entity.position.clone()

  // --- 2) İnmeden önce STOK YAP ---
  //
  // Tek kazmayla derine inmek mümkün değil (yukarıdaki hesaba bak).
  // Yanımıza yedek kazma ve bir tezgah alıyoruz; tezgah sayesinde
  // aşağıda, kazdığımız taştan yerinde yeni kazma yapabiliyoruz.
  if (cevher.y !== null && Math.floor(bot.entity.position.y) > cevher.y + 8) {
    await kazmaStokla(bot, kontrol, cevher.seviye, gerekenVurus(bot, cevher.y, adet), secenekler)
    await uret(bot, kontrol, 'tezgah', 1, secenekler) // olmazsa olsun, sadece deniyoruz
    const g = kazmaGucu(bot, cevher.seviye)
    log.bilgi(`${g.adet} kazma, toplam ${g.toplam} vuruş ile iniyorum.`)
  }

  // --- 3) Doğru derinliğe in ---
  if (cevher.y !== null && Math.floor(bot.entity.position.y) > cevher.y + 8) {
    log.bilgi(`${ad} için y=${cevher.y} seviyesine iniyorum...`)
    const inis = await seviyeyeIn(bot, cevher.y, kontrol, { seviye: cevher.seviye, tedarikci: secenekler.tedarikci })
    if (!inis.ok && inis.basamak === 0) {
      return { basarili: false, mesaj: `İnemedim (${inis.sebep}).` }
    }
    if (!inis.ok && inis.sebep === 'kazma_bitti') {
      // Aletsiz yeraltında kalmak = mahsur kalmak. Kazdığımız merdiven
      // hâlâ duruyor, oradan yürüyerek geri çıkabiliyoruz.
      await yuzeyeDon(bot, baslangicKonum, kontrol)
      return {
        basarili: false,
        kirilan: 0,
        mesaj: `Kazmam bitti ve yenisini yapacak malzemem yok (y=${Math.floor(bot.entity.position.y)}). Yukarı döndüm — odun ve taş verirsen tekrar denerim.`
      }
    }
    if (!inis.ok) log.uyari(`İniş yarıda kesildi (${inis.sebep}), buradan arıyorum.`)
  }

  // --- 3) Cevheri ara ve kır ---
  const baslangic = bot.entity.position.clone()
  const karaListe = new Set()
  let kirilan = 0
  let bosArama = 0
  let kazmaBitti = false
  let kacildi = null

  // DÖNGÜ SİGORTASI.
  //
  // Bot ulaşamadığı bir cevherin etrafında sonsuza kadar dönebiliyordu.
  // İki koruma: toplam tur sayısı sınırlı, ve her turda ya bir blok
  // kırılmalı ya da kara listeye bir şey eklenmeli. İkisi de olmuyorsa
  // ilerleme yok demektir; sayıyoruz ve belli bir yerden sonra duruyoruz.
  const MAKS_TUR = 60
  let tur = 0
  let ilerlemesiz = 0

  while (kirilan < adet && bosArama < 6 && tur < MAKS_TUR) {
    kontrol.kontrolEt()

    // CANINA BAK. Lav saniyede ~4 can götürüyor; 12'de fark edip
    // kaçmak ancak yetiyor. Bu kontrol olmadığı için bot bir kez
    // lavda öldü — kırdığı blokları denetliyorduk ama kendi durumunu
    // hiç sormuyorduk.
    const tehlike = tehlikedeMi(bot)
    if (tehlike) {
      log.hata(`${tehlike} — kaçıyorum.`)
      kacildi = tehlike
      break
    }

    tur++
    const turBasiKirilan = kirilan
    const turBasiKara = karaListe.size

    // Kazarken de bitebilir — yerinde yenisini yapmayı dene
    if (kazmaGucu(bot, cevher.seviye).toplam < KRITIK_DAYANIKLILIK) {
      await kazmaStokla(bot, kontrol, cevher.seviye, gerekenVurus(bot, null, adet - kirilan), secenekler)
      if (kazmaGucu(bot, cevher.seviye).toplam < KRITIK_DAYANIKLILIK) {
        kazmaBitti = true
        break
      }
    }

    const adaylar = cevherBul(bot, cevher.bloklar, 32, karaListe)
    if (adaylar.length === 0) {
      // Bulamadık: yatay olarak biraz ilerleyip tekrar bak (tünel aç)
      bosArama++
      // YATAY ilerle. Eskiden `birBasamakIn` çağrılıyordu ve her boş
      // aramada bir kat aşağı iniyorduk — bot böyle bedrock'a dayandı.
      const r = await birAdimIlerle(bot, kontrol, cevher.seviye)
      if (!r.ok) break
      continue
    }
    bosArama = 0

    // Damarın TAMAMINI al, tek bloğu değil
    const damar = damarTopla(bot, adaylar[0], cevher.bloklar)
    log.bilgi(`${damar.length} bloklu damar bulundu (y=${adaylar[0].y}).`)

    for (const konum of damar) {
      kontrol.kontrolEt()
      if (kirilan >= adet) break

      const anahtar = `${konum.x},${konum.y},${konum.z}`
      if (karaListe.has(anahtar)) continue

      // Elimizin altındaysa yürümeye gerek yok — damarın içindeyken
      // komşu bloklar zaten menzilde oluyor
      const goz = bot.entity.position.offset(0, bot.entity.height || 1.62, 0)
      const yakin = goz.distanceTo(konum.offset(0.5, 0.5, 0.5)) <= 4.4

      try {
        if (!yakin) {
          pathfinderHazirla(bot)
          await sinirli(
            bot.pathfinder.goto(new goals.GoalLookAtBlock(konum, bot.world, { range: 4 })),
            15000, kontrol
          )
          kontrol.kontrolEt()
        }
        if (await blogoKir(bot, konum, kontrol, cevher.seviye)) kirilan++
        else karaListe.add(anahtar)
      } catch (err) {
        if (err instanceof IptalEdildi) {
          pathfinderDurdur(bot); bot.stopDigging(); throw err
        }
        pathfinderDurdur(bot)
        karaListe.add(anahtar) // ulaşamadık, bir daha deneme
      }
    }

    // DÜŞENLERİ HEMEN TOPLA.
    //
    // Eskiden toplama sadece en sonda, BAŞLANGIÇ konumunun 16 blok
    // çevresinde yapılıyordu. Bot yerin 100 blok altında, başlangıçtan
    // yüzlerce blok ötede kazıyor — o yarıçapa hiçbir şey girmiyordu.
    // Kırdığı elmas yerde kalıyor, envantere hiç girmiyordu.
    if (kirilan > 0) {
      await kontrol.bekle(400)
      await dusenleriTopla(bot, bot.entity.position.clone(), kontrol, { yaricap: 10, maksTur: 3 })
    }

    // Damarın kalanı ulaşılamıyorsa sonsuza kadar aynı damara dönme
    for (const konum of damar) {
      const b = bot.blockAt(konum)
      if (b && cevher.bloklar.includes(b.name)) {
        karaListe.add(`${konum.x},${konum.y},${konum.z}`)
      }
    }

    if (kirilan === turBasiKirilan && karaListe.size === turBasiKara) {
      if (++ilerlemesiz >= 5) {
        log.uyari('Beş turdur ilerleme yok — burada yapabileceğim bir şey kalmadı.')
        break
      }
    } else {
      ilerlemesiz = 0
    }
  }

  // --- 4) Düşenleri topla ---
  if (kirilan > 0) {
    await kontrol.bekle(600)
    await dusenleriTopla(bot, baslangic, kontrol, { yaricap: 16 })
  }

  if (kacildi) {
    await yuzeyeDon(bot, baslangicKonum, kontrol)
    return {
      basarili: kirilan > 0,
      kirilan,
      mesaj: `${kacildi} — ${kirilan} ${ad} ile geri döndüm. Aşağısı tehlikeli.`
    }
  }

  if (kazmaBitti) {
    await yuzeyeDon(bot, baslangicKonum, kontrol)
    return {
      basarili: kirilan > 0,
      kirilan,
      mesaj: `${kirilan} ${ad} kırdım, sonra kazmam bitti. Yukarı döndüm.`
    }
  }

  // İŞ BİTİNCE YUKARI DÖN.
  //
  // Eskiden bot kazdığı yerde kalıyordu. Log'da bunu gördük: bot y=17'de
  // takılı kaldı ve oradan yüzeydeki ağaçlara ulaşmaya çalışıp her
  // seferinde başarısız oldu. Bir sonraki komut ne olursa olsun yeraltı
  // kötü bir başlangıç noktası.
  const derinlik = baslangicKonum.y - bot.entity.position.y
  if (derinlik > 6) await yuzeyeDon(bot, baslangicKonum, kontrol)

  return {
    basarili: kirilan > 0,
    kirilan,
    mesaj: kirilan > 0
      ? `${kirilan} ${ad} kırdım, yukarı döndüm (y=${Math.floor(bot.entity.position.y)}).`
      : `${ad} bulamadım (y=${Math.floor(bot.entity.position.y)}).`
  }
}

/**
 * Başladığımız yere geri yürü.
 * Kazdığımız merdiven duruyor, o yüzden aletsiz de olsa çıkış yolu var —
 * yeter ki merdiveni kendi arkamızdan kapatmayalım.
 */
async function yuzeyeDon (bot, hedef, kontrol) {
  log.bilgi('Yüzeye dönüyorum...')
  try {
    pathfinderHazirla(bot)
    await sinirli(
      bot.pathfinder.goto(new goals.GoalNear(hedef.x, hedef.y, hedef.z, 3)),
      60000, kontrol
    )
    return true
  } catch (err) {
    if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }
    pathfinderDurdur(bot)
    log.uyari('Yüzeye dönemedim — merdiveni takip ederek beni bulabilirsin.')
    return false
  }
}

module.exports = {
  kaz,
  kazmaSeviyesi,
  ileriYon,
  seviyeyeIn,
  birBasamakIn,
  yuzeyeDon,
  damarTopla,
  birAdimIlerle,
  kalanDayaniklilik,
  kazmaGucu,
  kazmaStokla,
  CEVHERLER,
  SEVIYELER,
  KRITIK_DAYANIKLILIK,
  GUVENLIK_PAYI,
  gerekenVurus,
  guvenliMi,
  tehlikedeMi,
  ondeLavVarMi,
  KACIS_CANI
}
