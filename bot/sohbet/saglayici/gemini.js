'use strict'

/**
 * Google Gemini provider (generateContent).
 *
 * Gemini has a free tier, which is why it is the default: this is a student
 * portfolio project and running it should not require a credit card.
 *
 * Uses `generateContent`, not the newer Interactions API. Measured: the same
 * key returned HTTP 200 on GET /models but the Interactions POST first
 * answered 500 "high demand" and then stopped answering at all (20s timeout).
 * `generateContent` is the long-standing endpoint and the one every Gemini
 * example uses.
 *
 * The response parser walks the structure for `text` and `functionCall`
 * blocks rather than assuming a fixed path — see `topla`.
 */

const KOK = 'https://generativelanguage.googleapis.com/v1beta/models'

function hazir (config) {
  return Boolean(config.geminiAnahtari)
}

/** The model goes in the URL for this API, not the body. */
function url (istek) {
  return `${KOK}/${encodeURIComponent(istek.model)}:generateContent`
}

function govde (istek) {
  return {
    system_instruction: { parts: [{ text: istek.sistem }] },
    contents: istek.mesajlar.map((m) => ({
      role: m.rol === 'bot' ? 'model' : 'user',
      parts: [{ text: m.metin }]
    })),
    tools: [{
      function_declarations: [{
        name: istek.arac.ad,
        description: istek.arac.aciklama,
        parameters: istek.arac.sema
      }]
    }],
    generationConfig: { maxOutputTokens: istek.maksToken }
  }
}

/**
 * Collect text and function-call blocks wherever they sit.
 *
 * Defensive on purpose: response nesting differs between API versions and a
 * wrong assumption here means a bot that silently understands nothing.
 */
function topla (dugum, bulunan, derinlik = 0) {
  if (!dugum || derinlik > 8) return bulunan
  if (Array.isArray(dugum)) {
    for (const d of dugum) topla(d, bulunan, derinlik + 1)
    return bulunan
  }
  if (typeof dugum !== 'object') return bulunan

  if (dugum.functionCall && dugum.functionCall.name) {
    bulunan.araclar.push(dugum.functionCall.args || {})
  } else if (dugum.type === 'function_call' && dugum.name) {
    bulunan.araclar.push(dugum.arguments || dugum.args || {})
  } else if (typeof dugum.text === 'string' && !dugum.functionCall) {
    bulunan.metinler.push(dugum.text)
  }
  for (const deger of Object.values(dugum)) {
    if (deger && typeof deger === 'object') topla(deger, bulunan, derinlik + 1)
  }
  return bulunan
}

function coz (cevap) {
  const bulunan = topla(cevap?.candidates ?? cevap, { metinler: [], araclar: [] })
  const metin = (typeof cevap?.output_text === 'string' && cevap.output_text.trim())
    ? cevap.output_text.trim()
    : bulunan.metinler.join(' ').trim()
  return { metin, arac: bulunan.araclar[0] || null }
}

function baslik (config) {
  return {
    'content-type': 'application/json',
    'x-goog-api-key': config.geminiAnahtari
  }
}

module.exports = {
  ad: 'gemini',
  url,
  hazir,
  govde,
  coz,
  baslik,
  // Measured on a free-tier key: `gemini-flash-lite-latest` returned 503
  // "high demand" repeatedly. The pinned 2.5 models are less contended.
  varsayilanModel: 'gemini-2.5-flash-lite',
  // Tried in order when a model returns 5xx or 429 (busy, not our bug).
  yedekModeller: ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest']
}
