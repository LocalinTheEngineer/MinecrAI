'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const log = require('../utils/log')
const { IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')
const { uygunAlet } = require('./alet')
const { uret } = require('./uret')
const { dusenleriTopla } = require('./chopTree')
const koruma = require('../utils/koruma')

/**
 * SKILL: Kaz  ("kaz demir", "kaz elmas 5")
 *
 * Madencilik ağaç kesmekten üç noktada ayrılıyor:
 *
 * 1) ALET ZORUNLU. Taşı elle kırarsan blok yok olur, hiçbir şey düşmez.
 *    Demir cevheri taş kazma ister, elmas demir kazma ister. Yanlış
 *    kazmayla kırmak cevheri YOK ETMEK demek — botun kendi ayağına
 *    sıkması. O yüzden kırmadan önce seviye kontrolü yapıyoruz.
 *
 * 2) CEVHER GÖRÜNMÜYOR. Ağaç yüzeyde duruyor, cevher taşın içinde.
 *    Önce doğru derinliğe inmek, sonra aramak gerekiyor.
 *
 * 3) AŞAĞISI ÖLDÜRÜR. Dümdüz aşağı kazmak Minecraft'ın en klasik ölüm
 *    sebebi: altında lav gölü veya 30 bloklu bir mağara olabilir, ikisini
 *    de bloğu kırmadan göremezsin. Bu yüzden merdiven şeklinde iniyoruz —
 *    her adımda bir ileri bir aşağı, ayağının altı hep dolu.
 */

// Türkçe ad -> blok adları. Derinlerde taş yerine deepslate var,
// cevherin adı da değişiyor (iron_ore / deepslate_iron_ore) — ikisi de listede.
const CEVHERLER = {
  komur: { bloklar: ['coal_ore', 'deepslate_coal_ore'], seviye: 'wooden', y: 50 },
  kömür: { bloklar: ['coal_ore', 'deepslate_coal_ore'], seviye: 'wooden', y: 50 },
  bakir: { bloklar: ['copper_ore', 'deepslate_copper_ore'], seviye: 'stone', y: 48 },
  bakır: { bloklar: ['copper_ore', 'deepslate_copper_ore'], seviye: 'stone', y: 48 },
  demir: { bloklar: ['iron_ore', 'deepslate_iron_ore'], seviye: 'stone', y: 15 },
  altin: { bloklar: ['gold_ore', 'deepslate_gold_ore'], seviye: 'iron', y: -16 },
  altın: { bloklar: ['gold_ore', 'deepslate_gold_ore'], seviye: 'iron', y: -16 },
  redstone: { bloklar: ['redstone_ore', 'deepslate_redstone_ore'], seviye: 'iron', y: -58 },
  lapis: { bloklar: ['lapis_ore', 'deepslate_lapis_ore'], seviye: 'stone', y: 0 },
  elmas: { bloklar: ['diamond_ore', 'deepslate_diamond_ore'], seviye: 'iron', y: -58 },
  zumrut: { bloklar: ['emerald_ore', 'deepslate_emerald_ore'], seviye: 'iron', y: 100 },
  zümrüt: { bloklar: ['emerald_ore', 'deepslate_emerald_ore'], seviye: 'iron', y: 100 },
  tas: { bloklar: ['stone', 'deepslate', 'andesite', 'diorite', 'granite'], seviye: 'wooden', y: null },
  taş: { bloklar: ['stone', 'deepslate', 'andesite', 'diorite', 'granite'], seviye: 'wooden', y: null }
}

// Kazma seviyeleri, zayıftan güçlüye. "iron" isteyen bir cevheri
// elmas kazmayla da kırabilirsin — index karşılaştırması bunun için.
const SEVIYELER = ['wooden', 'stone', 'iron', 'diamond', 'netherite']

// Kazarken karşımıza çıkarsa DURACAĞIMIZ bloklar
const TEHLIKELI = /lava|water|bedrock/

/** Envanterdeki en iyi kazmanın seviyesi (yoksa null) */
function kazmaSeviyesi (bot) {
  let enIyi = -1
  for (const esya of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(esya.name)
    if (!m) continue
    const i = SEVIYELER.indexOf(m[1] === 'golden' ? 'stone' : m[1])
    if (i > enIyi) enIyi = i
  }
  return enIyi < 0 ? null : SEVIYELER[enIyi]
}

/** Botun baktığı yönün en yakın ana yönü (kuzey/güney/doğu/batı) */
function ileriYon (bot) {
  const yaw = bot.entity.yaw
  const x = -Math.sin(yaw)
  const z = -Math.cos(yaw)
  return Math.abs(x) > Math.abs(z)
    ? new Vec3(Math.sign(x), 0, 0)
    : new Vec3(0, 0, Math.sign(z))
}

/** Bu bloğu kırmak güvenli mi? Komşularında lav/su var mı? */
function guvenliMi (bot, konum) {
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const b = bot.blockAt(konum.offset(dx, dy, dz))
    if (b && TEHLIKELI.test(b.name)) return false
  }
  return true
}

