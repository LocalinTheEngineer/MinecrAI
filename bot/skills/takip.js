'use strict'

const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const { pathfinderDurdur } = require('../utils/gorev')

/**
 * SKILL: Oyuncuyu sürekli takip et.
 *
 * `gel`den farkı: `gel` tek seferlik, hedefe varınca biter. Takip ise
 * bırakana kadar sürer, sen yürüdükçe peşinden gelir.
 *
 * Teknik not: burada `goto()` DEĞİL `setGoal(hedef, true)` kullanılıyor.
 * `GoalFollow` sürekli güncellenen bir hedef; `goto()` ile kullanılırsa yol
 * her güncellemede sıfırlanıp hata verir. İkinci parametre (dynamic=true)
 * pathfinder'a "bu hedef hareket edecek" demek.
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
