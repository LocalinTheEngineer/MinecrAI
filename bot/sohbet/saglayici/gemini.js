'use strict'

/**
 * Google Gemini Interactions API sağlayıcısı.
 *
 * NEDEN VAR: Gemini'nin ücretsiz katmanı var. Bu proje bir öğrenci
 * portföyü; sohbet katmanının çalışması için kimsenin kredi kartı
 * girmek zorunda kalmaması gerekiyor.
 *
 * CEVAP ÇÖZÜMLEMESİ BİLEREK SAVUNMACI. Anthropic tarafında cevabın
 * şekli (`content: [{type:'text'|'tool_use'}]`) belgede net; Gemini'nin
 * Interactions API'sinde `steps` dizisinin metin bloklarını tam olarak
 * nasıl sardığını anahtar olmadan doğrulayamadım. Bu yüzden çözümleyici
 * belirli bir yolu varsaymak yerine yapıyı gezip nerede olursa olsun
 * `{type:'text'}` ve `{type:'function_call'}` bloklarını topluyor.
 *
 * Bu, tahmin edip yanılmaktan iyi: yanılırsam bot sessizce hiçbir şey
 * anlamaz ve sebebi görünmez olurdu.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta/interactions'

function hazir (config) {
  return Boolean(config.geminiAnahtari)
}

function govde (istek) {
  return {
    model: istek.model,
    system_instruction: istek.sistem,
    store: false,
    input: istek.mesajlar.map((m) => (
      m.rol === 'bot'
        ? { type: 'model_response', content: [{ type: 'text', text: m.metin }] }
        : { type: 'user_input', content: m.metin }
    )),
    tools: [{
      type: 'function',
      name: istek.arac.ad,
      description: istek.arac.aciklama,
      parameters: istek.arac.sema
    }]
  }
}

/** Yapıyı gezip metin ve fonksiyon çağrısı bloklarını toplar. */
function topla (dugum, bulunan, derinlik = 0) {
  if (!dugum || derinlik > 6) return bulunan
  if (Array.isArray(dugum)) {
    for (const d of dugum) topla(d, bulunan, derinlik + 1)
    return bulunan
  }
  if (typeof dugum !== 'object') return bulunan

  if (dugum.type === 'function_call' && dugum.name) {
    bulunan.araclar.push(dugum.arguments || dugum.args || {})
  } else if (dugum.type === 'text' && typeof dugum.text === 'string') {
    bulunan.metinler.push(dugum.text)
  }
  for (const deger of Object.values(dugum)) {
    if (deger && typeof deger === 'object') topla(deger, bulunan, derinlik + 1)
  }
  return bulunan
}

function coz (cevap) {
  const bulunan = topla(cevap?.steps ?? cevap, { metinler: [], araclar: [] })
  // `output_text` varsa güvenilir bir kısayol — ama tek kaynak değil
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

// `-latest` alias rather than a pinned version: measured HTTP 500 "currently
// experiencing high demand" on a pinned lite model while the alias served
// fine. Google routes the alias to whatever is healthy.
module.exports = {
  ad: 'gemini',
  API,
  hazir,
  govde,
  coz,
  baslik,
  varsayilanModel: 'gemini-flash-lite-latest',
  // Tried in order when the model returns 5xx (overloaded, not our bug).
  yedekModeller: ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
}