/** Tek bir bloğu kır (kırılabiliyorsa) */
async function blogoKir (bot, konum, kontrol) {
  const b = bot.blockAt(konum)
  if (!b || b.name === 'air' || b.boundingBox !== 'block') return true
  if (koruma.korumaliMi(konum)) return false
  if (!guvenliMi(bot, konum)) return false
  if (!bot.canDigBlock(b)) return false

  const alet = uygunAlet(bot, b)
  if (alet) { try { await bot.equip(alet, 'hand') } catch (err) { /* elle dene */ } }

  await bot.lookAt(b.position.offset(0.5, 0.5, 0.5), true)
  await sinirli(bot.dig(b), 12000, kontrol)
  return true
}

/**
 * Merdiven şeklinde bir basamak in.
 *
 * Her basamakta üç blok kırılıyor: önümüzdeki ayak ve baş hizası (geçmek
 * için) ve onun altındaki (inmek için). Ayağımızın altı hiçbir zaman
 * boşalmıyor, o yüzden ne düşüyoruz ne de lavın içine giriyoruz.
 * Lav/su görürsek basamağı hiç kırmadan duruyoruz.
 */
async function birBasamakIn (bot, kontrol) {
  const yon = ileriYon(bot)
  const ayak = bot.entity.position.floored()

  const onAyak = ayak.plus(yon)
  const onBas = onAyak.offset(0, 1, 0)
  const onAlt = onAyak.offset(0, -1, 0)

  for (const konum of [onBas, onAyak, onAlt]) {
    kontrol.kontrolEt()
    if (!guvenliMi(bot, konum)) return { ok: false, sebep: 'tehlike' }
  }

  for (const konum of [onBas, onAyak, onAlt]) {
    kontrol.kontrolEt()
    if (!(await blogoKir(bot, konum, kontrol))) return { ok: false, sebep: 'kirilamadi' }
  }

  // Açtığımız boşluğa yürü
  try {
    pathfinderHazirla(bot)
    await sinirli(
      bot.pathfinder.goto(new goals.GoalBlock(onAlt.x, onAlt.y, onAlt.z)),
      8000, kontrol
    )
  } catch (err) {
    if (err instanceof IptalEdildi) { pathfinderDurdur(bot); throw err }
    pathfinderDurdur(bot)
    return { ok: false, sebep: 'yuruyemedim' }
  }
  return { ok: true }
}

/** Hedef Y seviyesine merdivenle in */
async function seviyeyeIn (bot, hedefY, kontrol, { maksBasamak = 120 } = {}) {
  let basamak = 0
  while (Math.floor(bot.entity.position.y) > hedefY && basamak < maksBasamak) {
    kontrol.kontrolEt()
    const r = await birBasamakIn(bot, kontrol)
    if (!r.ok) return { ok: false, basamak, sebep: r.sebep }
    basamak++
    if (basamak % 10 === 0) {
      log.bilgi(`y=${Math.floor(bot.entity.position.y)} (${basamak} basamak)`)
    }
  }
  return { ok: true, basamak }
}

