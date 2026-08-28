'use strict'

/**
 * Renkli chat çıktısı.
 *
 * Minecraft'ta normal chat mesajlarına renk konamaz — sunucu oyuncu
 * mesajlarındaki § kodlarını siler. Renk için `/tellraw` komutu gerekiyor ve
 * o da op yetkisi istiyor.
 *
 * Bu yüzden: tellraw denenir, bot op değilse otomatik olarak düz metne düşer.
 * Kullanıcı hiçbir şey görmemekten iyidir.
 *
 * Botu op yapmak için sunucu konsoluna:  op MinecrAI
 */

const log = require('./log')

// Chat'ten gönderilen komutlar 256 karakterle sınırlı
const KOMUT_SINIRI = 250

// null = henüz bilmiyoruz, true = tellraw çalışıyor, false = düz metne düş
let renkliDestek = null

function komutHatasiMi (metin) {
  const t = String(metin).toLowerCase()
  return t.includes('unknown or incomplete command') ||
         t.includes('you do not have permission') ||
         t.includes('incorrect argument') ||
         t.includes('bilinmeyen')
}

/**
 * tellraw destekleniyor mu diye bir kez dener.
 * Sunucu hata mesajı dönerse bir daha denemeyiz.
 */
function destekDinle (bot) {
  return new Promise((cozumle) => {
    let karar = false

    const dinleyici = (mesaj) => {
      if (karar) return
      if (komutHatasiMi(mesaj.toString())) {
        karar = true
        bot.removeListener('message', dinleyici)
        cozumle(false)
      }
    }

    bot.on('message', dinleyici)
    setTimeout(() => {
      if (karar) return
      karar = true
      bot.removeListener('message', dinleyici)
      cozumle(true) // hata gelmediyse çalışıyor sayıyoruz
    }, 800)
  })
}

/** JSON metin bileşenlerini tellraw ile gönder */
function tellraw (bot, bilesenler) {
  bot.chat(`/tellraw @a ${JSON.stringify(['', ...bilesenler])}`)
}

/**
 * Satırları renkli göndermeyi dener, olmazsa düz metne döner.
 * @param {Array<{ad: string, aciklama: string}>} satirlar
 */
async function renkliListe (bot, baslik, satirlar, {
  baslikRenk = 'gold', adRenk = 'aqua', aciklamaRenk = 'gray',
  mesajArasiMs = 800
} = {}) {
  // İlk kullanımda tellraw destekleniyor mu öğren
  if (renkliDestek === null) {
    tellraw(bot, [{ text: baslik, color: baslikRenk, bold: true }])
    renkliDestek = await destekDinle(bot)
    if (!renkliDestek) {
      log.uyari('tellraw çalışmıyor (bot op değil?) — düz metne geçiliyor.')
      log.uyari('Renkli çıktı için sunucu konsoluna: op ' + bot.username)
    }
  } else if (renkliDestek) {
    tellraw(bot, [{ text: baslik, color: baslikRenk, bold: true }])
  }

  if (!renkliDestek) return duzListe(bot, baslik, satirlar, mesajArasiMs)

  // Satırları 250 karakterlik tellraw komutlarına sığdır
  let grup = []
  const gruplar = []

  for (const s of satirlar) {
    const aday = [...grup,
      { text: s.ad, color: adRenk, bold: true },
      { text: `  ${s.aciklama}\n`, color: aciklamaRenk }
    ]
    const uzunluk = `/tellraw @a ${JSON.stringify(['', ...aday])}`.length

    if (grup.length > 0 && uzunluk > KOMUT_SINIRI) {
      gruplar.push(grup)
      grup = [
        { text: s.ad, color: adRenk, bold: true },
        { text: `  ${s.aciklama}\n`, color: aciklamaRenk }
      ]
    } else {
      grup = aday
    }
  }
  if (grup.length > 0) gruplar.push(grup)

  for (let i = 0; i < gruplar.length; i++) {
    await new Promise((r) => setTimeout(r, mesajArasiMs))
    tellraw(bot, gruplar[i])
  }
  return gruplar.length + 1
}

/** Renk yoksa: az sayıda düz mesaj (spam filtresine takılmamak için) */
async function duzListe (bot, baslik, satirlar, mesajArasiMs = 900) {
  const SINIR = 240
  const parcalar = []
  let mevcut = ''

  for (const s of satirlar) {
    const metin = `${s.ad}: ${s.aciklama}`
    if (mevcut && (mevcut.length + metin.length + 3) > SINIR) {
      parcalar.push(mevcut)
      mevcut = metin
    } else {
      mevcut = mevcut ? `${mevcut} | ${metin}` : metin
    }
  }
  if (mevcut) parcalar.push(mevcut)

  for (let i = 0; i < parcalar.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, mesajArasiMs))
    bot.chat(`[${i + 1}/${parcalar.length}] ${parcalar[i]}`)
  }
  return parcalar.length
}

function destegiSifirla () { renkliDestek = null }

module.exports = { renkliListe, duzListe, destegiSifirla }
