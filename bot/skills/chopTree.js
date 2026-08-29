'use strict'

const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const config = require('../config')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderGit } = require('../utils/gorev')
const { aletKusan } = require('./alet')
const { sutunaCik, sutundanIn } = require('./sutun')
const koruma = require('../utils/koruma')

/**
 * SKILL: Ağaç kes
 *
 * Adımlar:
 *  1) Yakındaki en yakın kütük (log) bloğunu bul
 *  2) O ağacın gövdesini oluşturan bağlı bütün kütükleri topla (flood fill)
 *  3) Ağacın dibine yürü (pathfinder)
 *  4) Kütükleri alttan üste doğru kır
 *  5) Yere düşen odunları toplamak için üstlerinden geç
 *
 * Her adımda `kontrol.kontrolEt()` çağrılır — "dur" komutu böyle çalışır.
 */

// Bir bloğun "kütük" olup olmadığını isminden anlıyoruz.
// Böylece meşe / huş / ladin / mangrove fark etmeksizin hepsi çalışıyor.
function kutukMu (block) {
  if (!block) return false
  return /_log$|_stem$/.test(block.name)
}

/**
 * Bu kütük DOĞAL bir ağacın parçası mı, yoksa oyuncunun yaptığı bir yapı mı?
 *
 * Bot kullanıcının kütükten yaptığı EVİ kesmeye başlamıştı. Sebep: kod bir
 * bloğun ağaç olup olmadığını sadece ADINA bakarak anlıyordu, ev de aynı
 * bloktan yapıldığı için aynı kontrolden geçiyordu.
 *
 * Üç işarete birden bakıyoruz:
 *
 *  1) `stripped_` ile başlayan kütükler doğada oluşmaz — kesinlikle insan işi.
 *  2) Ağaç gövdesi en fazla 2x2'dir. Aynı seviyede etrafında bir sürü kütük
 *     varsa bu bir DUVAR demektir.
 *  3) Doğal ağacın yaprakları vardır. Yakınında hiç yaprak yoksa şüphelen.
 *
 * Pahalı bir kontrol (çok blok okuyor), o yüzden her bloğa değil sadece
 * aday kütüklere uygulanıyor.
 */
function dogalAgacMi (bot, blok) {
  if (!kutukMu(blok)) return false

  // 0) Oyuncunun işaretlediği koruma bölgesi — sezgisellerden ÖNCE gelir
  if (koruma.korumaliMi(blok.position)) return false

  // 1) Soyulmuş kütük doğada bulunmaz
  if (blok.name.startsWith('stripped_')) return false

  const p = blok.position

  // 2) Duvar testi: aynı yükseklikte etrafta kaç kütük var?
  //    Meşe/huş/ladin 1x1, koyu meşe/orman 2x2. Fazlası duvardır.
  let ayniSeviye = 0
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue
      if (kutukMu(bot.blockAt(p.offset(dx, 0, dz)))) ayniSeviye++
    }
  }
  if (ayniSeviye > 3) return false

  // 3) Yaprak testi: doğal ağacın tepesi vardır
  for (let dy = 0; dy <= 6; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const b = bot.blockAt(p.offset(dx, dy, dz))
        if (b && /_leaves$/.test(b.name)) return true
      }
    }
  }
  return false
}

/**
 * En yakın DOĞAL ağacı bul (oyuncunun yapılarını ve kara listeyi atlar).
 *
 * `karaListe`: daha önce denenip ULAŞILAMAYAN gövde dipleri. Bu olmadan
 * bot aynı erişilemez kütüğü sonsuza kadar seçiyordu — log'da bunu
 * (1429,71,-48) beş kez üst üste denerken gördük. Her deneme ~20 saniye.
 */
function enYakinDogalAgac (bot, yaricap, karaListe = null) {
  const adaylar = bot.findBlocks({
    matching: (b) => kutukMu(b), maxDistance: yaricap, count: 96
  })
  if (adaylar.length === 0) return null

  adaylar.sort((a, b) =>
    a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))

  for (const konum of adaylar) {
    const blok = bot.blockAt(konum)
    if (!dogalAgacMi(bot, blok)) continue
    if (karaListe) {
      const dip = govdeninDibi(bot, blok).position
      if (karaListe.has(`${dip.x},${dip.y},${dip.z}`)) continue
    }
    return blok
  }
  return null
}

/**
 * Bir kütükten aşağı inerek gövdenin DİBİNİ bulur.
 *
 * Neden gerekli: yayılma (flood fill) nereden başlarsa oraya yakın blokları
 * önce buluyor. Ortadaki bir kütükten başlayınca ve limite takılınca hem
 * kök hem tepe listenin dışında kalıyordu. Dipten başlayınca yayılma
 * ağacın tabanından yukarı doğru ilerliyor.
 */
