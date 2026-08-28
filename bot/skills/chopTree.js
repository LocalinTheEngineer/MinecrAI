'use strict'

const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const config = require('../config')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')
const { aletKusan } = require('./alet')
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

/** En yakın DOĞAL ağacı bul (oyuncunun yapılarını atlar) */
function enYakinDogalAgac (bot, yaricap) {
  const adaylar = bot.findBlocks({
    matching: (b) => kutukMu(b), maxDistance: yaricap, count: 96
  })
  if (adaylar.length === 0) return null

  adaylar.sort((a, b) =>
    a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))

  for (const konum of adaylar) {
    const blok = bot.blockAt(konum)
    if (dogalAgacMi(bot, blok)) return blok
  }
  return null
}

/**
 * Verilen kütüğe bağlı bütün kütükleri bulur (ağacın gövdesi).
 * 3x3x3 komşulukta yayılır — dallı ağaçlarda da çalışır.
 */
function agaciTopla (bot, baslangic, limit) {
  const bulunan = []
  const gorulen = new Set()
  const kuyruk = [baslangic.position]

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

      try {
        const p = esya.position
        pathfinderHazirla(bot)
        await sinirli(
          bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 0)),
          6000,
          kontrol
        )
        toplanan++
      } catch (err) {
        if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }
        pathfinderDurdur(bot) // ulaşamadık, diğerine geç
      }
    }

    await kontrol.bekle(400)
  }

  return toplanan
}

/**
 * Tek bir ağaç keser.
 * @param {object} kontrol GorevKontrol nesnesi (iptal için)
 */
async function chopTree (bot, kontrol) {
  const baslangicOdun = oduncuSay(bot)
  kontrol.kontrolEt()

  // --- 1) En yakın DOĞAL ağacı bul (oyuncunun yapıları hariç) ---
  const hedef = enYakinDogalAgac(bot, config.searchRadius)

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
  try {
    pathfinderHazirla(bot)
    await sinirli(
      bot.pathfinder.goto(new goals.GoalNear(dip.x, dip.y, dip.z, 2)),
      20000,
      kontrol
    )
  } catch (err) {
    if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }
    pathfinderDurdur(bot)
    log.uyari('Ağacın dibine tam yürüyemedim — yine de deneyeceğim.')
  }

  // --- 4) Kütükleri kır ---
  let kesilen = 0
  for (const kutuk of kutukler) {
    kontrol.kontrolEt()

    const guncel = bot.blockAt(kutuk.position)
    if (!kutukMu(guncel)) continue // araya bir şey girmişse atla

    try {
      await aletKusan(bot, guncel) // baltayla kesmek çok daha hızlı
      const mesafe = bot.entity.position.distanceTo(guncel.position)

      if (mesafe < 4.5 && bot.canDigBlock(guncel)) {
        // Elimizin altında: doğrudan kır (hızlı yol)
        await bot.lookAt(guncel.position.offset(0.5, 0.5, 0.5), true)
        await sinirli(bot.dig(guncel), 15000, kontrol)
      } else {
        // Uzakta: önce yaklaş, sonra kır
        await sinirli(
          bot.pathfinder.goto(new goals.GoalLookAtBlock(guncel.position, bot.world, { range: 4 })),
          15000,
          kontrol
        )
        kontrol.kontrolEt()
        await sinirli(bot.dig(bot.blockAt(guncel.position)), 15000, kontrol)
      }
      kesilen++
    } catch (err) {
      if (err instanceof IptalEdildi) {
        pathfinderDurdur(bot)
        bot.stopDigging()
        throw err
      }
      log.uyari(`Bir kütüğü kesemedim (${err.message}) — devam ediyorum.`)
    }
  }

  // --- 5) Düşen odunları topla ---
  if (kesilen > 0) {
    await kontrol.bekle(1000) // eşyaların belirip yere düşmesini bekle
    await dusenleriTopla(bot, dip, kontrol)
  }

  const kazanilanOdun = oduncuSay(bot) - baslangicOdun
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

  while (agac < adet) {
    kontrol.kontrolEt()

    const sonuc = await chopTree(bot, kontrol)
    if (!sonuc.basarili) {
      // Ağaç kalmadıysa daha fazla dönmenin anlamı yok
      if (sonuc.hata === 'agac_yok') break
    }

    toplamKesilen += sonuc.kesilen
    toplamOdun += sonuc.kazanilanOdun
    agac++

    if (agac < adet) await kontrol.bekle(300)
  }

  return { agac, kesilen: toplamKesilen, kazanilanOdun: toplamOdun }
}

module.exports = {
  chopTree, chopTrees, oduncuSay, kutukMu, dogalAgacMi, enYakinDogalAgac,
  agaciTopla, dusenleriTopla
}
