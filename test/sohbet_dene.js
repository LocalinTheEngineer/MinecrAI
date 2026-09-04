'use strict'

/**
 * Chat layer diagnostic. No Minecraft, no server needed.
 *
 *   node test/sohbet_dene.js
 *   node test/sohbet_dene.js "bana bir tahta balta yapar misin"
 *
 * Makes one real API call and prints exactly what came back. Exists
 * because "the bot doesn't answer" has at least five possible causes
 * and guessing between them wastes more time than measuring.
 */

const config = require('../bot/config')
const { sec, SAGLAYICILAR } = require('../bot/sohbet/saglayici')
const { aracTanimi, komutSatiri } = require('../bot/sohbet/araclar')

const mesaj = process.argv[2] || 'bana bir tahta balta yapar misin'

/**
 * fetch with a timeout.
 *
 * Plain fetch can hang with no output at all — which is exactly what
 * happened the first time this script ran: it stopped after printing the
 * request and never came back. A diagnostic that can hang is not a
 * diagnostic.
 */
async function zamanliFetch (url, secenekler, ms) {
  const kontrolcu = new AbortController()
  const saat = setTimeout(() => kontrolcu.abort(), ms)
  try {
    return await fetch(url, { ...secenekler, signal: kontrolcu.signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`${ms / 1000} saniyede cevap gelmedi (zaman asimi)`)
    }
    throw err
  } finally {
    clearTimeout(saat)
  }
}

function gizle (a) {
  if (!a) return '(bos)'
  return `${a.slice(0, 6)}...${a.slice(-4)} (${a.length} karakter)`
}