function govdeninDibi (bot, blok) {
  let p = blok.position
  for (let i = 0; i < 24; i++) {
    const alt = bot.blockAt(p.offset(0, -1, 0))
    if (!kutukMu(alt)) break
    p = alt.position
  }
  return bot.blockAt(p) || blok
}

/**
 * Verilen kütüğe bağlı bütün kütükleri bulur (ağacın gövdesi).
 * 3x3x3 komşulukta yayılır — dallı ağaçlarda da çalışır.
 */
function agaciTopla (bot, baslangic, limit) {
  const bulunan = []
  const gorulen = new Set()
  const kuyruk = [govdeninDibi(bot, baslangic).position]

  while (kuyruk.length > 0 && bulunan.length < limit) {
    const pos = kuyruk.shift()
    const anahtar = `${pos.x},${pos.y},${pos.z}`
    if (gorulen.has(anahtar)) continue
    gorulen.add(anahtar)

    const block = bot.blockAt(pos)
    if (!kutukMu(block)) continue
    if (block.name.startsWith('stripped_')) continue // insan yapımı, dokunma
    bulunan.push(block)

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          kuyruk.push(pos.offset(dx, dy, dz))
        }
      }
    }
  }

  // Alttan üste sırala: ağacın altını önce kesmek daha güvenli
  bulunan.sort((a, b) => a.position.y - b.position.y)
  return bulunan
}

/** Envanterdeki toplam kütük sayısı — ödül fonksiyonunda da kullanacağız */
function oduncuSay (bot) {
  return bot.inventory.items()
    .filter((item) => /_log$|_stem$/.test(item.name))
    .reduce((toplam, item) => toplam + item.count, 0)
}

/** Yerdeki eşyaları bul (canlı liste — her çağrıda yeniden bakar) */
function yerdekiEsyalar (bot, merkez, yaricap) {
  return Object.values(bot.entities)
    .filter((e) => e.name === 'item' &&
                   e.isValid !== false &&
                   e.position.distanceTo(merkez) < yaricap)
    .sort((a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position))
}

/**
 * Yere düşen odunları topla.
 *
 * Neden döngü? Kütükler kırıldıktan sonra eşyalar hemen belirmez, sonra da
 * yere düşerken biraz savrulurlar. Tek seferlik bakmak yetmiyordu — bu yüzden
 * "hiç eşya kalmayana kadar" birkaç tur atıyoruz.
 */
async function dusenleriTopla (bot, merkez, kontrol, { yaricap = 12, maksTur = 6 } = {}) {
  let toplanan = 0
  let bosTur = 0

  for (let tur = 0; tur < maksTur && bosTur < 2; tur++) {
    kontrol.kontrolEt()

    const esyalar = yerdekiEsyalar(bot, merkez, yaricap)
    if (esyalar.length === 0) {
      bosTur++
      await kontrol.bekle(600) // biraz daha bekle, belki düşmemiştir
      continue
    }

    bosTur = 0

    for (const esya of esyalar) {
      kontrol.kontrolEt()
      if (!esya.isValid) continue // bu arada toplanmış olabilir

      const p = esya.position
      const git = await pathfinderGit(bot, new goals.GoalNear(p.x, p.y, p.z, 0),
        kontrol, { zamanAsimi: 6000, durgunlukMs: 2500 })
      if (git.ok) toplanan++
    }

    await kontrol.bekle(400)
  }

  return toplanan
}

/**
 * Tek bir ağaç keser.
 * @param {object} kontrol GorevKontrol nesnesi (iptal için)
 */
