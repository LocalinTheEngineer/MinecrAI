'use strict'

/**
 * Sağlayıcı seçimi.
 *
 * Hangi anahtar varsa o kullanılır — kullanıcının iki ayar birden
 * yazması gerekmiyor. `SOHBET_SAGLAYICI` verilirse o kazanır.
 */

const anthropic = require('./anthropic')
const gemini = require('./gemini')

const SAGLAYICILAR = { anthropic, gemini }

function sec (config) {
  const istenen = (config.sohbetSaglayici || '').toLowerCase()
  if (istenen) {
    const s = SAGLAYICILAR[istenen]
    if (!s) throw new Error(`bilinmeyen sohbet saglayicisi: ${istenen}`)
    return s
  }
  // Otomatik: hangi anahtar varsa. Gemini önce, çünkü ücretsiz katmanı var.
  if (gemini.hazir(config)) return gemini
  if (anthropic.hazir(config)) return anthropic
  return null
}

module.exports = { sec, SAGLAYICILAR }
