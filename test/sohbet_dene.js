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

  const denemeler = s.denemeler(config.sohbetModeli)
  const model = denemeler[0].model
  console.log(`\n=== 2. SAGLAYICI: ${s.ad} ===`)
  console.log(`  ${denemeler.length} kombinasyon denenecek:`)
  for (const d of denemeler) console.log(`    ${d.model} / ${d.tasiyici.ad}`)

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

  // Walk exactly the list the bot walks. A diagnostic that tests something
  // else is testing the wrong program — this one reported failure while the
  // bot would have coped, until it was fixed to match.
  console.log(`\n=== 4. ISTEK: "${mesaj}" ===`)

  let ham
  let calisan
  for (const d of denemeler) {
    process.stdout.write(`  ${d.model} / ${d.tasiyici.ad} ... `)
    const tam = { ...istek, model: d.model }
    try {
      const cevap = await zamanliFetch(d.tasiyici.url(tam), {
        method: 'POST',
        headers: s.baslik(config),
        body: JSON.stringify(d.tasiyici.govde(tam))
      }, 25000)
      const metin = await cevap.text()
      if (cevap.ok) {
        console.log('HTTP', cevap.status, '- CALISTI')
        ham = JSON.parse(metin)
        calisan = d
        break
      }
      console.log('HTTP', cevap.status)
      let sebep = metin.slice(0, 300).replace(/\s+/g, ' ')
      try { sebep = JSON.parse(metin).error?.message || sebep } catch {}
      console.log(`      ${sebep}`)
      if (cevap.status === 401 || cevap.status === 403) {
        console.log('\n  NE YAPMALI: anahtar bu API icin gecersiz. Yeni anahtar al:')
        console.log('  https://aistudio.google.com/apikey')
        process.exit(1)
      }
    } catch (err) {
      console.log('HATA -', err.message)
    }
  }

  if (!ham) {
    console.log('\n  Hicbir kombinasyon cevap vermedi.')
    console.log('  503/429 = Google tarafi mesgul, kodunla ilgisi yok; sonra dene.')
    console.log('  404 = o model artik yok. Yukaridaki "3b" listesinden birini sec')
    console.log('  ve .env dosyana yaz, ornegin:  SOHBET_MODELI=gemini-flash-latest')
    process.exit(1)
  }
  if (calisan !== denemeler[0]) {
    console.log(`\n  NOT: ilk secenek olmadi, "${calisan.model} / ${calisan.tasiyici.ad}" calisti.`)
    console.log(`  Bot da ayni sirayi izliyor, yani sorun degil. Kalici yapmak istersen:`)
    console.log(`  .env dosyana ekle ->  SOHBET_MODELI=${calisan.model}`)
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