async function chopTree (bot, kontrol, { karaListe = null } = {}) {
  const baslangicOdun = oduncuSay(bot)
  kontrol.kontrolEt()

  // --- 1) En yakın DOĞAL ağacı bul (oyuncunun yapıları hariç) ---
  const hedef = enYakinDogalAgac(bot, config.searchRadius, karaListe)

  if (!hedef) {
    log.uyari(`${config.searchRadius} blok içinde doğal ağaç bulamadım.`)
    return { basarili: false, kesilen: 0, kazanilanOdun: 0, hata: 'agac_yok' }
  }

  log.bilgi(`Ağaç bulundu: ${hedef.name} @ ${hedef.position}`)

  // --- 2) Ağacın tamamını topla ---
  const kutukler = agaciTopla(bot, hedef, config.maxLogsPerTree)
  log.bilgi(`Bu ağaçta ${kutukler.length} kütük var.`)

  // --- 3) Ağacın dibine yürü ---
  const dip = kutukler[0].position
  const dibeGit = await pathfinderGit(bot, new goals.GoalNear(dip.x, dip.y, dip.z, 2),
    kontrol, { zamanAsimi: 20000, durgunlukMs: 4000 })
  if (!dibeGit.ok) {
    // Dibine yürüyemedik. ESKİDEN yine de denerdik: bot 20 saniye
    // uzaktan uzanmaya çalışır, başaramaz, sonra AYNI ağacı tekrar
    // seçerdi. Artık uzaklığa bakıyoruz — hâlâ menzil dışındaysak bu
    // ağaç bize göre değil, kara listeye yazıp bir sonrakine geçiyoruz.
    const uzaklik = bot.entity.position.distanceTo(dip)
    if (uzaklik > 6) {
      if (karaListe) karaListe.add(`${dip.x},${dip.y},${dip.z}`)
      log.uyari(`Ağacın dibine ulaşamadım (${uzaklik.toFixed(0)} blok uzakta), başka ağaca geçiyorum.`)
      return { basarili: false, kesilen: 0, kazanilanOdun: 0, hata: 'ulasilamadi' }
    }
    log.uyari('Ağacın dibine tam yürüyemedim — yine de deneyeceğim.')
  }

  // --- 4) Kütükleri kır ---
  //
  // Üç kademeli deneme. Eskiden sadece ilk ikisi vardı ve üçüncüsü
  // olmadığı için ağacın TEPESİ hep ayakta kalıyordu:
  //
  //   a) Kolumun altındaysa doğrudan kır          (en hızlı)
  //   b) Değilse yürüyerek yanına git, kır        (pathfinder)
  //   c) O da olmuyorsa ve blok YUKARIDAYSA:      (yeni)
  //      altıma blok koya koya yukarı çık, sonra kır
  //
  // Sonra ikinci bir tur atıyoruz: ilk turda ulaşılamayan bloklar,
  // aradaki kütükler kırıldıktan sonra çoğu zaman ulaşılabilir hale
  // geliyor (görüş açılıyor, dallar iniyor).

  const zeminY = Math.floor(bot.entity.position.y)
  let kesilen = 0
  let sutunKuruldu = false

  /** Göz hizasından bloğun MERKEZİNE olan gerçek uzaklık */
  function erisimMesafesi (blok) {
    const goz = bot.entity.position.offset(0, bot.entity.height || 1.62, 0)
    return goz.distanceTo(blok.position.offset(0.5, 0.5, 0.5))
  }

  function elimdeMi (blok) {
    return erisimMesafesi(blok) <= 4.4 && bot.canDigBlock(blok)
  }

  async function kutuguKir (konum, sutunaIzinVar) {
    const guncel = bot.blockAt(konum)
    if (!kutukMu(guncel)) return 'zaten_yok'

    await aletKusan(bot, guncel) // baltayla kesmek ~8 kat hızlı

    // (a) elimizin altında
    if (elimdeMi(guncel)) {
      await bot.lookAt(guncel.position.offset(0.5, 0.5, 0.5), true)
      await sinirli(bot.dig(guncel), 15000, kontrol)
      return 'kirildi'
    }

    // (b) yürüyerek yaklaş
    //
    // Blok 3+ blok yukarıdaysa pathfinder'a KISA süre veriyoruz. Sebebi:
    // havada duracak zemin olmadığı için orada zaten yol bulamayacak, ama
    // aramayı 12 saniye boyunca sürdürüyor. Test kaydında 7 kütüklük bir
    // ağaç 54 saniye sürmüştü — süre bu boşa aramalarda gidiyordu.
    // Kısa deneyip (c)'ye, yani sütuna geçmek hem daha hızlı hem doğru.
    const yukarida = konum.y - Math.floor(bot.entity.position.y) >= 3
    const yaklas = await pathfinderGit(bot,
      new goals.GoalLookAtBlock(konum, bot.world, { range: 4 }),
      kontrol, { zamanAsimi: yukarida ? 4000 : 12000, durgunlukMs: 3000 })
    if (yaklas.ok) {
      kontrol.kontrolEt()
      const b = bot.blockAt(konum)
      if (kutukMu(b) && bot.canDigBlock(b)) {
        await sinirli(bot.dig(b), 15000, kontrol)
        return 'kirildi'
      }
    }

    // (c) yukarıdaysa sütun ör
    if (sutunaIzinVar && konum.y - Math.floor(bot.entity.position.y) >= 2) {
      // Kütüğün 2 blok altına çıkarsak göz hizası tam ona bakar
      const cikis = await sutunaCik(bot, konum.y - 2, kontrol)
      if (cikis.cikilan > 0) sutunKuruldu = true

      const b = bot.blockAt(konum)
      if (kutukMu(b) && elimdeMi(b)) {
        await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true)
        await sinirli(bot.dig(b), 15000, kontrol)
        return 'kirildi'
      }
      if (!cikis.ok) return `sutun_olmadi:${cikis.sebep || '?'}`
    }

    return 'ulasilamadi'
  }

  const kacirilan = []

  for (const kutuk of kutukler) {
    kontrol.kontrolEt()
    try {
      const sonuc = await kutuguKir(kutuk.position, true)
      if (sonuc === 'kirildi') kesilen++
      else if (sonuc !== 'zaten_yok') kacirilan.push(kutuk.position)
    } catch (err) {
      if (err instanceof IptalEdildi) {
        pathfinderDurdur(bot); bot.stopDigging(); throw err
      }
      log.uyari(`Bir kütüğü kesemedim (${err.message}) — devam ediyorum.`)
      kacirilan.push(kutuk.position)
    }
  }

  // Sütun örmüşsek in — hem blokları geri alıyoruz hem de ikinci turu
  // yerden yapmak daha güvenli
  if (sutunKuruldu) {
    try { await sutundanIn(bot, zeminY, kontrol) } catch (err) {
      if (err instanceof IptalEdildi) throw err
    }
    sutunKuruldu = false
  }

  // --- 4b) İKİNCİ TUR: ilk turda ulaşılamayanlar ---
  // Bu tur olmadan botun ağacın ortasını kesip kökü ve tepesini
  // bırakması normaldi: ilk denemede görüş kapalıydı, sonra açıldı.
  const halaDuran = kacirilan.filter((p) => kutukMu(bot.blockAt(p)))
  if (halaDuran.length > 0) {
    log.bilgi(`${halaDuran.length} kütüğe ilk turda ulaşamadım, tekrar deniyorum.`)
    for (const konum of halaDuran) {
      kontrol.kontrolEt()
      try {
        if (await kutuguKir(konum, true) === 'kirildi') kesilen++
      } catch (err) {
        if (err instanceof IptalEdildi) {
          pathfinderDurdur(bot); bot.stopDigging(); throw err
        }
      }
    }
    if (sutunKuruldu) {
      try { await sutundanIn(bot, zeminY, kontrol) } catch (err) {
        if (err instanceof IptalEdildi) throw err
      }
    }
  }

  const kalan = kutukler.filter((k) => kutukMu(bot.blockAt(k.position))).length
  if (kalan > 0) log.uyari(`${kalan} kütüğe hiç ulaşamadım.`)

  // --- 5) Düşen odunları topla ---
  if (kesilen > 0) {
    await kontrol.bekle(1000) // eşyaların belirip yere düşmesini bekle
    await dusenleriTopla(bot, dip, kontrol)
  }

  if (kesilen === 0 && karaListe) karaListe.add(`${dip.x},${dip.y},${dip.z}`)

  // Envanter dışarıdan boşaltılmış olabilir (/clear); negatif kazanç
  // "odun topladık" sayılmamalı ama hata da değil.
  const kazanilanOdun = Math.max(0, oduncuSay(bot) - baslangicOdun)
  log.basari(`${kesilen} kütük kesildi, envantere +${kazanilanOdun} odun girdi.`)

  return { basarili: kesilen > 0, kesilen, kazanilanOdun }
}

