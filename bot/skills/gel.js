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

  // Oyuncu uzaktaysa mineflayer onun "entity"sini takip etmiyor ve konumunu
  // bilemiyoruz. Eskiden burada sessizce vazgeciyordu — bot hicbir sey
  // yapmiyor gibi gorunuyordu. Artik sebebini soyluyor.
  if (!oyuncu) {
    bot.chat(`${oyuncuAdi} diye birini gormuyorum.`)
    return { basarili: false, hata: 'oyuncu_yok' }
  }

  if (!oyuncu.entity) {
    bot.chat('Çok uzaktasın, seni göremiyorum — biraz yaklaş, tekrar "gel" yaz.')
    log.uyari(`${oyuncuAdi} görüş alanımda değil (entity yok).`)
    return { basarili: false, hata: 'oyuncu_gorunmuyor' }
  }

  // Ucuyorsan tam altindaki zemine gelsin, havada asili kalmaya calismasin
  if (!oyuncu.entity.onGround) {
    bot.chat('Havadasın, altındaki zemine geliyorum.')
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
    bot.chat(`Yanına yol bulamadım (${err.message}).`)
    return { basarili: false, hata: err.message }
  }
}

module.exports = { gel }
