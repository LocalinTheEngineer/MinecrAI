'use strict'

/**
 * Coloured chat output.
 *
 * Plain chat messages cannot carry colour — the server strips § codes out of
 * player messages. Colour needs the `/tellraw` command, and that needs op.
 *
 * So: try tellraw, and fall back to plain text automatically when the bot is
 * not op. Better than the user seeing nothing.
 *
 * To op the bot, in the server console:  op MinecrAI
 */

const log = require('./log')

// Commands sent through chat are capped at 256 characters
const KOMUT_SINIRI = 250

// null = not known yet, true = tellraw works, false = fall back to plain text
let renkliDestek = null

function komutHatasiMi (metin) {
  const t = String(metin).toLowerCase()
  return t.includes('unknown or incomplete command') ||
         t.includes('you do not have permission') ||
         t.includes('incorrect argument') ||
         t.includes('bilinmeyen')
}

/**
 * Tries once whether tellraw is supported.
 * If the server answers with an error, it is not tried again.
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
      cozumle(true) // no error came back, so treat it as working
    }, 800)
  })
}

/** Send JSON text components through tellraw */
function tellraw (bot, bilesenler) {
  bot.chat(`/tellraw @a ${JSON.stringify(['', ...bilesenler])}`)
}

/**
 * Tries to send the lines in colour, falls back to plain text.
 * @param {Array<{ad: string, aciklama: string}>} satirlar
 */
async function renkliListe (bot, baslik, satirlar, {
  baslikRenk = 'gold', adRenk = 'aqua', aciklamaRenk = 'gray',
  mesajArasiMs = 800
} = {}) {
  // On first use, find out whether tellraw is supported
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

  // Pack the lines into 250-character tellraw commands
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

/** No colour: a few plain messages, few enough to dodge the spam filter */
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