/**
 * Birden fazla ağaç keser.
 * @param {number} adet kaç ağaç kesilsin (Infinity = "dur" denene kadar)
 */
async function chopTrees (bot, kontrol, adet = 1) {
  let toplamKesilen = 0
  let toplamOdun = 0
  let agac = 0

  // Bütün turlar boyunca PAYLAŞILAN kara liste. Ulaşılamayan bir ağaç
  // bir kez işaretlenince tekrar seçilmiyor.
  const karaListe = new Set()
  let ustUsteBasarisiz = 0

  while (agac < adet) {
    kontrol.kontrolEt()

    const sonuc = await chopTree(bot, kontrol, { karaListe })
    if (!sonuc.basarili) {
      // Ağaç kalmadıysa daha fazla dönmenin anlamı yok
      if (sonuc.hata === 'agac_yok') break
      // Peş peşe ulaşılamıyorsa buradan kesecek ağaç yok demektir
      if (++ustUsteBasarisiz >= 5) {
        log.uyari('Ulaşabildiğim ağaç kalmadı.')
        break
      }
    } else {
      ustUsteBasarisiz = 0
    }

    toplamKesilen += sonuc.kesilen
    toplamOdun += sonuc.kazanilanOdun
    agac++

    if (agac < adet) await kontrol.bekle(300)
  }

  return { agac, kesilen: toplamKesilen, kazanilanOdun: toplamOdun }
}

module.exports = {
  chopTree,
  chopTrees,
  oduncuSay,
  kutukMu,
  dogalAgacMi,
  enYakinDogalAgac,
  agaciTopla,
  dusenleriTopla,
  govdeninDibi
}
