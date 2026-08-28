'use strict'

/**
 * MinecrAI — Milestone 1: kural tabanlı bot
 *
 * Çalıştırma:  npm run bot
 *
 * Oyun içinden chat'e yazarak kontrol edersin (tam liste için oyunda "komut" yaz):
 *   gel          -> yanına gelir
 *   kes          -> en yakın ağacı keser
 *   kes 3        -> 3 ağaç keser
 *   kes surekli  -> "dur" diyene kadar ağaç keser
 *   balta        -> envanterindeki oduna tahta balta yapar (yoksa)
   koru         -> bulunduğun yerin 24 blok çevresini kesinlikle kesmez
   koru 40      -> yarıçapı sen belirlersin
   korumalar    -> işaretli bölgeleri sayar
   korumasil    -> bütün koruma bölgelerini kaldırır
   envanter     -> envanterini söyler
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
const koruma = require('./utils/koruma')
const { GorevKontrol, IptalEdildi, pathfinderDurdur } = require('./utils/gorev')

/**
 * Komut listesi — TEK DOĞRULUK KAYNAĞI.
 *
 * Hem "komut" komutunun çıktısı hem de açılış mesajı buradan üretiliyor.
 * Yeni bir komut eklerken buraya da satır ekle, yoksa yardım metni koddan
 * sapar ve kimse fark etmez.
 */
const KOMUTLAR = [
  { ad: 'gel', aciklama: 'Yanına yürür' },
  { ad: 'kes', aciklama: 'En yakın doğal ağacı keser, odunları toplar' },
  { ad: 'kes 3', aciklama: '3 ağaç keser (1-64 arası sayı verebilirsin)' },
  { ad: 'kes surekli', aciklama: '"dur" diyene kadar ağaç kesmeye devam eder' },
  { ad: 'balta', aciklama: 'Envanterindeki odundan tahta balta yapar' },
  { ad: 'koru', aciklama: 'Durduğun yerin 24 blok çevresinde asla kesmez' },
  { ad: 'koru 40', aciklama: 'Koruma yarıçapını sen belirlersin (4-200)' },
  { ad: 'korumalar', aciklama: 'İşaretli koruma bölgelerini listeler' },
  { ad: 'korumasil', aciklama: 'Bütün koruma bölgelerini kaldırır' },
  { ad: 'envanter', aciklama: 'Envanterindekileri söyler' },
  { ad: 'nerede', aciklama: 'Koordinatlarını söyler' },
  { ad: 'dur', aciklama: 'Yaptığı işi anında bırakır (meşgulken bile çalışır)' },
  { ad: 'komut', aciklama: 'Bu listeyi gösterir' }
]

/**
 * Komut listesini chat'e yazar.
 *
 * Minecraft chat satırı ~256 karakterle sınırlı, ayrıca çok hızlı mesaj
 * göndermek sunucudan atılmaya sebep olabiliyor — o yüzden satır satır ve
 * araya kısa gecikme koyarak gönderiyoruz.
 */
async function komutlariYaz (bot) {
  bot.chat('--- MinecrAI komutları ---')
  for (const k of KOMUTLAR) {
    await new Promise((r) => setTimeout(r, 300))
    bot.chat(`${k.ad} - ${k.aciklama}`)
  }
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

  // Aynı anda tek görev çalışsın; "dur" bu nesne üzerinden iptal eder
  const kontrol = new GorevKontrol()

  // --- Bağlantı olayları -------------------------------------------------
  bot.once('spawn', () => {
    const movements = new Movements(bot)
    movements.canDig = true           // yolunu açmak için blok kırabilsin
    movements.allow1by1towers = false // gereksiz kule dikmesin
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
      pathfinderDurdur(bot) // mandalı bırakma, sonraki goto'yu öldürür
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
      pathfinderDurdur(bot)
      bot.stopDigging()
      bot.clearControlStates()
      if (!kontrol.calisiyor) bot.chat('Zaten boştaydım.')
      return
    }

    // Yardım her zaman çalışır — meşgulken bile
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

module.exports = { botOlustur, KOMUTLAR }
