'use strict'

/**
 * MinecrAI köprüsü — Node tarafı.
 *
 * Çalıştırma:  npm run bridge
 *
 * Ne yapar: Minecraft'a bir bot bağlar ve WebSocket üzerinden Python'a
 * "reset / step" arayüzü açar. Protokol için bot/bridge/protocol.md'ye bak.
 */

const { WebSocketServer } = require('ws')
const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin

const config = require('./../config')
const log = require('./../utils/log')
const { MinecraftEnvironment } = require('./environment')

function kopruyuBaslat (ayarlar = {}) {
  const host = ayarlar.host || config.host
  const port = ayarlar.port || config.port
  const version = ayarlar.version || config.version
  const bridgePort = ayarlar.bridgePort || config.bridgePort

  log.bilgi(`Bot bağlanıyor: ${host}:${port} (${version})`)

  const bot = mineflayer.createBot({
    host,
    port,
    version,
    username: ayarlar.username || config.username,
    auth: config.auth
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)

  let env = null
  let wss = null

  bot.once('spawn', () => {
    const mv = new Movements(bot)
    mv.canDig = true
    bot.pathfinder.setMovements(mv)

    env = new MinecraftEnvironment(bot)

    wss = new WebSocketServer({ port: bridgePort })
    log.basari(`Köprü hazır — Python ws://localhost:${bridgePort} adresine bağlanabilir`)

    wss.on('connection', (ws) => {
      log.bilgi('Python bağlandı.')

      ws.on('message', async (ham) => {
        let istek
        try {
          istek = JSON.parse(ham.toString())
        } catch (err) {
          return ws.send(JSON.stringify({ error: 'gecersiz_json' }))
        }

        try {
          if (istek.cmd === 'reset') {
            ws.send(JSON.stringify(await env.reset()))
          } else if (istek.cmd === 'step') {
            ws.send(JSON.stringify(await env.step(istek.action)))
          } else if (istek.cmd === 'close') {
            ws.send(JSON.stringify({ ok: true }))
            ws.close()
          } else {
            ws.send(JSON.stringify({ error: 'bilinmeyen_komut' }))
          }
        } catch (err) {
          log.hata('step/reset hatası:', err.message)
          ws.send(JSON.stringify({ error: err.message }))
        }
      })

      ws.on('close', () => log.uyari('Python bağlantısı kapandı.'))
    })
  })

  bot.on('error', (err) => log.hata('Bot hatası:', err.message))
  bot.on('kicked', (r) => log.hata('Atıldım:', r))
  bot.on('end', () => {
    log.uyari('Bot bağlantısı kapandı.')
    if (wss) wss.close()
  })

  return { bot, kapat: () => { if (wss) wss.close(); bot.quit() } }
}

if (require.main === module) {
  kopruyuBaslat()
}

module.exports = { kopruyuBaslat }
