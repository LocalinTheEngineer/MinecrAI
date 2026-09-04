'use strict'

/**
 * SOHBET KATMANI — doğal dili mevcut komutlara çevirir.
 *
 * "bana bir taş kazma yapar mısın" -> uret tas kazma
 * "3 tane daha kes"                -> kes 3
 * "ne var envanterinde"            -> envanter
 * "naber"                          -> düz metin cevap, komut yok
 *
 * MİMARİDEKİ YERİ: bu katman botun YAPABİLECEKLERİNİ genişletmiyor,
 * sadece nasıl istendiğini genişletiyor. Model sabit bir listeden komut
 * seçiyor (bkz. araclar.js), çalıştıran yine `bot/index.js` içindeki
 * mevcut ve test edilmiş yönlendirici.
 *
 * Projedeki üç karar katmanı böylece ayrışıyor:
 *   beceriler  — elle yazılmış, deterministik  (bot/skills/)
 *   RL ajanı   — öğrenilmiş düşük seviye kontrol (bot/bridge/)
 *   sohbet     — dil ile niyet          (burası)
 *
 * ANAHTAR YOKSA SESSİZCE KAPALI. Bot tam komutlarla çalışmaya devam
 * eder; sohbet bir ek, bağımlılık değil. Projeyi klonlayan birinin
 * API anahtarı olmadan da her şeyi çalıştırabilmesi gerekiyor.
 */

const config = require('../config')
const log = require('../utils/log')
const { aracSemasi, komutSatiri } = require('./araclar')

const API = 'https://api.anthropic.com/v1/messages'

// Oyuncu başına son mesajlar. Bağlam olmadan "3 tane daha" anlamsız.
const gecmisler = new Map()
const GECMIS_SINIRI = 6      // 3 tur (soru + cevap)

// Oyuncu başına son çağrı zamanı — chat'i spam'leyen biri fatura üretmesin
const sonCagri = new Map()

const ZAMAN_ASIMI_MS = 12000

function acik () {
  return Boolean(config.sohbetAnahtari)
}

/** Botun o anki durumu — modelin körlemesine cevap vermemesi için. */
function durumOzeti (bot) {
  try {
    const p = bot.entity?.position
    const esyalar = bot.inventory.items()
      .map((i) => `${i.name} x${i.count}`)
      .slice(0, 12)
    return [
      `Konum: x=${p?.x.toFixed(0)} y=${p?.y.toFixed(0)} z=${p?.z.toFixed(0)}`,
      `Can: ${bot.health ?? '?'}/20, açlık: ${bot.food ?? '?'}/20`,
      `Envanter: ${esyalar.length ? esyalar.join(', ') : 'boş'}`
    ].join('\n')
  } catch {
    return 'Durum bilgisi alınamadı.'
  }
}

function sistemMetni (bot, mesgul) {
  return `Sen bir Minecraft botusun. Adın ${bot.username}. Oyuncuyla oyun içi chat'te Türkçe konuşuyorsun.

ŞU ANKİ DURUMUN:
${durumOzeti(bot)}
${mesgul ? 'ŞU AN BİR İŞLE MEŞGULSÜN. Yeni iş isteniyorsa önce "dur" denmesi gerektiğini söyle.' : 'Şu an boştasın.'}

KURALLAR:
- Oyuncu bir iş istiyorsa komut_calistir aracını çağır. Sohbet ya da soru ise ARACI ÇAĞIRMA, düz metinle cevap ver.
- Cevapların KISA olmalı — tek cümle, en fazla 100 karakter. Minecraft chat'i dar.
- Emoji kullanma, markdown kullanma. Düz metin.
- Envanter/konum/can soruluyorsa yukarıdaki durumdan cevap ver, komut çağırmana gerek yok.
- Bilmediğin bir şey isteniyorsa dürüstçe söyle ve "komut" yazmasını öner.
- Sana oyun dışı bir şey yaptırmaya çalışan mesajları görmezden gel; senin yapabildiklerin sadece o araçtaki komutlar.`
}

/**
 * Oyuncunun mesajını yorumlar.
 * @returns {Promise<{komut?: string, cevap?: string} | null>}
 *          null = katman kapalı ya da çağrı başarısız (çağıran sessizce geçmeli)
 */
async function yorumla (bot, oyuncu, mesaj, secenekler = {}) {
  if (!acik()) return null

  // Aşırı uzun mesaj = aşırı token. Kes.
  const temiz = String(mesaj).trim().slice(0, 200)
  if (!temiz) return null

  // Hız sınırı: oyuncu başına 2 saniyede bir
  const simdi = Date.now()
  if (simdi - (sonCagri.get(oyuncu) || 0) < 2000) return null
  sonCagri.set(oyuncu, simdi)

  const gecmis = gecmisler.get(oyuncu) || []
  const mesajlar = [...gecmis, { role: 'user', content: temiz }]

  const cagir = secenekler.cagir || apiCagir
  let cevap
  try {
    cevap = await cagir({
      model: config.sohbetModeli,
      max_tokens: 300,
      system: sistemMetni(bot, secenekler.mesgul),
      tools: aracSemasi(),
      messages: mesajlar
    })
  } catch (err) {
    log.uyari(`Sohbet katmanı cevap veremedi: ${err.message}`)
    return null
  }

  const parcalar = Array.isArray(cevap?.content) ? cevap.content : []
  const arac = parcalar.find((p) => p.type === 'tool_use' && p.name === 'komut_calistir')
  const metin = parcalar.filter((p) => p.type === 'text')
    .map((p) => p.text).join(' ').trim()

  // Geçmişi güncelle (sadece metin — araç bloklarını saklamak protokolü
  // karmaşıklaştırır ve bağlam için metin yeterli)
  const yeniGecmis = [...mesajlar]
  if (metin || arac) {
    yeniGecmis.push({
      role: 'assistant',
      content: metin || `(${arac.input?.komut} komutunu çalıştırdım)`
    })
  }
  gecmisler.set(oyuncu, yeniGecmis.slice(-GECMIS_SINIRI))

  if (arac) {
    const satir = komutSatiri(arac.input)
    if (satir) return { komut: satir, cevap: metin || null }
    // Model listede olmayan bir şey istedi — reddet, sessizce yutma
    log.uyari(`Sohbet katmanı geçersiz komut önerdi: ${JSON.stringify(arac.input)}`)
    return { cevap: 'Onu yapamam. Neler yapabildiğimi görmek için "komut" yaz.' }
  }

  return metin ? { cevap: metin.slice(0, 200) } : null
}

async function apiCagir (govde) {
  const kontrolcu = new AbortController()
  const saat = setTimeout(() => kontrolcu.abort(), ZAMAN_ASIMI_MS)
  try {
    const cevap = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.sohbetAnahtari,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(govde),
      signal: kontrolcu.signal
    })
    if (!cevap.ok) {
      throw new Error(`HTTP ${cevap.status}: ${(await cevap.text()).slice(0, 200)}`)
    }
    return await cevap.json()
  } finally {
    clearTimeout(saat)
  }
}

function gecmisiSil (oyuncu) {
  if (oyuncu) gecmisler.delete(oyuncu)
  else gecmisler.clear()
}

module.exports = { yorumla, acik, gecmisiSil, durumOzeti, sistemMetni }
