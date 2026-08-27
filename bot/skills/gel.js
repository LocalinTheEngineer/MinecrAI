'use strict'

const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const { IptalEdildi, sinirli } = require('../utils/gorev')

/**
 * SKILL: Bir oyuncunun yanına git.
 * Pathfinder'ın çalıştığını gözünle görmek için en kolay test.
 */
async function gel (bot, kontrol, oyuncuAdi, mesafe = 2) {
  const oyuncu = bot.players[oyuncuAdi]

  if (!oyuncu || !oyuncu.entity) {
    log.uyari(`${oyuncuAdi} görüş alanımda değil.`)
    return { basarili: false, hata: 'oyuncu_gorunmuyor' }
  }

  const { x, y, z } = oyuncu.entity.position
  log.bilgi(`${oyuncuAdi} yanına gidiyorum...`)

  try {
    await sinirli(
      bot.pathfinder.goto(new goals.GoalNear(x, y, z, mesafe)),
      30000,
      kontrol
    )
    log.basari('Geldim.')
    return { basarili: true }
  } catch (err) {
    bot.pathfinder.stop()
    if (err instanceof IptalEdildi) throw err
    log.hata(`Yol bulamadım: ${err.message}`)
    return { basarili: false, hata: err.message }
  }
}

module.exports = { gel }
