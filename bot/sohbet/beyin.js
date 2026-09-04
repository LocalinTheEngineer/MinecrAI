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
const { aracTanimi, komutSatiri } = require('./araclar')
const saglayicilar = require('./saglayici')

// Oyuncu başına son mesajlar. Bağlam olmadan "3 tane daha" anlamsız.
const gecmisler = new Map()
const GECMIS_SINIRI = 6      // 3 tur (soru + cevap)

// Oyuncu başına son çağrı zamanı — chat'i spam'leyen biri fatura üretmesin
const sonCagri = new Map()

const ZAMAN_ASIMI_MS = 12000

/** Hangi sağlayıcı kullanılacak? Anahtar yoksa null. */
function saglayici () {
  try {
    return saglayicilar.sec(config)
  } catch (err) {
    log.uyari(err.message)
    return null
  }
}

function acik () {
  return saglayici() !== null
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
  const s = saglayici()
  if (!s) return null

  // Aşırı uzun mesaj = aşırı token. Kes.
  const temiz = String(mesaj).trim().slice(0, 200)
  if (!temiz) return null

  // Hız sınırı: oyuncu başına 2 saniyede bir
  const simdi = Date.now()
  if (simdi - (sonCagri.get(oyuncu) || 0) < 2000) return null
  sonCagri.set(oyuncu, simdi)

  const gecmis = gecmisler.get(oyuncu) || []
  const mesajlar = [...gecmis, { rol: 'oyuncu', metin: temiz }]

  // İstek SAĞLAYICIDAN BAĞIMSIZ biçimde kuruluyor; her sağlayıcı onu
  // kendi API'sinin şekline çeviriyor (bkz. saglayici/). Böylece
  // sistem metni, araç tanımı ve geçmiş mantığı tek yerde kalıyor.
  const istek = {
    model: config.sohbetModeli || s.varsayilanModel,
    maksToken: 300,
    sistem: sistemMetni(bot, secenekler.mesgul),
    arac: aracTanimi(),
    mesajlar
  }

  const cagir = secenekler.cagir || ((i) => apiCagir(s, i))
  let cozulmus
  try {
    cozulmus = await cagir(istek, s)
  } catch (err) {
    log.uyari(`Sohbet katmanı cevap veremedi (${s.ad}): ${err.message}`)
    return null
  }

  const arac = cozulmus?.arac || null
  const metin = (cozulmus?.metin || '').trim()

  // Geçmişi güncelle (sadece metin — araç bloklarını saklamak protokolü
  // karmaşıklaştırır ve bağlam için metin yeterli)
  const yeniGecmis = [...mesajlar]
  if (metin || arac) {
    yeniGecmis.push({
      rol: 'bot',
      metin: metin || `(${arac.komut} komutunu çalıştırdım)`
    })
  }
  gecmisler.set(oyuncu, yeniGecmis.slice(-GECMIS_SINIRI))

  if (arac) {
    const satir = komutSatiri(arac)
    if (satir) return { komut: satir, cevap: metin || null }
    // Model listede olmayan bir şey istedi — reddet, sessizce yutma
    log.uyari(`Sohbet katmanı geçersiz komut önerdi: ${JSON.stringify(arac)}`)
    return { cevap: 'Onu yapamam. Neler yapabildiğimi görmek için "komut" yaz.' }
  }

  return metin ? { cevap: metin.slice(0, 200) } : null
}

/**
 * One HTTP call. No retry logic here — see `apiCagir`.
 */
async function tekCagri (s, istek) {
  const kontrolcu = new AbortController()
  const saat = setTimeout(() => kontrolcu.abort(), ZAMAN_ASIMI_MS)
  try {
    const cevap = await fetch(s.url(istek), {
      method: 'POST',
      headers: s.baslik(config),
      body: JSON.stringify(s.govde(istek)),
      signal: kontrolcu.signal
    })
    if (!cevap.ok) {
      const hata = new Error(`HTTP ${cevap.status}: ${(await cevap.text()).slice(0, 200)}`)
      hata.durum = cevap.status
      throw hata
    }
    return s.coz(await cevap.json())
  } finally {
    clearTimeout(saat)
  }
}

/**
 * Calls the API, falling back to another model on 5xx.
 *
 * Measured: a pinned lite model returned HTTP 500 "currently experiencing
 * high demand" while the account, key and request were all fine. That is
 * the provider being busy, not a bug to surface to the player — so try the
 * next model instead of going quiet.
 */
async function apiCagir (s, istek) {
  const modeller = [istek.model, ...(s.yedekModeller || [])]
  let sonHata
  for (const model of modeller) {
    try {
      return await tekCagri(s, { ...istek, model })
    } catch (err) {
      sonHata = err
      // 5xx = sunucu mesgul, baska modeli dene. 4xx = bizim hatamiz, dene deme.
      if (!(err.durum >= 500)) throw err
      if (model !== modeller[modeller.length - 1]) {
        log.uyari(`${model} mesgul (${err.durum}), yedek modele geciliyor`)
      }
    }
  }
  throw sonHata
}

function gecmisiSil (oyuncu) {
  if (oyuncu) gecmisler.delete(oyuncu)
  else gecmisler.clear()
}

module.exports = { yorumla, acik, saglayici, gecmisiSil, durumOzeti, sistemMetni }