/** Yakındaki hedef cevherleri, gerçek uzaklığa göre sıralı */
function cevherBul (bot, isimler, yaricap, karaListe) {
  const idler = isimler
    .map((n) => (bot.registry.blocksByName[n] || {}).id)
    .filter((x) => x !== undefined)
  if (idler.length === 0) return []

  return bot.findBlocks({ matching: idler, maxDistance: yaricap, count: 64 })
    .filter((p) => !karaListe.has(`${p.x},${p.y},${p.z}`) && !koruma.korumaliMi(p))
    .sort((a, b) =>
      a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
}

/**
 * Ana komut.
 * @param {string} istek "demir", "elmas", "tas"
 * @param {number} adet kaç blok kırılsın
 */
async function kaz (bot, kontrol, istek, adet = 8) {
  const ad = String(istek || 'tas').toLowerCase().trim()
  const cevher = CEVHERLER[ad]
  if (!cevher) {
    return {
      basarili: false,
      mesaj: `"${istek}" nedir bilmiyorum. Bildiklerim: ${Object.keys(CEVHERLER).join(', ')}`
    }
  }

  // --- 1) Doğru kazma elimizde mi? Yoksa yapmayı dene ---
  const gerekli = SEVIYELER.indexOf(cevher.seviye)
  let mevcut = SEVIYELER.indexOf(kazmaSeviyesi(bot))

  if (mevcut < gerekli) {
    log.bilgi(`${cevher.seviye} kazma lazım, yapmayı deniyorum...`)
    const yapim = await uret(bot, kontrol, `${cevher.seviye === 'wooden' ? 'tahta' : cevher.seviye === 'stone' ? 'tas' : 'demir'} kazma`, 1)
    mevcut = SEVIYELER.indexOf(kazmaSeviyesi(bot))
    if (mevcut < gerekli) {
      return {
        basarili: false,
        mesaj: `${ad} için ${cevher.seviye} kazma gerekiyor, yapamadım — ${yapim.mesaj}`
      }
    }
  }

  // --- 2) Doğru derinliğe in ---
  if (cevher.y !== null && Math.floor(bot.entity.position.y) > cevher.y + 8) {
    log.bilgi(`${ad} için y=${cevher.y} seviyesine iniyorum...`)
    const inis = await seviyeyeIn(bot, cevher.y, kontrol)
    if (!inis.ok && inis.basamak === 0) {
      return { basarili: false, mesaj: `İnemedim (${inis.sebep}).` }
    }
    if (!inis.ok) log.uyari(`İniş yarıda kesildi (${inis.sebep}), buradan arıyorum.`)
  }

  // --- 3) Cevheri ara ve kır ---
  const baslangic = bot.entity.position.clone()
  const karaListe = new Set()
  let kirilan = 0
  let bosArama = 0

  while (kirilan < adet && bosArama < 6) {
    kontrol.kontrolEt()

    const adaylar = cevherBul(bot, cevher.bloklar, 32, karaListe)
    if (adaylar.length === 0) {
      // Bulamadık: yatay olarak biraz ilerleyip tekrar bak (tünel aç)
      bosArama++
      const r = await birBasamakIn(bot, kontrol)
      if (!r.ok) break
      continue
    }
    bosArama = 0

    const konum = adaylar[0]
    const anahtar = `${konum.x},${konum.y},${konum.z}`

    try {
      pathfinderHazirla(bot)
      await sinirli(
        bot.pathfinder.goto(new goals.GoalLookAtBlock(konum, bot.world, { range: 4 })),
        15000, kontrol
      )
      kontrol.kontrolEt()
      if (await blogoKir(bot, konum, kontrol)) kirilan++
      else karaListe.add(anahtar)
    } catch (err) {
      if (err instanceof IptalEdildi) {
        pathfinderDurdur(bot); bot.stopDigging(); throw err
      }
      pathfinderDurdur(bot)
      karaListe.add(anahtar) // ulaşamadık, bir daha deneme
    }
  }

  // --- 4) Düşenleri topla ---
  if (kirilan > 0) {
    await kontrol.bekle(600)
    await dusenleriTopla(bot, baslangic, kontrol, { yaricap: 16 })
  }

  return {
    basarili: kirilan > 0,
    kirilan,
    mesaj: kirilan > 0
      ? `${kirilan} ${ad} kırdım (y=${Math.floor(bot.entity.position.y)}).`
      : `${ad} bulamadım (y=${Math.floor(bot.entity.position.y)}).`
  }
}

module.exports = { kaz, kazmaSeviyesi, ileriYon, seviyeyeIn, birBasamakIn, CEVHERLER, SEVIYELER }
