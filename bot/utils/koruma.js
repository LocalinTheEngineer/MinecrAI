'use strict'

/**
 * KORUMA BÖLGELERİ — botun asla blok kırmayacağı alanlar.
 *
 * Doğal ağaç tespiti sezgisel kurallara dayanıyor (yaprak var mı, duvar mı,
 * soyulmuş mu). Sezgiseller bir gün yanılır. Oyuncunun evi buna güvenmemeli.
 *
 * Bu yüzden ikinci bir güvenlik ağı: oyuncunun elle işaretlediği, botun
 * kesinlikle dokunmadığı bölgeler. Diske yazılır, bot yeniden başlasa da durur.
 */

const fs = require('fs')
const path = require('path')

const DOSYA = path.join(__dirname, '..', '..', 'data', 'koruma.json')

let bolgeler = []

function yukle () {
  try {
    bolgeler = JSON.parse(fs.readFileSync(DOSYA, 'utf8'))
  } catch (err) {
    bolgeler = [] // dosya yoksa sorun değil
  }
  return bolgeler
}

function kaydet () {
  try {
    fs.mkdirSync(path.dirname(DOSYA), { recursive: true })
    fs.writeFileSync(DOSYA, JSON.stringify(bolgeler, null, 2))
    return true
  } catch (err) {
    return false
  }
}

/** Merkez ve yarıçapla yeni bir koruma bölgesi ekle */
function ekle (konum, yaricap, ad = '') {
  bolgeler.push({
    x: Math.floor(konum.x),
    y: Math.floor(konum.y),
    z: Math.floor(konum.z),
    r: yaricap,
    ad
  })
  kaydet()
  return bolgeler.length
}

function temizle () {
  const adet = bolgeler.length
  bolgeler = []
  kaydet()
  return adet
}

function liste () {
  return bolgeler
}

/**
 * Bu konum korumalı bir bölgenin içinde mi?
 * Yatayda daire, dikeyde bolca pay bırakıyoruz — evler yüksek olabilir.
 */
function korumaliMi (konum) {
  if (!konum || bolgeler.length === 0) return false

  for (const b of bolgeler) {
    const dx = konum.x - b.x
    const dz = konum.z - b.z
    const dy = Math.abs(konum.y - b.y)
    if (dx * dx + dz * dz <= b.r * b.r && dy <= b.r + 20) return true
  }
  return false
}

yukle()

module.exports = { ekle, temizle, liste, korumaliMi, yukle, kaydet }
