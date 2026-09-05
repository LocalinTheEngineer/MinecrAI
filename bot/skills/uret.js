'use strict'

const log = require('../utils/log')
const { tezgahKoy } = require('./alet')
const { erit, eritmeGirdisi, yakitBul } = require('./erit')

/**
 * Skill: craft ("uret taş kazma").
 *
 * `baltaYap` hardcoded the recipe of one item: log -> planks -> stick ->
 * table -> axe, five steps fixed in code. A pickaxe needed the same again, a
 * shovel the same again: every new item meant a new function.
 *
 * This file generalises it. Name the item and the recipe tree gets resolved
 * here. "taş kazma" expands to:
 *
 *   stone pickaxe  <- 3 stone + 2 sticks
 *     stick        <- 2 planks   (crafted if missing)
 *       planks     <- 1 log      (crafted if missing)
 *     stone        <- must be in the inventory (mined, not crafted)
 *
 * Recursive: it calls itself for every missing intermediate. Adding an item
 * takes no code, only an entry in Minecraft's recipe table.
 */

// Turkish -> Minecraft name. The user types "taş kazma", not "stone_pickaxe".
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

// Single-piece items that are not tools
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
 * "taş kazma" -> "stone_pickaxe", "çubuk" -> "stick".
 * Input already written as a Minecraft name passes through unchanged.
 */
