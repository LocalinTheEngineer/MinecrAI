'use strict'

/**
 * Anthropic Messages API provider.
 *
 * Shared interface (see bot/sohbet/saglayici/index.js):
 *   hazir()        -> is there a key
 *   cagir(istek)   -> { metin, arac }   arac = {komut, arguman} | null
 */

const API = 'https://api.anthropic.com/v1/messages'

/** Same endpoint for every model — the model goes in the body. */
function url () { return API }

function hazir (config) {
  return Boolean(config.anthropicAnahtari)
}

function govde (istek) {
  return {
    model: istek.model,
    max_tokens: istek.maksToken,
    system: istek.sistem,
    tools: [{
      name: istek.arac.ad,
      description: istek.arac.aciklama,
      input_schema: istek.arac.sema
    }],
    messages: istek.mesajlar.map((m) => ({
      role: m.rol === 'bot' ? 'assistant' : 'user',
      content: m.metin
    }))
  }
}

function coz (cevap) {
  const parcalar = Array.isArray(cevap?.content) ? cevap.content : []
  const arac = parcalar.find((p) => p.type === 'tool_use')
  return {
    metin: parcalar.filter((p) => p.type === 'text').map((p) => p.text).join(' ').trim(),
    arac: arac ? arac.input : null
  }
}

function baslik (config) {
  return {
    'content-type': 'application/json',
    'x-api-key': config.anthropicAnahtari,
    'anthropic-version': '2023-06-01'
  }
}

const VARSAYILAN = 'claude-haiku-4-5-20251001'

// One endpoint, one model shape — but the same `denemeler` interface as the
// Gemini provider so `beyin.js` does not need to know which one it holds.
const tasiyici = { ad: 'messages', url, govde }

function denemeler (istenenModel) {
  return [{ model: istenenModel || VARSAYILAN, tasiyici }]
}

module.exports = {
  ad: 'anthropic',
  hazir,
  coz,
  baslik,
  denemeler,
  varsayilanModel: VARSAYILAN
}
