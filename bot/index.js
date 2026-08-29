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
const { renkliListe } = require('./utils/chat')
const { GorevKontrol, IptalEdildi, pathfinderDurdur } = require('./utils/gorev')

/**
 * Komut listesi — TEK DOĞRULUK KAYNAĞI.
 *
 * Hem "komut" komutunun çıktısı hem de açılış mesajı buradan üretiliyor.
 * Yeni bir komut eklerken buraya da satır ekle, yoksa yardım metni koddan
 * sapar ve kimse fark etmez.
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
  { ad: 'uret cubuk 8', aciklama: 'adet belirtirsin' },
  { ad: 'kaz demir', aciklama: 'merdivenle inip cevher kazar' },
  { ad: 'kaz elmas 5', aciklama: 'adet belirtirsin' },
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
 * Komut listesini chat'e yazar.
 *
 * Renk için `/tellraw` gerekiyor, o da op yetkisi istiyor. utils/chat.js bunu
 * bir kez deniyor; bot op değilse otomatik olarak düz metne düşüyor.
 *
 * Not: vanilla sunucunun spam filtresi mesaj SAYISINA bakıyor. Her komutu ayrı
 * mesaj yapmak botu "disconnect.spam" ile attırıyordu — çözüm gecikmeyi
 * uzatmak değil, mesaj sayısını azaltmak.
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
      skills.takipBirak(bot)
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
        ? parseInt(parcalar[2], 10) : null
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
    // DİKKAT: `komut` mesajın SADECE İLK KELİMESİ (parcalar[0]).
    // Burada bir zamanlar `komut.startsWith('uret ')` yazıyordu — `komut`
    // hiçbir zaman boşluk içermediği için o koşul asla doğru olmuyordu ve
    // "uret" komutu sessizce hiçbir şey yapmıyordu. Argümanlar `parcalar`
    // dizisinin geri kalanında.
    // "kaz demir" / "kaz elmas 5" / "kaz" (varsayilan: tas)
    if (komut === 'kaz') {
      const argumanlar = parcalar.slice(1)
      let adet = 8
      if (argumanlar.length > 0 && /^\d+$/.test(argumanlar[argumanlar.length - 1])) {
        adet = Math.min(64, Math.max(1, parseInt(argumanlar.pop(), 10)))
      }
      const ne = argumanlar[0] || 'tas'

      await gorevCalistir('kaz', async () => {
        bot.chat(`${ne} kazmaya gidiyorum (${adet} tane)...`)
        const sonuc = await skills.kaz(bot, kontrol, ne, adet)
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

      // Son kelime sayıysa adettir: "uret cubuk 8"
      let adet = 1
      if (argumanlar.length > 1 && /^\d+$/.test(argumanlar[argumanlar.length - 1])) {
        adet = Math.min(64, Math.max(1, parseInt(argumanlar.pop(), 10)))
      }
      const istek = argumanlar.join(' ')

      await gorevCalistir('uret', async () => {
        bot.chat(`${istek} yapmayı deniyorum...`)
        const sonuc = await skills.uret(bot, kontrol, istek, adet)
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
