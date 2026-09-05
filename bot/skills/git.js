'use strict'

const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const yerler = require('../utils/yerler')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')

/**
 * SKILL: walk to a coordinate or to a saved place.
 *
 * `gel` already walks somewhere, but it walks to a player entity, which has
 * to be loaded and visible. A coordinate has neither constraint, and it is
 * what the player reads off the F3 screen.
 *
 * Two numbers are accepted as well as three. F3 shows x/y/z but people
 * remember x and z; the y they were standing at is rarely the y they want.
 * With two numbers the goal ignores height and the pathfinder picks whatever
 * ground is there.
 */

// Same escalation idea as gel.js: the exact cell can be a fence post or a
// slab the pathfinder will not stand on, and "2 blocks away" is arrived.
const DENEME_TOLERANSLARI = [1, 3, 6]

// Beyond this the walk is not worth starting. Pathfinder searches a graph,
// and the cost grows with distance; past a few hundred blocks it mostly
// spends minutes and then fails in an unloaded chunk. Refusing with a number
// is more useful than a five-minute silence.
const MAKS_MESAFE = 1000

// Above this it will work but take a while, so say so before starting.
const UZUN_MESAFE = 150

// Budget per attempt. A fixed 30s (what `gel` uses) is fine next door and
// far too short for 400 blocks, so it scales and then stops scaling.
function sureButcesi (mesafe) {
  return Math.min(240000, 30000 + Math.round(mesafe * 700))
}

/**
 * Reads a target out of what the player typed.
 *
 * Accepts "100 64 -200", "100 -200" and a saved place name. Returns
 * `{x, y, z, ad}` with `y === null` when no height was given.
 */
function hedefCoz (metin) {
  const ham = (metin || '').trim()
  if (!ham) return { hata: 'bos' }

  const sayilar = ham.split(/[\s,]+/).filter(Boolean)
  const hepsiSayi = sayilar.length >= 2 &&
    sayilar.every((s) => /^-?\d+(\.\d+)?$/.test(s))

  if (hepsiSayi) {
    const n = sayilar.map(Number)
    if (n.length === 2) return { x: Math.floor(n[0]), y: null, z: Math.floor(n[1]) }
    return { x: Math.floor(n[0]), y: Math.floor(n[1]), z: Math.floor(n[2]) }
  }

  const yer = yerler.bul(ham)
  if (yer) return { x: yer.x, y: yer.y, z: yer.z, ad: yer.ad }

  return { hata: 'bilinmiyor' }
}

function hedefiYaz (h) {
  return h.ad
    ? `${h.ad} (${h.x}, ${h.y}, ${h.z})`
    : `${h.x}, ${h.y === null ? '?' : h.y}, ${h.z}`
}

async function git (bot, kontrol, metin) {
  const hedef = hedefCoz(metin)

  if (hedef.hata === 'bos') {
    bot.chat('Nereye? "git 100 64 -200" ya da kayıtlı bir yer adı yaz ("git ev").')
    return { basarili: false, hata: 'bos' }
  }
  if (hedef.hata === 'bilinmiyor') {
    const l = yerler.liste()
    bot.chat(l.length === 0
      ? `"${metin}" diye bir yer kayıtlı değil. Bir yere gelip "burasi ${metin}" yazarsan kaydederim.`
      : `"${metin}" diye bir yer yok. Bildiklerim: ${l.map((y) => y.ad).join(', ')}`)
    return { basarili: false, hata: 'bilinmiyor' }
  }

  const p = bot.entity.position
  const dx = hedef.x - p.x
  const dz = hedef.z - p.z
  const mesafe = Math.sqrt(dx * dx + dz * dz)

  if (mesafe > MAKS_MESAFE) {
    bot.chat(`Orası ${mesafe.toFixed(0)} blok uzakta, o kadar yolu yürüyemem (sınır ${MAKS_MESAFE}).`)
    return { basarili: false, hata: 'cok_uzak', mesafe }
  }
  if (mesafe < 2 && (hedef.y === null || Math.abs(p.y - hedef.y) < 3)) {
    bot.chat('Zaten oradayım.')
    return { basarili: true, mesafe }
  }
  if (mesafe > UZUN_MESAFE) {
    bot.chat(`${hedefiYaz(hedef)} — ${mesafe.toFixed(0)} blok var, biraz sürer.`)
  }

  let sonHata = null

  for (const tolerans of DENEME_TOLERANSLARI) {
    kontrol.kontrolEt()

    const amac = hedef.y === null
      ? new goals.GoalNearXZ(hedef.x, hedef.z, tolerans)
      : new goals.GoalNear(hedef.x, hedef.y, hedef.z, tolerans)

    log.bilgi(`git: ${hedefiYaz(hedef)} (tolerans ${tolerans}, mesafe ${mesafe.toFixed(0)})`)

    try {
      pathfinderHazirla(bot) // a latch may be left over from the previous command
      await sinirli(bot.pathfinder.goto(amac), sureButcesi(mesafe), kontrol)

      // Report the real distance, not the pathfinder's opinion. It can stop
      // one wall short and call that done.
      const s = bot.entity.position
      const kalan = Math.sqrt((hedef.x - s.x) ** 2 + (hedef.z - s.z) ** 2)

      log.basari(`Vardım (kalan ${kalan.toFixed(1)} blok).`)
      bot.chat(hedef.ad ? `${hedef.ad} noktasındayım.` : `Geldim (${s.x.toFixed(0)}, ${s.y.toFixed(0)}, ${s.z.toFixed(0)}).`)
      return { basarili: true, kalan }
    } catch (err) {
      if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }

      sonHata = err.message
      log.uyari(`git: tolerans ${tolerans} başarısız — ham hata: "${err.message}"`)
      pathfinderDurdur(bot)
      await new Promise((r) => setTimeout(r, 400)) // let pathfinder settle
    }
  }

  log.hata(`git: üç deneme de başarısız. Son hata: ${sonHata}`)
  bot.chat(`${hedefiYaz(hedef)} noktasına ulaşamadım (${sonHata}).`)
  return { basarili: false, hata: sonHata }
}

module.exports = { git, hedefCoz, MAKS_MESAFE, UZUN_MESAFE, sureButcesi }
