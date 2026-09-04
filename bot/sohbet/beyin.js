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

const fs = require('fs')
const path = require('path')
const config = require('../config')
const log = require('../utils/log')
const { aracTanimi, komutSatiri } = require('./araclar')
const saglayicilar = require('./saglayici')

// Oyuncu başına son mesajlar. Bağlam olmadan "3 tane daha" anlamsız.
const gecmisler = new Map()
const GECMIS_SINIRI = 6      // 3 tur (soru + cevap)

// Oyuncu başına son çağrı zamanı — chat'i spam'leyen biri fatura üretmesin
const sonCagri = new Map()

// PER-ATTEMPT timeout.
//
// Went 12s -> 6s to fit more attempts in the budget, and that was the wrong
// correction: the successful reply had spent 400 tokens *thinking*, so 6s
// cut off the combination that worked. Thinking is now capped (see
// gemini.js `thinking_level`), which is the real fix; the timeout goes back
// up because a slow answer still beats no answer.
const ZAMAN_ASIMI_MS = 15000
// Budget for the whole walk. A chat reply that takes a minute is not a reply.
const TOPLAM_SURE_MS = 30000

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
 * One HTTP call for one (model, transport) pair.
 */
async function tekCagri (s, istek, deneme, govde = null) {
  const kontrolcu = new AbortController()
  const saat = setTimeout(() => kontrolcu.abort(), ZAMAN_ASIMI_MS)
  const tam = { ...istek, model: deneme.model }
  try {
    const cevap = await fetch(deneme.tasiyici.url(tam), {
      method: 'POST',
      headers: s.baslik(config),
      body: JSON.stringify(govde || deneme.tasiyici.govde(tam)),
      signal: kontrolcu.signal
    })
    if (!cevap.ok) {
      const govdeMetni = (await cevap.text()).slice(0, 300)
      const hata = new Error(`HTTP ${cevap.status}: ${govdeMetni}`)
      hata.durum = cevap.status
      hata.metin = govdeMetni
      throw hata
    }
    return s.coz(await cevap.json())
  } finally {
    clearTimeout(saat)
  }
}

/**
 * One attempt, retried once without the thinking setting if that is what
 * the API objected to.
 *
 * Which thinking levels a model accepts varies and the docs did not match
 * reality: 'minimal' is documented for some models, and a live 400 said
 * "'minimal' is not a supported thinking level for this model. Allowed
 * values are: medium, low, high." Rather than keep a per-model table that
 * will go stale, drop the field and try again — the request is still valid
 * without it, just slower.
 */
async function tekCagriEsnek (s, istek, deneme) {
  try {
    return await tekCagri(s, istek, deneme)
  } catch (err) {
    const dusunmeHatasi = err.durum === 400 && /thinking/i.test(err.metin || '')
    if (!dusunmeHatasi || typeof s.dusunmeyiCikar !== 'function') throw err

    log.uyari(`${deneme.model}: dusunme ayari kabul edilmedi, onsuz deneniyor`)
    const tam = { ...istek, model: deneme.model }
    return tekCagri(s, istek, deneme, s.dusunmeyiCikar(deneme.tasiyici.govde(tam)))
  }
}

/**
 * Which (model, transport) answered last — remembered ACROSS RESTARTS.
 *
 * Measured on a free-tier key: four of six combinations returned
 * 503/500/timeout before one worked. Re-walking that list puts tens of
 * seconds in front of a chat reply, and the bot gets restarted constantly
 * during development, so an in-memory cache alone was not enough — the
 * first message after every restart paid the full walk.
 *
 * The file is a hint, not state: if the remembered choice fails the walk
 * resumes normally and the file is rewritten.
 */
const TERCIH_DOSYASI = path.join(__dirname, '..', '..', '.sohbet_tercihi.json')
let sonCalisan = null

function tercihiOku () {
  try {
    const kayit = JSON.parse(fs.readFileSync(TERCIH_DOSYASI, 'utf8'))
    if (kayit && kayit.model && kayit.tasiyici) return kayit
  } catch { /* dosya yok ya da bozuk — onemli degil */ }
  return null
}

function tercihiYaz (deneme) {
  try {
    fs.writeFileSync(TERCIH_DOSYASI, JSON.stringify({
      model: deneme.model,
      tasiyici: deneme.tasiyici.ad,
      tarih: new Date().toISOString()
    }, null, 2))
  } catch (err) {
    log.uyari(`Sohbet tercihi yazilamadi: ${err.message}`)
  }
}

/** Put the last known-good attempt first. */
function sirala (liste) {
  const tercih = sonCalisan || tercihiOku()
  if (!tercih) return liste
  const ad = tercih.tasiyici.ad || tercih.tasiyici   // bellek | dosya
  const i = liste.findIndex((d) => d.model === tercih.model && d.tasiyici.ad === ad)
  if (i <= 0) return liste
  return [liste[i], ...liste.slice(0, i), ...liste.slice(i + 1)]
}

/**
 * Walks the provider's (model, transport) list until one answers.
 *
 * Failures seen in practice are transient or per-model, not per-request:
 * 503/500 "high demand" on a busy model, 404 "no longer available to new
 * users" on a retired one, and plain timeouts. None is worth surfacing to
 * the player as long as some combination works.
 *
 * 4xx other than 404/429 stops the walk — that is our request being wrong,
 * and another model will fail the same way.
 *
 * TOPLAM SURE SINIRI: a chat reply that takes a minute is not a reply. The
 * walk gives up once the budget is spent, even with combinations left.
 */
async function apiCagir (s, istek) {
  const liste = sirala(s.denemeler(config.sohbetModeli))
  const bitis = Date.now() + TOPLAM_SURE_MS
  let sonHata
  for (const deneme of liste) {
    if (Date.now() > bitis) {
      log.uyari('Sohbet: sure butcesi doldu, kalan modeller denenmedi')
      break
    }
    try {
      const sonuc = await tekCagriEsnek(s, istek, deneme)
      if (!sonCalisan || sonCalisan.model !== deneme.model ||
          sonCalisan.tasiyici.ad !== deneme.tasiyici.ad) {
        tercihiYaz(deneme)
      }
      sonCalisan = deneme
      return sonuc
    } catch (err) {
      sonHata = err
      const gecici = err.durum >= 500 || err.durum === 429 || err.durum === 404 ||
                     err.durum === undefined // timeout / network
      if (!gecici) throw err
      if (sonCalisan && sonCalisan.model === deneme.model &&
          sonCalisan.tasiyici.ad === deneme.tasiyici.ad) {
        sonCalisan = null // artik calismiyor, tercihi birak
      }
      log.uyari(`${deneme.model}/${deneme.tasiyici.ad} olmadi (${err.durum || 'zaman asimi'})`)
    }
  }
  throw sonHata || new Error('sure butcesi doldu')
}

/** Tests reset the remembered choice. */
function tercihiSifirla () {
  sonCalisan = null
  try { fs.unlinkSync(TERCIH_DOSYASI) } catch { /* zaten yok */ }
}

function gecmisiSil (oyuncu) {
  if (oyuncu) gecmisler.delete(oyuncu)
  else gecmisler.clear()
}

module.exports = {
  yorumla, acik, saglayici, gecmisiSil, tercihiSifirla, durumOzeti, sistemMetni
}
