'use strict'

/**
 * SKILL: tool selection, equipping and crafting.
 *
 * Chopping by hand costs ~3-4 seconds per log; with an axe it drops to ~0.4s.
 * Episodes get ~8x shorter, so the same wall clock produces 8x more training
 * data. This is a training-speed lever, not a nice-to-have.
 *
 * Equipping is automatic, not an action the agent has to learn — same as
 * vertical aim. Every Minecraft player does it by reflex and there is no
 * decision in it. What the agent learns stays navigation and when to break.
 */

const log = require('../utils/log')

// Best to worst, so the best one wins when the inventory holds several
const MALZEME_SIRASI = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden']

function malzemePuani (isim) {
  const i = MALZEME_SIRASI.findIndex((m) => isim.startsWith(m + '_'))
  return i === -1 ? 99 : i
}

/** Which tool type fits this block? */
function aletTipi (blok) {
  if (!blok) return null

  // Primary source is the game's own data.
  //
  // This was a hand-written regex list and it missed 439 blocks in 1.20.4,
  // among them `tuff`, `calcite`, `smooth_basalt`, `amethyst_block` and
  // `dripstone_block` — blocks that are everywhere in y=15 caves.
  //
  // Measured effect: in the mining task the expert broke nothing across 4
  // episodes, 56% of its steps fell into the "solid block ahead but no tool
  // for it" branch and the bot tried to walk around it forever. 0 resources,
  // 4/4 episodes ended on the no-progress cutoff.
  //
  // `minecraft-data` carries `material` per block: 'mineable/pickaxe',
  // 'mineable/shovel', 'mineable/axe'. A hand-kept list goes stale silently
  // on a version bump, which is exactly the failure above.
  const m = /^mineable\/(pickaxe|axe|shovel)$/.exec(blok.material || '')
  if (m) return '_' + m[1]

  // Fallback for fake block objects with no `material` field. Some code
  // builds them by hand, e.g. `{ name: 'iron_ore' }` for the "do I have a
  // pickaxe" check in environment.js, and so do the tests.
  if (/_log$|_stem$|_wood$|planks$|_door$|crafting_table|chest/.test(blok.name)) return '_axe'
  if (/stone|ore$|deepslate|granite|diorite|andesite|cobble|obsidian/.test(blok.name)) return '_pickaxe'
  if (/dirt|grass_block|sand|gravel|clay|podzol|mycelium|soul_/.test(blok.name)) return '_shovel'
  return null
}

/** Best matching tool in the inventory, or null */
function uygunAlet (bot, blok) {
  const tip = aletTipi(blok)
  if (!tip) return null

  const adaylar = bot.inventory.items().filter((i) => i.name.endsWith(tip))
  if (adaylar.length === 0) return null

  adaylar.sort((a, b) => malzemePuani(a.name) - malzemePuani(b.name))
  return adaylar[0]
}

/**
 * Equip the tool that fits the block. No-op if it is already in hand.
 * @returns {Promise<boolean>} whether anything was equipped
 */
async function aletKusan (bot, blok) {
  const alet = uygunAlet(bot, blok)
  if (!alet) return false

  const eldeki = bot.heldItem
  if (eldeki && eldeki.type === alet.type) return false // already in hand

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
 * Makes a wooden axe from scratch: log -> planks -> stick -> table -> axe.
 *
 * Each step skips what is already done, so a call after a half-finished run
 * continues from where it stopped.
 */
async function baltaYap (bot) {
  const mcData = require('minecraft-data')(bot.version)

  if (envanterdeVarMi(bot, /_axe$/)) {
    return { basarili: true, mesaj: 'Zaten baltam var.' }
  }

  // --- 1) Planks ---
  let tahta = envanterdeVarMi(bot, /_planks$/)
  if (!tahta || tahta.count < 5) {
    const kutuk = envanterdeVarMi(bot, /_log$|_stem$/)
    if (!kutuk) return { basarili: false, mesaj: 'Odunum yok, önce ağaç kesmem lazım.' }

    // Planks that match the log type: oak_log -> oak_planks
    const tahtaAdi = kutuk.name.replace(/_log$|_stem$/, '_planks')
    const tarif = tarifBul(bot, tahtaAdi)
    if (!tarif) return { basarili: false, mesaj: `${tahtaAdi} tarifini bulamadım.` }

    try {
      await bot.craft(tarif, 2, null) // 2 logs -> 8 planks
    } catch (err) {
      return { basarili: false, mesaj: `Tahta yapamadım: ${err.message}` }
    }
    tahta = envanterdeVarMi(bot, /_planks$/)
  }

  // --- 2) Stick ---
  if (!envanterdeVarMi(bot, /^stick$/)) {
    const tarif = tarifBul(bot, 'stick')
    if (!tarif) return { basarili: false, mesaj: 'Çubuk tarifini bulamadım.' }
    try {
      await bot.craft(tarif, 1, null)
    } catch (err) {
      return { basarili: false, mesaj: `Çubuk yapamadım: ${err.message}` }
    }
  }

  // --- 3) Crafting table ---
  // The axe is a 3x3 recipe; the 2x2 inventory grid is not enough.
  if (!envanterdeVarMi(bot, /^crafting_table$/)) {
    const tarif = tarifBul(bot, 'crafting_table')
    if (!tarif) return { basarili: false, mesaj: 'Tezgah tarifini bulamadım.' }
    try {
      await bot.craft(tarif, 1, null)
    } catch (err) {
      return { basarili: false, mesaj: `Tezgah yapamadım: ${err.message}` }
    }
  }

  // --- 4) Place the table ---
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

  // --- 5) Axe ---
  // One name, whatever the wood. Planks carry their tree (oak_planks,
  // birch_planks) and the axe does not: there is no `oak_axe`, so a fallback
  // derived from the plank name can never match anything.
  const tarif = tarifBul(bot, 'wooden_axe', masa)
  if (!tarif) return { basarili: false, mesaj: 'Balta tarifini bulamadım.' }

  try {
    await bot.craft(tarif, 1, masa)
  } catch (err) {
    return { basarili: false, mesaj: `Balta yapamadım: ${err.message}` }
  }

  return { basarili: true, mesaj: 'Tahta balta hazır, artık daha hızlı keseceğim.' }
}

/**
 * Places the crafting table.
 *
 * This used to be a naive search over 6 fixed neighbouring spots that gave up
 * with "no room" in tight places. It now uses the shared placer: wider search
 * plus breaking a block to make room. The furnace runs on the same code.
 */
async function tezgahKoy (bot, kontrol = null) {
  const { blokKoy } = require('../utils/yerlestir')
  return !!(await blokKoy(bot, 'crafting_table', kontrol))
}

module.exports = { uygunAlet, aletKusan, aletTipi, baltaYap, tezgahKoy }
