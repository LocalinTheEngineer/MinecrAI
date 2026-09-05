'use strict'

/**
 * Named places.
 *
 * Coordinates are how Minecraft addresses a location and how nobody talks.
 * The player stands somewhere, says "burasi ev", and from then on "git ev"
 * means those three numbers. Same file-on-disk approach as koruma.js, for
 * the same reason: a restart must not lose it.
 */

const fs = require('fs')
const path = require('path')

const DOSYA = path.join(__dirname, '..', '..', 'data', 'yerler.json')

// A name has to survive a round trip through the chat layer's argument
// sanitiser, which keeps letters, digits and spaces. Anything else is
// dropped here rather than stored and never matched again.
const AD_DESENI = /[^a-z0-9çğıöşü ]/g
const MAKS_AD = 20

// Enough for a survival world's landmarks. The cap exists so a loop in some
// future caller cannot grow the file without bound.
const MAKS_YER = 50

let yerler = []

function yukle () {
  try {
    const ham = JSON.parse(fs.readFileSync(DOSYA, 'utf8'))
    yerler = Array.isArray(ham) ? ham.filter(gecerliMi) : []
  } catch (err) {
    yerler = [] // no file yet is the normal first run
  }
  return yerler
}

function gecerliMi (y) {
  return y && typeof y.ad === 'string' &&
    Number.isFinite(y.x) && Number.isFinite(y.y) && Number.isFinite(y.z)
}

function yaz () {
  try {
    fs.mkdirSync(path.dirname(DOSYA), { recursive: true })
    fs.writeFileSync(DOSYA, JSON.stringify(yerler, null, 2))
    return true
  } catch (err) {
    return false
  }
}

/** Normalised form of a name; '' means unusable */
function adiDuzelt (ad) {
  if (typeof ad !== 'string') return ''
  return ad.toLowerCase().replace(AD_DESENI, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, MAKS_AD)
}

/**
 * Saves a place, overwriting a name that already exists.
 *
 * Overwriting rather than refusing: "burasi ev" said in a new house means the
 * new house. Asking the player to delete first would only be in the way.
 */
function kaydet (ad, konum, sahip = '') {
  const temiz = adiDuzelt(ad)
  if (!temiz) return { basarili: false, hata: 'ad_gecersiz' }
  if (!konum) return { basarili: false, hata: 'konum_yok' }

  const kayit = {
    ad: temiz,
    x: Math.floor(konum.x),
    y: Math.floor(konum.y),
    z: Math.floor(konum.z),
    sahip
  }

  const i = yerler.findIndex((y) => y.ad === temiz)
  const uzerineYazildi = i >= 0
  if (uzerineYazildi) {
    yerler[i] = kayit
  } else {
    if (yerler.length >= MAKS_YER) return { basarili: false, hata: 'dolu' }
    yerler.push(kayit)
  }

  yaz()
  return { basarili: true, yer: kayit, uzerineYazildi }
}

/**
 * Finds a place by name.
 *
 * Exact match first, then prefix: "git ev" should still work when the place
 * was saved as "ev onu". A prefix that matches more than one place is
 * ambiguous and returns nothing — walking to the wrong one is worse than
 * saying "which one".
 */
function bul (ad) {
  const temiz = adiDuzelt(ad)
  if (!temiz) return null

  const tam = yerler.find((y) => y.ad === temiz)
  if (tam) return tam

  const onek = yerler.filter((y) => y.ad.startsWith(temiz))
  return onek.length === 1 ? onek[0] : null
}

function sil (ad) {
  const temiz = adiDuzelt(ad)
  const i = yerler.findIndex((y) => y.ad === temiz)
  if (i < 0) return false
  yerler.splice(i, 1)
  yaz()
  return true
}

function liste () {
  return yerler
}

function temizle () {
  const adet = yerler.length
  yerler = []
  yaz()
  return adet
}

yukle()

module.exports = { kaydet, bul, sil, liste, temizle, yukle, adiDuzelt, MAKS_YER }
