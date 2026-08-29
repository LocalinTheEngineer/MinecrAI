'use strict'

const Vec3 = require('vec3')
const log = require('../utils/log')
const { tezgahKoy } = require('./alet')

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
  tahta: 'wooden', ahsap: 'wooden', ahşap: 'wooden', odun: 'wooden',
  tas: 'stone', taş: 'stone',
  demir: 'iron', altin: 'golden', altın: 'golden',
  elmas: 'diamond', netherit: 'netherite', netherite: 'netherite'
}

const ALETLER = {
  kazma: 'pickaxe', balta: 'axe', kurek: 'shovel', kürek: 'shovel',
  kilic: 'sword', kılıç: 'sword', capa: 'hoe', çapa: 'hoe'
}

// Alet olmayan, tek parça eşyalar
const ESYALAR = {
  tahta: 'oak_planks', cubuk: 'stick', çubuk: 'stick',
  tezgah: 'crafting_table', tezgâh: 'crafting_table', masa: 'crafting_table',
  firin: 'furnace', fırın: 'furnace',
  sandik: 'chest', sandık: 'chest',
  mesale: 'torch', meşale: 'torch',
  merdiven: 'ladder', kapi: 'oak_door', kapı: 'oak_door',
  kova: 'bucket', makas: 'shears'
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

/** Envanterde bu addan kaç tane var */
function sayim (bot, ad) {
  return bot.inventory.items()
    .filter((i) => i.name === ad)
    .reduce((t, i) => t + i.count, 0)
}

/** Yakında masa var mı, yoksa koyabilir miyiz */
async function masaBul (bot, mcData) {
  let masa = bot.findBlock({
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
 * `adet` tane `ad` envanterde olsun. Yoksa üret, ara malzeme eksikse
 * onu da üret. Üretilemeyen bir temel malzemede (kütük, taş, cevher)
 * dürüstçe pes edip NE eksik olduğunu söylüyor.
 */
async function saglamaAl (bot, mcData, ad, adet, kontrol, iz = new Set(), derinlik = 0) {
  kontrol.kontrolEt()

  const mevcut = sayim(bot, ad)
  if (mevcut >= adet) return { ok: true }

  if (derinlik > 6) return { ok: false, eksik: ad, mesaj: 'tarif ağacı çok derin' }
  if (iz.has(ad)) return { ok: false, eksik: ad, mesaj: 'döngüsel tarif' }

  const esya = mcData.itemsByName[ad]
  if (!esya) return { ok: false, eksik: ad, mesaj: `"${ad}" diye bir eşya tanımıyorum` }

  // PLANLAMA için tarifleri masa VARMIŞ GİBİ soruyoruz (üçüncü argüman true).
  //
  // mineflayer'ın `recipesAll(id, meta, masa)` fonksiyonu, masa verilmezse
  // 3x3 tarifleri listeden ELİYOR:
  //     if (!recipe.requiresTable || craftingTable) results.push(recipe)
  // Taş kazma 3x3'tür. Elinde masa yokken sorunca boş liste dönüyor, biz de
  // "stone_pickaxe üretilemiyor" diyorduk — oysa üretilebilir, sadece önce
  // masa gerekiyordu. Klasik tavuk-yumurta: masayı almak için tarifi bilmen,
  // tarifi görmek için masan olması lazımdı.
  //
  // Çözüm: planlarken masa varmış gibi bak, GERÇEKTEN kırmadan hemen önce
  // (aşağıda `tarif.requiresTable`) masayı üret ve yere koy.
  const tarifler = bot.recipesAll(esya.id, null, true)
  if (tarifler.length === 0) {
    // Üretilemiyor: kazılan/toplanan/eritilen bir temel malzeme
    return { ok: false, eksik: ad, mesaj: `${ad} tezgahta üretilemiyor, bulunması gerekiyor` }
  }

  // Envanterdekine en çok uyan tarifi önce dene. Minecraft'ta aynı eşyanın
  // birçok varyantı var (meşe tahtası, huş tahtası...); elimizde ne varsa
  // ona uyanı seçmek gerekiyor.
  const sirali = tarifler
    .map((t) => {
      const { girdi } = tarifGirdileri(mcData, t)
      const puan = Object.entries(girdi)
        .filter(([isim, n]) => sayim(bot, isim) >= n).length
      return { t, puan }
    })
    .sort((a, b) => b.puan - a.puan)
    .slice(0, 4)
    .map((x) => x.t)

  iz.add(ad)
  let sonHata = null

  for (const tarif of sirali) {
    kontrol.kontrolEt()
    const { girdi, uretilen } = tarifGirdileri(mcData, tarif)
    const kere = Math.ceil((adet - sayim(bot, ad)) / uretilen)

    // Girdileri sırayla sağla
    let girdilerTamam = true
    for (const [isim, n] of Object.entries(girdi)) {
      const alt = await saglamaAl(bot, mcData, isim, n * kere, kontrol, iz, derinlik + 1)
      if (!alt.ok) { sonHata = alt; girdilerTamam = false; break }
    }
    if (!girdilerTamam) continue

    // 3x3 tarif ise masa şart — masayı da (gerekirse) üretiyoruz
    let kullanilacakMasa = null
    if (tarif.requiresTable) {
      const m = await saglamaAl(bot, mcData, 'crafting_table', 1, kontrol, iz, derinlik + 1)
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
      iz.delete(ad)
      return { ok: true }
    } catch (err) {
      sonHata = { ok: false, eksik: ad, mesaj: err.message }
    }
  }

  iz.delete(ad)
  return sonHata || { ok: false, eksik: ad, mesaj: 'tarif uygulanamadı' }
}

/**
 * Dışarıya açılan komut.
 * @param {string} istek "taş kazma", "çubuk", "stone_pickaxe"
 */
async function uret (bot, kontrol, istek, adet = 1) {
  const mcData = require('minecraft-data')(bot.version)
  const ad = adiCoz(istek)

  if (!mcData.itemsByName[ad]) {
    return { basarili: false, mesaj: `"${istek}" neydi bilmiyorum (${ad} diye aradım).` }
  }

  const oncesi = sayim(bot, ad)
  const sonuc = await saglamaAl(bot, mcData, ad, oncesi + adet, kontrol)

  if (!sonuc.ok) {
    return {
      basarili: false,
      mesaj: `${ad} yapamadım — ${sonuc.mesaj}. Eksik olan: ${sonuc.eksik}.`
    }
  }

  const kazanilan = sayim(bot, ad) - oncesi
  return { basarili: true, mesaj: `${kazanilan}x ${ad} hazır.`, ad, adet: kazanilan }
}

module.exports = { uret, adiCoz, saglamaAl, sayim }
