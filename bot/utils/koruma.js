'use strict'

/**
 * Protected regions: areas where the bot never breaks a block.
 *
 * Natural-tree detection runs on heuristics (are there leaves, is it a wall,
 * is it stripped). Heuristics get it wrong eventually, and a player's house
 * should not depend on one.
 *
 * Hence a second safety net: regions the player marks by hand that the bot
 * never touches. Written to disk, so it survives a restart.
 */

const fs = require('fs')
const path = require('path')

const DOSYA = path.join(__dirname, '..', '..', 'data', 'koruma.json')

let bolgeler = []

function yukle () {
  try {
    bolgeler = JSON.parse(fs.readFileSync(DOSYA, 'utf8'))
  } catch (err) {
    bolgeler = [] // no file is fine
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

/** Add a protected region from a centre point and a radius */
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
 * Is this position inside a protected region?
 * A circle horizontally, with generous vertical slack: houses can be tall.
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