async function main () {
  console.log('=== 1. ANAHTARLAR ===')
  console.log('  GEMINI_API_KEY   :', gizle(config.geminiAnahtari))
  console.log('  ANTHROPIC_API_KEY:', gizle(config.anthropicAnahtari))
  console.log('  SOHBET_SAGLAYICI :', config.sohbetSaglayici || '(otomatik)')
  console.log('  SOHBET_MODELI    :', config.sohbetModeli || '(saglayici varsayilani)')

  let s
  try {
    s = sec(config)
  } catch (err) {
    console.log('\n  HATA:', err.message)
    console.log('  Gecerli degerler:', Object.keys(SAGLAYICILAR).join(', '))
    process.exit(1)
  }
  if (!s) {
    console.log('\n  SONUC: Hicbir anahtar yok, sohbet katmani KAPALI.')
    console.log('  .env dosyasina GEMINI_API_KEY=... ekle.')
    console.log('  Anahtar: https://aistudio.google.com/apikey')
    process.exit(1)
  }

  const model = config.sohbetModeli || s.varsayilanModel
  console.log(`\n=== 2. SAGLAYICI: ${s.ad}, model: ${model} ===`)

  const istek = {
    model,
    maksToken: 300,
    sistem: 'Sen bir Minecraft botusun. Oyuncu bir is istiyorsa komut_calistir aracini cagir, ' +
            'sohbet ise duz metinle KISA cevap ver. Turkce konus.',
    arac: aracTanimi(),
    mesajlar: [{ rol: 'oyuncu', metin: mesaj }]
  }

  // --- 3a. Once BAGLANTI, sonra anahtar, sonra istek. Sirayla daralt.
  console.log('\n=== 3. BAGLANTI ===')
  const hedef = new URL(s.API).origin
  try {
    await zamanliFetch(hedef, { method: 'HEAD' }, 8000)
    console.log(`  ${hedef} erisilebilir.`)
  } catch (err) {
    console.log(`  ${hedef} ERISILEMEDI: ${err.message}`)
    console.log('\n  NE YAPMALI: internet baglantini, guvenlik duvarini ya da')
    console.log('  VPN/proxy ayarlarini kontrol et. Anahtarla ilgisi yok.')
    process.exit(1)
  }

  // --- 3b. Anahtar gecerli mi? Basit bir GET, arac/model karmasasi yok.
  if (s.ad === 'gemini') {
    console.log('\n=== 3b. ANAHTAR GECERLI MI (model listesi) ===')
    try {
      const c = await zamanliFetch(
        'https://generativelanguage.googleapis.com/v1beta/models',
        { headers: { 'x-goog-api-key': config.geminiAnahtari } }, 15000)
      console.log('  HTTP', c.status)
      const g = await c.text()
      if (!c.ok) {
        console.log('  ' + g.slice(0, 800).replace(/\n/g, '\n  '))
        console.log('\n  NE YAPMALI: anahtar bu API icin gecerli degil.')
        console.log('  https://aistudio.google.com/apikey adresinden "Create API key"')
        console.log('  ile YENI bir anahtar al. (Google Cloud OAuth belirteci ya da')
        console.log('  baska bir Google urununun anahtari burada calismaz.)')
        process.exit(1)
      }
      const liste = JSON.parse(g).models || []
      const adlar = liste.map((m) => (m.name || '').replace('models/', ''))
      console.log(`  Anahtar GECERLI. ${adlar.length} model erisilebilir.`)
      const uygun = adlar.filter((a) => /flash|lite/.test(a)).slice(0, 8)
      if (uygun.length) console.log('  Ornekler:', uygun.join(', '))
      if (adlar.length && !adlar.includes(model)) {
        console.log(`\n  DIKKAT: "${model}" listede YOK.`)
        console.log(`  .env dosyana su satiri ekle:  SOHBET_MODELI=${uygun[0] || adlar[0]}`)
      }
    } catch (err) {
      console.log('  Model listesi alinamadi:', err.message)
    }
  }

  console.log(`\n=== 4. ISTEK: "${mesaj}" ===`)

  let ham
  try {
    const cevap = await zamanliFetch(s.API, {
      method: 'POST',
      headers: s.baslik(config),
      body: JSON.stringify(s.govde(istek))
    }, 20000)
    const metin = await cevap.text()
    console.log('  HTTP', cevap.status)
    if (!cevap.ok) {
      console.log('\n  SUNUCU CEVABI:')
      console.log('  ' + metin.slice(0, 1200).replace(/\n/g, '\n  '))
      console.log('\n  NE YAPMALI:')
      if (cevap.status === 400) console.log('  400 = istek bicimi yanlis. Cikti bana yapistir.')
      if (cevap.status === 401 || cevap.status === 403) console.log('  Anahtar gecersiz ya da yetkisi yok. Yeni anahtar al.')
      if (cevap.status === 404) console.log(`  Model "${model}" bulunamadi. .env'e SOHBET_MODELI=<baska model> yaz.`)
      if (cevap.status === 429) console.log('  Ucretsiz kota doldu. Birkaç dakika bekle.')
      process.exit(1)
    }
    ham = JSON.parse(metin)
  } catch (err) {
    console.log('  AG HATASI:', err.message)
    console.log('\n  Internet baglantisi ya da guvenlik duvari engelliyor olabilir.')
    process.exit(1)
  }

  console.log('\n=== 5. HAM CEVAP ===')
  console.log('  ' + JSON.stringify(ham).slice(0, 1000))

  console.log('\n=== 6. COZUMLEME ===')
  const cozulmus = s.coz(ham)
  console.log('  metin:', JSON.stringify(cozulmus.metin))
  console.log('  arac :', JSON.stringify(cozulmus.arac))
  console.log('  komut:', JSON.stringify(komutSatiri(cozulmus.arac)))

  const iyi = cozulmus.metin || cozulmus.arac
  console.log('\n' + (iyi
    ? '=== CALISIYOR — bot bu mesaja cevap verebilir. ==='
    : '=== COZUMLEME BOS — API cevap verdi ama okuyamadik. 5. adimi bana yapistir. ==='))
}

main()
