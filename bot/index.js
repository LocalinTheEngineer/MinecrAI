'use strict'

/**
 * MinecrAI, Milestone 1: rule-based bot
 *
 * Run with:  npm run bot
 *
 * Controlled from in-game chat (type "komut" in game for the full list):
 *   gel          -> walks over to you
 *   kes          -> chops the nearest tree
 *   kes 3        -> chops 3 trees
 *   kes surekli  -> chops until told "dur"
 *   balta        -> crafts a wooden axe from inventory wood (if it has none)
 *   koru         -> never chops within 24 blocks of where you stand
 *   koru 40      -> you set the radius
 *   korumalar    -> counts the marked areas
 *   korumasil    -> removes every protected area
 *   envanter     -> reports its inventory
 *   nerede       -> reports its coordinates
 *   dur          -> drops whatever it is doing at once
 */

const mineflayer = require('mineflayer')
const pathfinderPlugin = require('mineflayer-pathfinder').pathfinder
const { Movements } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin

const config = require('./config')
const log = require('./utils/log')
const skills = require('./skills')
const koruma = require('./utils/koruma')
const { renkliListe } = require('./utils/chat')
const sohbet = require('./sohbet/beyin')
const { GorevKontrol, IptalEdildi, pathfinderDurdur } = require('./utils/gorev')

/**
 * Command list, single source of truth.
 *
 * Both the output of the "komut" command and the greeting message are built
 * from this. Add a row here when you add a command, or the help text drifts
 * away from the code and nobody notices.
 */
const KOMUTLAR = [
  { ad: 'gel', aciklama: 'yanına yürür' },
  { ad: 'kes', aciklama: 'en yakın doğal ağacı keser' },
  { ad: 'kes 3', aciklama: '3 ağaç keser (1-64)' },
  { ad: 'kes surekli', aciklama: 'dur diyene kadar keser' },
  { ad: 'takip', aciklama: 'peşinden gelir' },
  { ad: 'takibi birak', aciklama: 'takibi bırakır' },
  { ad: 'ver odun', aciklama: 'eşya atar (tahta/balta/kazma...)' },
  { ad: 'ver odun 10', aciklama: 'adet belirtirsin' },
  { ad: 'balta', aciklama: 'odundan tahta balta yapar' },
  { ad: 'uret tas kazma', aciklama: 'tarif agacini kendi cozer' },
  { ad: 'uret demir kazma', aciklama: 'odun/tas/cevheri kendi toplar, eritir' },
  { ad: 'uret cubuk 8', aciklama: 'adet belirtirsin' },
  { ad: 'kaz demir', aciklama: 'merdivenle inip cevher kazar' },
  { ad: 'kaz elmas 5', aciklama: 'adet belirtirsin' },
  { ad: 'cik', aciklama: 'sutun orerek yuzeye cikar (magarada kalirsa)' },
  { ad: 'koru', aciklama: 'durduğun yeri korur, orada kesmez' },
  { ad: 'koru 40', aciklama: 'koruma yarıçapı (4-200)' },
  { ad: 'korumalar', aciklama: 'koruma bölgelerini listeler' },
  { ad: 'korumasil', aciklama: 'korumaları kaldırır' },
  { ad: 'envanter', aciklama: 'envanterini söyler' },
  { ad: 'nerede', aciklama: 'koordinatlarını söyler' },
  { ad: 'dur', aciklama: 'işi anında bırakır' },
  { ad: 'komut', aciklama: 'bu liste' }
]

/**
 * Writes the command list to chat.
 *
 * Colour needs `/tellraw`, which needs op. utils/chat.js tries it once and
 * falls back to plain text when the bot is not op.
 *
 * A vanilla server's spam filter counts messages. One message per command got
 * the bot kicked with "disconnect.spam"; the fix is fewer messages, not a
 * longer delay.
 */
