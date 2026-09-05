'use strict'

/**
 * Provider selection.
 *
 * Whichever key is present gets used, so nobody has to set two options.
 * `SOHBET_SAGLAYICI` wins when it is set.
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
  // Auto: whichever key exists. Gemini first, it has a free tier.
  if (gemini.hazir(config)) return gemini
  if (anthropic.hazir(config)) return anthropic
  return null
}

module.exports = { sec, SAGLAYICILAR }
