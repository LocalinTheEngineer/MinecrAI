'use strict'

/**
 * Google Gemini provider.
 *
 * Free tier, which is why it is the default: this is a student portfolio
 * project and running it should not require a credit card.
 *
 * TWO TRANSPORTS, tried in order. Google has both a newer Interactions API
 * and the long-standing generateContent, and which one a given key and model
 * accept is not something the docs made obvious — this cost two wrong guesses:
 *
 *   1. Built on Interactions first. A pinned model answered 503 "high demand",
 *      then stopped answering at all, so I moved to generateContent.
 *   2. generateContent then returned a 404 that settled it:
 *      "gemini-2.5-flash-lite is no longer available to new users ... use
 *      models/gemini-3.5-flash-lite ... We recommend you to use the
 *      Interactions API."
 *
 * So Interactions is right for current models, and the earlier failures were
 * genuine transient load. Rather than pick again, both are kept and tried:
 * the cost is one extra request on a bad day, and the alternative is a bot
 * that breaks whenever Google shifts recommendations.
 *
 * `test/sohbet_dene.js` prints which combination actually answered.
 */

const KOK = 'https://generativelanguage.googleapis.com/v1beta'

function hazir (config) {
  return Boolean(config.geminiAnahtari)
}

// ---------------------------------------------------------------- transports

const interactions = {
  ad: 'interactions',
  url: () => `${KOK}/interactions`,
  govde: (istek) => ({
    model: istek.model,
    system_instruction: istek.sistem,
    store: false,
    // Cap the thinking budget.
    //
    // A successful reply came back with `total_thought_tokens: 400` — four
    // hundred tokens of reasoning to map one sentence onto a 13-item enum.
    // That is most of the latency.
    //
    // 'low', not 'minimal': the docs list 'minimal' for some models, but a
    // live 400 said otherwise — "'minimal' is not a supported thinking level
    // for this model. Allowed values are: medium, low, high." 'low' is
    // accepted everywhere seen so far, and `beyin.js` drops the field
    // entirely if a model still rejects it.
    generation_config: { thinking_level: 'low' },
    // 'model_output', not 'model_response': the docs example showed the
    // latter, a live 400 listed the former among supported values. The
    // user turn was accepted either way — only the assistant turn was wrong.
    input: istek.mesajlar.map((m) => (
      m.rol === 'bot'
        ? { type: 'model_output', content: [{ type: 'text', text: m.metin }] }
        : { type: 'user_input', content: m.metin }
    )),
    tools: [{
      type: 'function',
      name: istek.arac.ad,
      description: istek.arac.aciklama,
      parameters: istek.arac.sema
    }]
  })
}

const generateContent = {
  ad: 'generateContent',
  url: (istek) => `${KOK}/models/${encodeURIComponent(istek.model)}:generateContent`,
  govde: (istek) => ({
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
    generationConfig: {
      maxOutputTokens: istek.maksToken,
      thinking_level: 'low'
    }
  })
}

const TASIYICILAR = { interactions, generateContent }

/**
 * Progressive simplifications, applied in order when the API returns 400.
 *
 * THE DOCS AND THE LIVE API DISAGREED THREE TIMES on this integration:
 * which endpoint to use, which thinking levels exist, and how to encode an
 * assistant turn. Each time the fix was a one-word change discoverable only
 * by sending a request.
 *
 * So rather than a per-model table that goes stale, the request degrades:
 * drop the optional part the API objected to and send it again. Every step
 * still produces a valid request — just a less capable one. The bot answers
 * with a stale thinking setting or without conversation history far more
 * usefully than it refuses to answer at all.
 */
const BASITLESTIRMELER = [
  {
    ad: 'dusunme ayari',
    esles: /thinking/i,
    uygula (govde) {
      const kopya = { ...govde }
      for (const alan of ['generation_config', 'generationConfig']) {
        if (!kopya[alan]) continue
        const { thinking_level: _atilan, ...kalan } = kopya[alan]
        if (Object.keys(kalan).length === 0) delete kopya[alan]
        else kopya[alan] = kalan
      }
      return kopya
    }
  },
  {
    ad: 'konusma gecmisi',
    esles: /input\[|contents\[|not supported for/i,
    uygula (govde) {
      const kopya = { ...govde }
      // Keep only the last user turn. History is a convenience ("three more
      // please"); answering at all is not.
      if (Array.isArray(kopya.input)) kopya.input = kopya.input.slice(-1)
      if (Array.isArray(kopya.contents)) kopya.contents = kopya.contents.slice(-1)
      return kopya
    }
  }
]

/** Backwards-compatible single-step helper (used by older callers/tests). */
function dusunmeyiCikar (govde) {
  return BASITLESTIRMELER[0].uygula(govde)
}

// ---------------------------------------------------------------- response

/**
 * Collect text and function-call blocks wherever they sit.
 *
 * One parser for both transports, and deliberately structure-walking rather
 * than path-following: the two APIs nest their blocks differently and a wrong
 * assumption here means a bot that silently understands nothing.
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
  const bulunan = topla(cevap?.candidates ?? cevap?.steps ?? cevap,
    { metinler: [], araclar: [] })
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

/**
 * Every (model, transport) pair worth trying, best first.
 *
 * `istenenModel` (from .env) always goes first, on both transports.
 */
function denemeler (istenenModel) {
  const modeller = istenenModel
    ? [istenenModel, ...VARSAYILAN_MODELLER.filter((m) => m !== istenenModel)]
    : VARSAYILAN_MODELLER
  const cikti = []
  for (const model of modeller) {
    cikti.push({ model, tasiyici: interactions })
    cikti.push({ model, tasiyici: generateContent })
  }
  return cikti
}

// ORDER IS MEASURED, NOT ASSUMED.
//
// Google's 404 message recommends `gemini-3.5-flash-lite`, so that led the
// list at first. On a free-tier key it — and every other *lite* model —
// answered 503 "high demand" or timed out, while `gemini-flash-latest`
// answered immediately. Plausible reason: everyone defaults to the lite
// models, so they are the contended ones.
//
// The one that actually answers goes first. The lite models stay as
// fallbacks because they are cheaper when they are free.
const VARSAYILAN_MODELLER = [
  'gemini-flash-latest',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest'
]

module.exports = {
  ad: 'gemini',
  hazir,
  coz,
  baslik,
  denemeler,
  TASIYICILAR,
  dusunmeyiCikar,
  BASITLESTIRMELER,
  varsayilanModel: VARSAYILAN_MODELLER[0]
}
