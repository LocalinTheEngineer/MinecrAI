'use strict'

/**
 * SKILL: Alet seçimi, kuşanma ve craft'lama.
 *
 * Neden önemli: bot ağacı ELİYLE kesince kütük başına ~3-4 saniye harcıyor.
 * Balta ile bu ~0.4 saniyeye iniyor. Yani bölümler ~8 kat kısalıyor ve aynı
 * sürede 8 kat fazla eğitim verisi topluyoruz. Bu bir "ekstra özellik" değil,
 * doğrudan eğitim hızlandırıcı.
 *
 * Tasarım notu: kuşanma ajanın ÖĞRENMESİ GEREKEN bir aksiyon değil, otomatik
 * yapılıyor — tıpkı dikey nişan gibi. Her Minecraft oyuncusunun refleks olarak
 * yaptığı, içinde öğrenilecek bir karar barındırmayan iş. Ajanın öğreneceği
 * şey navigasyon ve ne zaman kıracağı olarak kalıyor.
 */

const log = require('../utils/log')

// İyiden kötüye — envanterde birden fazla varsa en iyisi seçilsin
const MALZEME_SIRASI = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden']

function malzemePuani (isim) {
  const i = MALZEME_SIRASI.findIndex((m) => isim.startsWith(m + '_'))
  return i === -1 ? 99 : i
}

/** Bu blok için hangi alet tipi uygun? */
function aletTipi (blok) {
  if (!blok) return null
  if (/_log$|_stem$|_wood$|planks$|_door$|crafting_table|chest/.test(blok.name)) return '_axe'
  if (/stone|ore$|deepslate|granite|diorite|andesite|cobble|obsidian/.test(blok.name)) return '_pickaxe'
  if (/dirt|grass_block|sand|gravel|clay|podzol|mycelium|soul_/.test(blok.name)) return '_shovel'
  return null
}

/** Envanterdeki en iyi uygun aleti bul (yoksa null) */
function uygunAlet (bot, blok) {
  const tip = aletTipi(blok)
  if (!tip) return null

  const adaylar = bot.inventory.items().filter((i) => i.name.endsWith(tip))
  if (adaylar.length === 0) return null

  adaylar.sort((a, b) => malzemePuani(a.name) - malzemePuani(b.name))
  return adaylar[0]
}

/**
 * Bloğa uygun aleti eline al. Zaten doğru alet elindeyse hiçbir şey yapmaz.
 * @returns {Promise<boolean>} kuşanma yapıldı mı
 */
async function aletKusan (bot, blok) {
  const alet = uygunAlet(bot, blok)
  if (!alet) return false

  const eldeki = bot.heldItem
  if (eldeki && eldeki.type === alet.type) return false // zaten elimde

  try {
    await bot.equip(alet, 'hand')
    return true
  } catch (err) {
    log.uyari(`Alet kuşanamadım (${err.message})`)
    return false
  }
}

// ---------------------------------------------------------------- craft

function envanterdeVarMi (bot, desen) {
  return bot.inventory.items().find((i) => desen.test(i.name)) || null
}

function tarifBul (bot, esyaAdi, masa = null) {
  const mcData = require('minecraft-data')(bot.version)
  const esya = mcData.itemsByName[esyaAdi]
  if (!esya) return null
  const tarifler = bot.recipesFor(esya.id, null, 1, masa)
  return tarifler.length > 0 ? tarifler[0] : null
}

/**
 * Sıfırdan tahta balta yapar: kütük -> tahta -> çubuk -> tezgah -> balta.
 *
 * Adım adım ilerler ve her adımda zaten yapılmış olanı atlar, yani yarıda
 * kalıp tekrar çağrılırsa kaldığı yerden devam eder.
 */
