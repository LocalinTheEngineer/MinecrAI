'use strict'

/**
 * Anthropic Messages API sağlayıcısı.
 *
 * Ortak arayüz (bkz. bot/sohbet/saglayici/index.js):
 *   hazir()        -> anahtar var mı
 *   cagir(istek)   -> { metin, arac }   arac = {komut, arguman} | null
 */

const API = 'https://api.anthropic.com/v1/messages'

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

module.exports = { ad: 'anthropic', API, hazir, govde, coz, baslik, varsayilanModel: 'claude-haiku-4-5-20251001' }
