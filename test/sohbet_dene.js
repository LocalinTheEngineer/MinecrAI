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
  const hedef = new URL(s.url(istek)).origin
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
      const ad = (m) => (m.name || '').replace('models/', '')
      const destekli = (m) => m.supportedGenerationMethods || m.supported_generation_methods || []
      console.log(`  Anahtar GECERLI. ${liste.length} model erisilebilir.`)

      // generateContent DESTEKLEYENLER — asil onemli olan bu.
      // Bir model listede olabilir ama bu yontemi desteklemiyor olabilir;
      // o zaman istek ya garip bir hata verir ya da hic cevap vermez.
      const uygun = liste.filter((m) => destekli(m).includes('generateContent')).map(ad)
      const ornek = uygun.filter((a) => /flash|lite/.test(a) && !/image|tts|audio|live/.test(a))
      console.log(`  generateContent destekleyen: ${uygun.length} model`)
      if (ornek.length) console.log('  Uygun ornekler:', ornek.slice(0, 6).join(', '))

      const secili = liste.find((m) => ad(m) === model)
      if (!secili) {
        console.log(`\n  DIKKAT: "${model}" listede YOK.`)
        console.log(`  .env dosyana ekle:  SOHBET_MODELI=${ornek[0] || uygun[0]}`)
      } else if (!destekli(secili).includes('generateContent')) {
        console.log(`\n  DIKKAT: "${model}" generateContent DESTEKLEMIYOR.`)
        console.log(`  Destekledikleri: ${destekli(secili).join(', ') || '(bilinmiyor)'}`)
        console.log(`  .env dosyana ekle:  SOHBET_MODELI=${ornek[0] || uygun[0]}`)
      } else {
        console.log(`  "${model}" generateContent destekliyor.`)
      }
    } catch (err) {
      console.log('  Model listesi alinamadi:', err.message)
    }
  }

  // Try the primary model then the fallbacks — the same thing the bot does.
  // A diagnostic that tests one model while the bot tries three is testing
  // the wrong program: it reported failure while the bot would have coped.
  const denenecek = [model, ...(s.yedekModeller || []).filter((m) => m !== model)]
  console.log(`\n=== 4. ISTEK: "${mesaj}" ===`)
  console.log('  Denenecek modeller:', denenecek.join(' -> '))

  let ham
  let calisan
  for (const m of denenecek) {
    process.stdout.write(`  ${m} ... `)
    try {
      const cevap = await zamanliFetch(s.url({ ...istek, model: m }), {
        method: 'POST',
        headers: s.baslik(config),
        body: JSON.stringify(s.govde({ ...istek, model: m }))
      }, 25000)
      const metin = await cevap.text()
      if (cevap.ok) {
        console.log('HTTP', cevap.status, '- CALISTI')
        ham = JSON.parse(metin)
        calisan = m
        break
      }
      console.log('HTTP', cevap.status)
      let sebep = metin.slice(0, 200).replace(/\s+/g, ' ')
      try { sebep = JSON.parse(metin).error?.message || sebep } catch {}
      console.log(`      ${sebep}`)
      if (cevap.status < 500 && cevap.status !== 429) {
        // 4xx = bizim hatamiz, baska model denemek anlamsiz
        console.log('\n  NE YAPMALI:')
        if (cevap.status === 400) console.log('  Istek bicimi yanlis. Ciktiyi bana yapistir.')
        if (cevap.status === 401 || cevap.status === 403) console.log('  Anahtar bu API icin gecersiz. Yeni anahtar al.')
        if (cevap.status === 404) console.log(`  Model "${m}" bulunamadi.`)
        process.exit(1)
      }
    } catch (err) {
      console.log('HATA -', err.message)
    }
  }

  if (!ham) {
    console.log('\n  Hicbir model cevap vermedi.')
    console.log('  503/429 = Google tarafi mesgul, senin kodunla ilgisi yok.')
    console.log('  Birkac dakika sonra tekrar dene. Surekli oluyorsa .env dosyana')
    console.log('  baska bir model yaz, ornegin:  SOHBET_MODELI=gemini-2.5-flash')
    process.exit(1)
  }
  if (calisan !== model) {
    console.log(`\n  NOT: "${model}" mesguldu, "${calisan}" calisti.`)
    console.log(`  Bot da ayni sekilde yedege geciyor. Kalici yapmak istersen:`)
    console.log(`  .env dosyana ekle ->  SOHBET_MODELI=${calisan}`)
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
