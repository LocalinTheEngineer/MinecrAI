'use strict'

const { chopTree, chopTrees, oduncuSay, kutukMu, agaciTopla, dusenleriTopla } = require('./chopTree')
const { gel } = require('./gel')
const { baltaYap, aletKusan, uygunAlet } = require('./alet')
const { takipBaslat, takipBirak, takipVarMi } = require('./takip')
const { ver } = require('./ver')
const { uret } = require('./uret')
const { kaz, kazmaSeviyesi } = require('./kaz')
const { erit } = require('./erit')
const { sutunaCik, sutundanIn, yuzeyeSutunla } = require('./sutun')

/**
 * Base material supplier.
 *
 * Resolving the recipe tree, `uret` ends up at leaves: logs, stone, iron ore.
 * Those are not crafted, they are gathered, and `kaz` and `chopTrees` know how.
 *
 * Why doesn't `uret` call them directly? Because `kaz` calls `uret` to make a
 * pickaxe. If the two files require each other, Node hands one of them a half
 * built module on the circular edge and the failure surfaces at runtime
 * somewhere unrelated. (Same reason sabitler.js sits between environment.js
 * and expert.js.)
 *
 * So `uret` does not know how to gather, only whether something is gatherable,
 * and the answer is injected from here. Dependencies stay one-way:
 * index.js -> uret, index.js -> kaz.
 */
const ESYA_KAYNAGI = {
  raw_iron: 'demir',
  iron_ore: 'demir',
  raw_gold: 'altin',
  gold_ore: 'altin',
  raw_copper: 'bakir',
  copper_ore: 'bakir',
  coal: 'komur',
  coal_ore: 'komur',
  diamond: 'elmas',
  diamond_ore: 'elmas',
  redstone: 'redstone',
  lapis_lazuli: 'lapis',
  emerald: 'zumrut',
  cobblestone: 'tas',
  stone: 'tas',
  cobbled_deepslate: 'tas',
  deepslate: 'tas'
}

/**
 * Resource class: "log", not "which kind of log".
 *
 * This is why the bot chopped trees forever. A stick has ~12 recipes, one per
 * wood type, and `uret` tried them in order:
 *
 *   spruce_planks <- spruce_log  -> supplier: chop a tree
 *   birch_planks  <- birch_log   -> supplier: chop a tree
 *   jungle_planks <- jungle_log  -> supplier: chop a tree
 *   ... 12 times
 *
 * Every time it got oak, never the requested type, moved on to the next recipe
 * and chopped again. The log showed it: a single "uret tas kazma" command
 * felled 4 trees and still was not done.
 *
 * Fix: the supplier keys on the resource class, not the item name. Once it has
 * fetched wood it does not chop again for the rest of the command — there is
 * wood in the inventory and the rescoring in `uret` picks the right type.
 */
function kaynakSinifi (ad) {
  if (/_log$|_stem$/.test(ad)) return 'odun'
  return ESYA_KAYNAGI[ad] || null
}

/**
 * Builds a fresh supplier for every command.
 *
 * Why a factory: the "already gathered wood in this command" memory has to
 * reset when the command ends. One Set at module level would leave the bot
 * never chopping a tree on the second command.
 */
function tedarikciYap () {
  // Failures are remembered too.
  //
  // The old version only noted successful gathers. Underground the bot found
  // no tree, nothing was noted, and `uret` asked again for the next wood type.
  // The log showed 48 "no natural tree within 64 blocks" lines in the same
  // second. Whatever the outcome, a resource class is tried once per command.
  const denenen = new Set() // resource classes tried in this command
  const yol = new Set() // currently being gathered (loop guard)

  return async function tedarikci (bot, kontrol, ad, adet) {
    const sinif = kaynakSinifi(ad)
    if (!sinif) return false
    if (denenen.has(sinif)) return false // already tried in this command
    if (yol.has(sinif)) return false // gathering it right now, do not re-enter
    if (yol.size > 3) return false // chain got too deep

    yol.add(sinif)
    denenen.add(sinif)
    try {
      if (sinif === 'odun') {
        const r = await chopTrees(bot, kontrol, Math.max(1, Math.ceil(adet / 5)))
        return r.kazanilanOdun > 0
      }
      const r = await kaz(bot, kontrol, sinif, Math.max(1, adet), { tedarikci })
      return r.kirilan > 0
    } finally {
      yol.delete(sinif)
    }
  }
}

/** Calls `uret` with a fresh supplier; this is what the commands use */
function getir (bot, kontrol, istek, adet = 1) {
  return uret(bot, kontrol, istek, adet, { tedarikci: tedarikciYap() })
}

/**
 * Every skill (a thing the bot can do) is exported from here.
 * A new ability means one more line in this list.
 */
module.exports = {
  chopTree,
  chopTrees,
  gel,
  baltaYap,
  aletKusan,
  uygunAlet,
  takipBaslat,
  takipBirak,
  takipVarMi,
  ver,
  uret,
  getir,
  tedarikciYap,
  kaz,
  kazmaSeviyesi,
  erit,
  sutunaCik,
  sutundanIn,
  yuzeyeSutunla,
  oduncuSay,
  kutukMu,
  agaciTopla,
  dusenleriTopla
}
