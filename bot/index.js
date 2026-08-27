'use strict'

/**
 * MinecrAI — Milestone 1: kural tabanlı bot
 *
 * Çalıştırma:  npm run bot
 *
 * Oyun içinden chat'e yazarak kontrol edersin:
 *   gel          -> yanına gelir
 *   kes          -> en yakın ağacı keser
 *   kes 3        -> 3 ağaç keser
 *   kes surekli  -> "dur" diyene kadar ağaç keser
 *   envanter     -> envanterini söyler
 *   nerede       -> koordinatlarını söyler
 *   dur          -> yaptığı işi anında bırakır
 */

const mineflayer = require('mineflayer')
const pathfinderPlugin = require('mineflayer-pathfinder').pathfinder
const { Movements } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin

const config = require('./config')
const log = require('./utils/log')
const skills = require('./skills')
const { GorevKontrol, IptalEdildi } = require('./utils/gorev')

function botOlustur () {
  log.bilgi(`Bağlanılıyor: ${config.host}:${config.port} (sürüm ${config.version})`)

  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: config.auth
  })

  bot.loadPlugin(pathfinderPlugin)
  bot.loadPlugin(collectBlock)

  // Aynı anda tek görev çalışsın; "dur" bu nesne üzerinden iptal eder
  const kontrol = new GorevKontrol()

  // --- Bağlantı olayları -------------------------------------------------
  bot.once('spawn', () => {
    const movements = new Movements(bot)
    movements.canDig = true           // yolunu açmak için blok kırabilsin
    movements.allow1by1towers = false // gereksiz kule dikmesin
    bot.pathfinder.setMovements(movements)

    log.basari(`Dünyaya girdim. Konum: ${bot.entity.position}`)
    bot.chat('MinecrAI hazır. Komutlar: gel / kes / kes 3 / kes surekli / envanter / nerede / dur')
  })

  bot.on('kicked', (sebep) => log.hata('Sunucudan atıldım:', sebep))
  bot.on('error', (err) => log.hata('Hata:', err.message))
  bot.on('end', (sebep) => log.uyari('Bağlantı kapandı:', sebep))

  // --- Görev çalıştırıcı -------------------------------------------------
  /**
   * Uzun süren işleri tek noktadan yönetir: aynı anda iki görev başlamasın,
   * iptal edildiğinde temiz kapansın, hata olursa bot çökmesin.
   */
  async function gorevCalistir (isim, isFn) {
    if (kontrol.calisiyor) {
      bot.chat('Şu an meşgulüm — önce "dur" yaz.')
      return
    }

    kontrol.baslat()
    try {
      await isFn()
    } catch (err) {
      if (err instanceof IptalEdildi) {
        log.uyari(`${isim}: iptal edildi.`)
        bot.chat('Tamam, bıraktım.')
      } else {
        log.hata(`${isim} hatası:`, err.message)
        bot.chat(`Bir sorun çıktı: ${err.message}`)
      }
    } finally {
      kontrol.bitir()
      bot.pathfinder.stop()
      bot.clearControlStates()
    }
  }

  // --- Chat komutları ----------------------------------------------------
  bot.on('chat', async (username, mesaj) => {
    if (username === bot.username) return

    const parcalar = mesaj.trim().toLowerCase().split(/\s+/)
    const komut = parcalar[0]
    const arguman = parcalar[1]

    // "dur" her zaman çalışır — meşgulken bile
    if (komut === 'dur') {
      kontrol.durdur()
      bot.pathfinder.stop()
      bot.stopDigging()
      bot.clearControlStates()
      if (!kontrol.calisiyor) bot.chat('Zaten boştaydım.')
      return
    }

    if (komut === 'nerede') {
      const p = bot.entity.position
      bot.chat(`x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} z=${p.z.toFixed(0)}`)
      return
    }

    if (komut === 'envanter') {
      const esyalar = bot.inventory.items()
      bot.chat(esyalar.length === 0
        ? 'Envanterim boş.'
        : esyalar.map((i) => `${i.name} x${i.count}`).join(', '))
      return
    }

    if (komut === 'gel') {
      await gorevCalistir('gel', () => skills.gel(bot, kontrol, username))
      return
    }

    if (komut === 'kes') {
      // "kes" -> 1 ağaç | "kes 3" -> 3 ağaç | "kes surekli" -> dur diyene kadar
      let adet = 1
      if (arguman === 'surekli' || arguman === 'sürekli' || arguman === 'durmadan') {
        adet = Infinity
      } else if (arguman && !isNaN(parseInt(arguman, 10))) {
        adet = Math.max(1, Math.min(parseInt(arguman, 10), 64))
      }

      await gorevCalistir('kes', async () => {
        bot.chat(adet === Infinity
          ? 'Durana kadar ağaç kesiyorum.'
          : `${adet} ağaç kesiyorum.`)

        const sonuc = await skills.chopTrees(bot, kontrol, adet)

        bot.chat(sonuc.agac === 0
          ? 'Yakında ağaç bulamadım.'
          : `${sonuc.agac} ağaç, ${sonuc.kesilen} kütük kestim. +${sonuc.kazanilanOdun} odun.`)
      })
    }
  })

  return bot
}

// Dosya doğrudan çalıştırıldıysa botu başlat
if (require.main === module) {
  botOlustur()
}

module.exports = { botOlustur }