async function komutlariYaz (bot) {
  await renkliListe(bot, '=== MinecrAI komutları ===', KOMUTLAR)
}

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

  // One task at a time; "dur" cancels through this object
  const kontrol = new GorevKontrol()

  // --- Connection events -------------------------------------------------
  bot.once('spawn', () => {
    const movements = new Movements(bot)
    movements.canDig = true // may break blocks to clear a path
    movements.allow1by1towers = false // no pointless pillaring

    // Lava settings. The bot died in lava once and this is most likely why.
    //
    // By default mineflayer-pathfinder (lib/movements.js:73) has lava in the
    // "replaceable" list: when clearing a path it treats lava as a block it
    // can replace and may plan a route straight through it. 60 blocks
    // underground that means death. Take it out of the list.
    try {
      movements.replaceables.delete(bot.registry.blocksByName.lava.id)
    } catch (err) { /* version difference, not critical */ }

    // Parkour means jumping over gaps. Fine on the surface; in a cave it
    // means trying to jump over a lava lake.
    movements.allowParkour = false

    // The default allows a 4-block drop. In a dark cave you usually cannot
    // see 4 blocks down at all.
    movements.maxDropDown = 3

    bot.pathfinder.setMovements(movements)

    log.basari(`Dünyaya girdim. Konum: ${bot.entity.position}`)
    bot.chat(`MinecrAI hazır. ${KOMUTLAR.length} komutum var — hepsini görmek için "komut" yaz.`)

    const balta = skills.uygunAlet(bot, { name: 'oak_log' })
    if (balta) bot.chat(`Elimde ${balta.name} var, onunla keseceğim.`)
    else bot.chat('Baltam yok — elle keseceğim. Odun toplayınca "balta" yaz, kendim yaparım.')
  })

  bot.on('kicked', (sebep) => log.hata('Sunucudan atıldım:', sebep))
  bot.on('error', (err) => log.hata('Hata:', err.message))
  bot.on('end', (sebep) => log.uyari('Bağlantı kapandı:', sebep))

  // --- Task runner -------------------------------------------------------
  /**
   * Runs long jobs from one place: no two tasks at once, clean shutdown on
   * cancel, and no crash on error.
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
      pathfinderDurdur(bot) // do not leave the latch set, it kills the next goto
      bot.clearControlStates()
    }
  }

  // --- Chat commands -----------------------------------------------------
  // Known command words.
  //
  // This decides whether the chat layer gets involved: if the first word is
  // in here the message is an exact command and runs directly, with no LLM
  // call, no latency and no cost. Otherwise it is taken as natural language
  // and goes to the chat layer.
  //
  // The list is maintained by hand, but `test/smoke.js` compares it against
  // the real branches in the router, so a missing entry shows up as a test
  // failure.
  const BILINEN = new Set([
    'dur', 'komut', 'komutlar', 'yardim', 'yardım', 'help', '?',
    'nerede', 'envanter', 'takip', 'takibi', 'takipbirak', 'ver',
    'koru', 'korumalar', 'korumasil', 'balta', 'cik', 'çık',
    'kaz', 'uret', 'üret', 'yap', 'gel', 'kes'
  ])

  /**
   * Handles one chat message.
   *
   * `mesaj` can come straight from the player or be a command line produced
   * by the chat layer; both take the same path, so everything the LLM can
   * run is already tested code.
   */
  // When the player says "dur", the remaining steps of a chat chain are skipped too.
  let iptalEdildi = false

  async function mesajiIsle (username, mesaj) {
    const parcalar = mesaj.trim().toLowerCase().split(/\s+/)
    const komut = parcalar[0]
    const arguman = parcalar[1]

    // "dur" always works, even while busy
    if (komut === 'dur') {
      iptalEdildi = true   // skip the rest of the chat chain too
      kontrol.durdur()
      skills.takipBirak(bot)
      pathfinderDurdur(bot)
      bot.stopDigging()
      bot.clearControlStates()
      if (!kontrol.calisiyor) bot.chat('Zaten boştaydım.')
      return
    }

    // Help always works, even while busy
    if (komut === 'komut' || komut === 'komutlar' || komut === 'yardim' ||
        komut === 'yardım' || komut === 'help' || komut === '?') {
      await komutlariYaz(bot)
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

    if (komut === 'takip') {
      if (kontrol.calisiyor) { bot.chat('Önce "dur" yaz.'); return }
      skills.takipBaslat(bot, username)
      return
    }

    if ((komut === 'takibi' && arguman === 'birak') || komut === 'takipbirak') {
      bot.chat(skills.takipBirak(bot) ? 'Takibi bıraktım.' : 'Zaten takip etmiyordum.')
      return
    }

    if (komut === 'ver') {
      const adet = parcalar[2] && !isNaN(parseInt(parcalar[2], 10))
        ? parseInt(parcalar[2], 10)
        : null
      await gorevCalistir('ver', () => skills.ver(bot, username, arguman, adet))
      return
    }

    if (komut === 'koru') {
      const yaricap = arguman && !isNaN(parseInt(arguman, 10))
        ? Math.max(4, Math.min(parseInt(arguman, 10), 200))
        : 24
      const oyuncu = bot.players[username]
      if (!oyuncu || !oyuncu.entity) {
        bot.chat('Seni göremiyorum, yaklaş da neresini koruyacağımı bileyim.')
        return
      }
      const adet = koruma.ekle(oyuncu.entity.position, yaricap, username)
      bot.chat(`Burayı ${yaricap} blok çapında koruyorum, asla kesmem. (toplam ${adet} bölge)`)
      return
    }

    if (komut === 'korumalar') {
      const l = koruma.liste()
      bot.chat(l.length === 0
        ? 'Hiç koruma bölgesi yok.'
        : l.map((b) => `(${b.x},${b.y},${b.z}) r=${b.r}`).join(' | '))
      return
    }

    if (komut === 'korumasil') {
      const adet = koruma.temizle()
      bot.chat(`${adet} koruma bölgesi kaldırıldı.`)
      return
    }

    if (komut === 'balta') {
      await gorevCalistir('balta', async () => {
        bot.chat('Balta yapmayı deniyorum...')
        const sonuc = await skills.baltaYap(bot)
        bot.chat(sonuc.mesaj)
      })
      return
    }

    // "uret taş kazma" / "uret çubuk 8"
    //
    // Careful: `komut` is only the first word of the message (parcalar[0]).
    // This once read `komut.startsWith('uret ')`, and since `komut` never
    // contains a space that condition was never true and the "uret" command
    // silently did nothing. The arguments are in the rest of `parcalar`.
    // "kaz demir" / "kaz elmas 5" / "kaz" (default: tas)
    if (komut === 'cik') {
      await gorevCalistir('cik', async () => {
        bot.chat('Yüzeye çıkıyorum...')
        const r = await skills.yuzeyeSutunla(bot, kontrol)
        bot.chat(r.ok
          ? `Çıktım (${r.cikilan} kat, y=${Math.floor(bot.entity.position.y)}).`
          : `Çıkamadım (${r.sebep}) — blok lazım, toprak veya taş ver.`)
      })
      return
    }

    if (komut === 'kaz') {
      const argumanlar = parcalar.slice(1)
      let adet = 8
      if (argumanlar.length > 0 && /^\d+$/.test(argumanlar[argumanlar.length - 1])) {
        adet = Math.min(64, Math.max(1, parseInt(argumanlar.pop(), 10)))
      }
      const ne = argumanlar[0] || 'tas'

      await gorevCalistir('kaz', async () => {
        bot.chat(`${ne} kazmaya gidiyorum (${adet} tane)...`)
        const sonuc = await skills.kaz(bot, kontrol, ne, adet, { tedarikci: skills.tedarikciYap() })
        bot.chat(sonuc.mesaj)
      })
      return
    }

    if (komut === 'uret' || komut === 'üret' || komut === 'yap') {
      const argumanlar = parcalar.slice(1)
      if (argumanlar.length === 0) {
        bot.chat('Ne üreteyim? Örnek: "uret tas kazma" veya "uret cubuk 8"')
        return
      }

      // A trailing number is the count: "uret cubuk 8"
      let adet = 1
      if (argumanlar.length > 1 && /^\d+$/.test(argumanlar[argumanlar.length - 1])) {
        adet = Math.min(64, Math.max(1, parseInt(argumanlar.pop(), 10)))
      }
      const istek = argumanlar.join(' ')

      await gorevCalistir('uret', async () => {
        bot.chat(`${istek} için gerekeni toplayıp yapmayı deniyorum...`)
        // getir = uret + supplier: it collects the missing raw material itself
        const sonuc = await skills.getir(bot, kontrol, istek, adet)
        bot.chat(sonuc.mesaj)
      })
      return
    }

    if (komut === 'gel') {
      await gorevCalistir('gel', () => skills.gel(bot, kontrol, username))
      return
    }

    if (komut === 'kes') {
      // "kes" -> 1 tree | "kes 3" -> 3 trees | "kes surekli" -> until told to stop
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
  }

  bot.on('chat', async (username, mesaj) => {
    if (username === bot.username) return

    const ilkKelime = mesaj.trim().toLowerCase().split(/\s+/)[0]

    // Exact command: run it directly, no LLM call.
    if (BILINEN.has(ilkKelime)) {
      await mesajiIsle(username, mesaj)
      return
    }

    // Otherwise try to read it as natural language.
    if (!sohbet.acik()) return   // no key: stay quiet, as before

    const yorum = await sohbet.yorumla(bot, username, mesaj, {
      mesgul: kontrol.calisiyor
    })
    if (!yorum) return

    if (yorum.cevap) bot.chat(yorum.cevap)

    // Command chain.
    //
    // The model can propose several jobs ("chop wood first, then make a
    // pickaxe"). They run in order and each one is awaited: `gorevCalistir`
    // refuses new work while busy, so without the await the second step would
    // fall through with "I'm busy right now".
    //
    // If the player types "dur" in between, `kontrol` is cancelled and the
    // remaining steps are skipped; otherwise "dur" would stop only the
    // current job and the next one would start immediately.
    if (Array.isArray(yorum.komutlar) && yorum.komutlar.length > 0) {
      log.bilgi(`Sohbet: "${mesaj}" -> ${yorum.komutlar.join(' ; ')}`)
      for (const [i, komutSatiri] of yorum.komutlar.entries()) {
        if (i > 0) {
          if (iptalEdildi) {
            bot.chat('Kalan işleri bıraktım.')
            break
          }
          bot.chat(`(${i + 1}/${yorum.komutlar.length}) ${komutSatiri}`)
        }
        iptalEdildi = false
        await mesajiIsle(username, komutSatiri)
      }
    }
  })

  return bot
}

// Start the bot when this file is run directly
if (require.main === module) {
  botOlustur()
}

module.exports = { botOlustur, KOMUTLAR }
