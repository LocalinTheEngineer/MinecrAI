'use strict'

const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const { pathfinderDurdur } = require('../utils/gorev')

/**
 * SKILL: keep following a player.
 *
 * Different from `gel`: `gel` runs once and ends on arrival. Following runs
 * until you drop it and keeps up as you walk.
 *
 * This uses `setGoal(hedef, true)`, not `goto()`. `GoalFollow` is a
 * continuously updated goal; through `goto()` the path resets on every update
 * and errors out. The second argument (dynamic=true) tells pathfinder the goal
 * will move.
 */

let takipEdilen = null

function takipBaslat (bot, oyuncuAdi, mesafe = 3) {
  const oyuncu = bot.players[oyuncuAdi]

  if (!oyuncu || !oyuncu.entity) {
    bot.chat('Seni göremiyorum, biraz yaklaş.')
    return { basarili: false, hata: 'oyuncu_gorunmuyor' }
  }

  takipEdilen = oyuncuAdi
  bot.pathfinder.setGoal(new goals.GoalFollow(oyuncu.entity, mesafe), true)
  log.bilgi(`${oyuncuAdi} takip ediliyor (${mesafe} blok).`)
  bot.chat(`Peşindeyim. Bırakmam için "takibi birak" ya da "dur" yaz.`)
  return { basarili: true }
}

function takipBirak (bot) {
  if (!takipEdilen) return false
  takipEdilen = null
  pathfinderDurdur(bot)
  log.bilgi('Takip bırakıldı.')
  return true
}

function takipVarMi () {
  return takipEdilen
}

module.exports = { takipBaslat, takipBirak, takipVarMi }