function adiCoz (girdi) {
  const kelimeler = String(girdi).toLowerCase().trim().split(/\s+/)

  // already a Minecraft name? ("stone_pickaxe")
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

// Raw materials obtainable by mining or chopping. Has to stay in sync with
// what the supplier can actually fetch.
const TOPLANABILIR = /_log$|_stem$|^cobblestone$|^stone$|^deepslate$|_ore$|^raw_|^coal$|^diamond$|^redstone$|^lapis_lazuli$|^emerald$/

/**
 * How plausible is it to obtain this material?
 *
 * Exists because of a concrete failure: the bot said it could not make an
 * iron pickaxe, missing stripped_birch_log. Planks have four recipes:
 *
 *     birch_planks <- birch_log
 *     birch_planks <- birch_wood
 *     birch_planks <- stripped_birch_log      <-- this is the one it picked
 *     birch_planks <- stripped_birch_wood
 *
 * All four are valid, but stripped logs do not generate in the world, you
 * strip a log with an axe. The bot reported it as uncollectable and gave up
 * while the plain log recipe two lines above would have worked.
 *
 * The old code scored a recipe only on "do I already hold the material". With
 * nothing in the inventory all four scored zero and the order was arbitrary.
 * Now "how would I get it if I do not have it" is scored too.
 */
function malzemePuani (bot, mcData, isim, derinlik = 0) {
  if (sayim(bot, isim) > 0) return 4 // already have it, best case
  if (isim.startsWith('stripped_')) return -4 // not natural, stripped by hand
  if (/_wood$|_hyphae$/.test(isim)) return -2 // costs 6 logs, wasteful
  if (TOPLANABILIR.test(isim)) return 3 // mined or chopped
  if (eritmeGirdisi(isim)) return 1 // smeltable

  const e = mcData.itemsByName[isim]
  if (!e) return -3
  const tarifler = bot.recipesAll(e.id, null, true)
  if (tarifler.length === 0) return -3 // dead end

  // Look one level deeper.
  //
  // Without it the bot got stuck like this: a stick needs planks, and planks
  // have 11 variants (oak, birch, cherry...). With none in the inventory they
  // all score the same and the first in the list, oak, wins. Meanwhile the
  // inventory holds a cherry log: cherry planks are one step away, oak planks
  // impossible.
  //
  // At one level both look craftable. At two levels the difference shows up:
  // the cherry ingredient is on hand.
  if (derinlik >= 2) return 1

  let enIyi = 1
  for (const t of tarifler.slice(0, 8)) {
    const { girdi } = tarifGirdileri(mcData, t)
    const isimler = Object.keys(girdi)
    if (isimler.length === 0) continue
    const enZayif = Math.min(
      ...isimler.map((x) => malzemePuani(bot, mcData, x, derinlik + 1))
    )
    // a recipe is only as good as its weakest ingredient
    if (enZayif >= 4) enIyi = Math.max(enIyi, 3) // ingredients on hand
    else if (enZayif >= 3) enIyi = Math.max(enIyi, 2) // collectable
  }
  return enIyi
}

/** How many of this item the inventory holds */
function sayim (bot, ad) {
  return bot.inventory.items()
    .filter((i) => i.name === ad)
    .reduce((t, i) => t + i.count, 0)
}

/** A crafting table nearby, placing one if needed */
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
 * Recipe inputs as {name: count}.
 *
 * mineflayer keeps a recipe in a `delta` array: negative counts are consumed,
 * the positive one is produced. inShape/ingredients change format from recipe
 * to recipe, so delta is the only reliable thing to read.
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
 * Smelting attempt: supply the raw material, the furnace and the fuel, then
 * smelt. Used both by the "try smelting first" shortcut and by step B.
 */
async function eritmeyiDene (bot, mcData, ad, adet, kontrol, altSaglama) {
  const hamMadde = eritmeGirdisi(ad)
  if (!hamMadde) return { ok: false }

  const eksik = adet - sayim(bot, ad)

  const ham = await altSaglama(hamMadde, eksik)
  if (!ham.ok) return { ok: false, hata: ham }

  // a furnace is crafted too, so it goes through its own recipe tree
  const f = await altSaglama('furnace', 1)
  if (!f.ok) return { ok: false, hata: f }

  // Fuel. This check used to be `if (!yakitBul(...))`, which never fired:
  // the old yakitBul returned a truthy value even when the fuel could not
  // finish the job, and the bot almost always holds planks. It would then
  // under-fuel the furnace, wait out the timeout and report failure.
  const yakit = yakitBul(bot, eksik)
  if (!yakit || !yakit.yeterli) {
    const gereken = Math.max(1, Math.ceil((eksik - (yakit?.pisebilecek || 0)) / 8))
    await altSaglama('coal', gereken)
  }

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
    // Several rounds.
    //
    // The bot used to report that spruce_log could not be collected. A stick
    // has ~12 recipes, one per plank variant. With an empty inventory they all
    // score the same, so it picked one at random, spruce, and kept insisting,
    // while the forest around it was oak.
    //
    // The first round triggers the supplier ("I need logs") and the supplier
    // brings back whatever it finds (oak). The second round rescores the
    // recipes: with an oak log in hand the oak recipe gets +4, moves to the
    // front and the chain continues. The tree species is not guessed, it is
    // read off what the forest actually gave.
    //
    // Supply counter: did anything get collected this round, sub-branches
    // included? Each frame used to look only at its own supply call, but the
    // "stick" frame never supplies anything itself, that happens in its
    // descendants (planks > log). Blind to it, the stick frame concluded
    // "tried all 12 recipes, none worked" and gave up, even though an oak log
    // had arrived in the meantime and the oak recipe would now work. A shared
    // counter makes it visible.
    const durum = secenekler._durum || (secenekler._durum = { tedarik: 0 })

    for (let tur = 0; tur < 3; tur++) {
      const turBasiTedarik = durum.tedarik
      // ---- try smelting first ----
      //
      // An iron ingot also has crafting-table recipes: 9 from an iron block,
      // 9 from nuggets. Both are made out of ingots, so both are dead ends,
      // but they show up in the recipe list and the bot tried them first and
      // recursed for nothing. If the raw material is already in the inventory
      // the furnace is the short path, go straight there.
      const hamElde = eritmeGirdisi(ad)
      if (hamElde && sayim(bot, hamElde) > 0) {
        const hizli = await eritmeyiDene(bot, mcData, ad, adet, kontrol, altSaglama)
        if (hizli.ok) return { ok: true }
        sonHata = hizli.hata || sonHata
      }

      // ================= A) craft on a table =================
      //
      // For planning, recipes are queried as if a table were there (third
      // argument true). mineflayer's `recipesAll(id, meta, table)` drops 3x3
      // recipes from the list when no table is passed. A stone pickaxe is
      // 3x3, so asking without a table returned an empty list and it looked
      // uncraftable. Chicken and egg: getting a table needed the recipe,
      // seeing the recipe needed a table. Plan as if the table were there,
      // then really craft and place it right before crafting.
      const tarifler = bot.recipesAll(esya.id, null, true)

      // Try the recipe that best matches the inventory first: one item has
      // many variants (oak planks, birch planks...), pick the matching one.
      const sirali = tarifler
        .map((t) => {
          const { girdi } = tarifGirdileri(mcData, t)
          const isimler = Object.keys(girdi)
          const puan = isimler
            .reduce((toplam, isim) => toplam + malzemePuani(bot, mcData, isim), 0)
          return { t, puan }
        })
        .sort((a, b) => b.puan - a.puan)
        .slice(0, 6) // was 3: planks have 4 variants and the good one fell off the list
        .map((x) => x.t)

      for (const tarif of sirali) {
        kontrol.kontrolEt()
        const { girdi, uretilen } = tarifGirdileri(mcData, tarif)
        const kere = Math.max(1, Math.ceil((adet - sayim(bot, ad)) / uretilen))

        let girdilerTamam = true
        for (const [isim, n] of Object.entries(girdi)) {
          const alt = await altSaglama(isim, n * kere)
          if (!alt.ok) {
          // Keep the error of the first, best-scoring recipe, not the last.
          // Reporting "stripped_birch_log eksik" was misleading: that was the
          // error of the last and worst recipe tried.
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

      // ================= B) smelt in a furnace =================
      //
      // An iron ingot cannot be crafted, only smelted. Without this step
      // nothing past a stone pickaxe is reachable: an iron pickaxe needs
      // ingots, ingots need a furnace. The recipe tree switches from table to
      // furnace here and the same recursion continues.
      if (eritmeGirdisi(ad)) {
        const sonuc = await eritmeyiDene(bot, mcData, ad, adet, kontrol, altSaglama)
        if (sonuc.ok) return { ok: true }
        sonHata = sonuc.hata || sonHata
      }

      // ================= C) supply from outside =================
      //
      // Neither crafted nor smelted: logs, stone, ore. Those get collected.
      // `tedarikci` is injected from outside (bot/skills/index.js); calling
      // `kaz` directly here would make kaz->uret->kaz a circular dependency.
      // So uret does not know how something is collected, only whether it
      // can be.
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

      // stop if no new material arrived anywhere, sub-branches included
      if (durum.tedarik === turBasiTedarik) break
      sonHata = null // retry from the top with the new material
    }

    return sonHata || { ok: false, eksik: ad, mesaj: 'tarif uygulanamadı' }
  } finally {
    iz.delete(ad)
  }
}

/**
 * Public entry point.
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