async function baltaYap (bot) {
  const mcData = require('minecraft-data')(bot.version)

  if (envanterdeVarMi(bot, /_axe$/)) {
    return { basarili: true, mesaj: 'Zaten baltam var.' }
  }

  // --- 1) Tahta (planks) ---
  let tahta = envanterdeVarMi(bot, /_planks$/)
  if (!tahta || tahta.count < 5) {
    const kutuk = envanterdeVarMi(bot, /_log$|_stem$/)
    if (!kutuk) return { basarili: false, mesaj: 'Odunum yok, önce ağaç kesmem lazım.' }

    // Kütüğün karşılığı olan tahta: oak_log -> oak_planks
    const tahtaAdi = kutuk.name.replace(/_log$|_stem$/, '_planks')
    const tarif = tarifBul(bot, tahtaAdi)
    if (!tarif) return { basarili: false, mesaj: `${tahtaAdi} tarifini bulamadım.` }

    try {
      await bot.craft(tarif, 2, null) // 2 kütük -> 8 tahta
    } catch (err) {
      return { basarili: false, mesaj: `Tahta yapamadım: ${err.message}` }
    }
    tahta = envanterdeVarMi(bot, /_planks$/)
  }

  // --- 2) Çubuk (stick) ---
  if (!envanterdeVarMi(bot, /^stick$/)) {
    const tarif = tarifBul(bot, 'stick')
    if (!tarif) return { basarili: false, mesaj: 'Çubuk tarifini bulamadım.' }
    try {
      await bot.craft(tarif, 1, null)
    } catch (err) {
      return { basarili: false, mesaj: `Çubuk yapamadım: ${err.message}` }
    }
  }

  // --- 3) Tezgah (crafting table) ---
  // Balta 3x3 tarif; envanterin 2x2 gridi yetmiyor, tezgah şart.
  if (!envanterdeVarMi(bot, /^crafting_table$/)) {
    const tarif = tarifBul(bot, 'crafting_table')
    if (!tarif) return { basarili: false, mesaj: 'Tezgah tarifini bulamadım.' }
    try {
      await bot.craft(tarif, 1, null)
    } catch (err) {
      return { basarili: false, mesaj: `Tezgah yapamadım: ${err.message}` }
    }
  }

  // --- 4) Tezgahı yere koy ---
  let masa = bot.findBlock({
    matching: mcData.blocksByName.crafting_table.id, maxDistance: 4
  })

  if (!masa) {
    const yerlestirildi = await tezgahKoy(bot)
    if (!yerlestirildi) {
      return { basarili: false, mesaj: 'Tezgahı koyacak düz yer bulamadım.' }
    }
    masa = bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id, maxDistance: 4
    })
  }

  // --- 5) Balta ---
  const tahtaAdi = (envanterdeVarMi(bot, /_planks$/) || {}).name || 'oak_planks'
  const baltaAdi = tahtaAdi.replace('_planks', '') + '_axe'
  // Vanilla'da tahta baltanın adı tek: wooden_axe
  const tarif = tarifBul(bot, 'wooden_axe', masa) || tarifBul(bot, baltaAdi, masa)
  if (!tarif) return { basarili: false, mesaj: 'Balta tarifini bulamadım.' }

  try {
    await bot.craft(tarif, 1, masa)
  } catch (err) {
    return { basarili: false, mesaj: `Balta yapamadım: ${err.message}` }
  }

  return { basarili: true, mesaj: 'Tahta balta hazır, artık daha hızlı keseceğim.' }
}

/**
 * Tezgahı yere koyar.
 *
 * Eskiden burada yanındaki 6 sabit noktaya bakan naif bir arama vardı ve
 * dar bir yerde "koyacak yer bulamadım" deyip pes ediyordu. Artık ortak
 * yerleştirici kullanılıyor: geniş arama + gerekirse bir bloğu kırıp
 * yer açma. Aynı kod fırın için de çalışıyor.
 */
async function tezgahKoy (bot, kontrol = null) {
  const { blokKoy } = require('../utils/yerlestir')
  return !!(await blokKoy(bot, 'crafting_table', kontrol))
}

module.exports = { uygunAlet, aletKusan, aletTipi, baltaYap, tezgahKoy }
