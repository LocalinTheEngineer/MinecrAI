'use strict'

/**
 * Test sahnesi kurucu.
 *
 * Testler rastgele üretilen arazide tutarsız davranıyordu; ayrıca bot spawn
 * olduktan sonra bir süre DÜŞMEYE devam ediyor — konumunu hemen ölçersen
 * platformu yanlış yükseklikte kuruyorsun ve bot altından geçip gidiyor.
 * (Bu hatayı bir kez yaptık, o yüzden burada `botuBeklet` var.)
 */

const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const Vec3 = require('vec3')

async function sunucuBaslat (port, version) {
  const squid = require('flying-squid')
  const server = squid.createMCServer({
    motd: 'MinecrAI test', port, 'max-players': 5, 'online-mode': false,
    logging: false, gameMode: 0, difficulty: 1, worldFolder: null,
    generation: { name: 'diamond_square', options: { worldHeight: 80 } },
    kickTimeout: 60000, plugins: {}, modpe: false, 'view-distance': 6,
    'player-list-text': { header: 't', footer: 't' }, 'everybody-op': true,
    'max-entities': 100, version
  })
  await new Promise((r) => server.on('listening', r))
  return server
}

async function botBaglat (port, version, isim = 'TestBot') {
  const bot = mineflayer.createBot({
    host: 'localhost', port, username: isim, version, auth: 'offline'
  })
  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)

  await new Promise((res, rej) => {
    bot.once('spawn', res)
    bot.once('error', rej)
    setTimeout(() => rej(new Error('spawn zaman asimi')), 30000)
  })

  const mv = new Movements(bot)
  mv.canDig = true
  bot.pathfinder.setMovements(mv)
  return bot
}

/** Bot yere inip sabitlenene kadar bekle */
async function botuBeklet (bot, maksMs = 15000) {
  const bitis = Date.now() + maksMs
  let oncekiY = null
  let sabitSayac = 0

  while (Date.now() < bitis) {
    await new Promise((r) => setTimeout(r, 250))
    const y = bot.entity.position.y
    if (oncekiY !== null && Math.abs(y - oncekiY) < 0.01 && bot.entity.onGround) {
      if (++sabitSayac >= 3) return bot.entity.position.floored()
    } else {
      sabitSayac = 0
    }
    oncekiY = y
  }
  return bot.entity.position.floored()
}

/**
 * Botun etrafında düz bir taş platform açar ve üstünü temizler.
 * Bot zaten yerde olduğu için düşmez.
 * @returns {Vec3} platformun üst yüzeyinin bulunduğu ayak seviyesi
 */
function platformKur (server, surum, merkez, { yaricap = 7, yukseklik = 6 } = {}) {
  const mcData = require('minecraft-data')(surum)
  const tas = mcData.blocksByName.stone.defaultState
  const hava = mcData.blocksByName.air.defaultState
  const player = server.players[0]

  for (let dx = -yaricap; dx <= yaricap; dx++) {
    for (let dz = -yaricap; dz <= yaricap; dz++) {
      player.setBlock(new Vec3(merkez.x + dx, merkez.y - 1, merkez.z + dz), tas)
      for (let dy = 0; dy <= yukseklik; dy++) {
        player.setBlock(new Vec3(merkez.x + dx, merkez.y + dy, merkez.z + dz), hava)
      }
    }
  }
  return merkez
}

/** Platformun üstüne kütükten bir gövde diker */
function agacDik (server, surum, merkez, dx, dz, yukseklik = 4) {
  const mcData = require('minecraft-data')(surum)
  const kutuk = mcData.blocksByName.oak_log.defaultState
  const player = server.players[0]
  for (let i = 0; i < yukseklik; i++) {
    player.setBlock(new Vec3(merkez.x + dx, merkez.y + i, merkez.z + dz), kutuk)
  }
  return new Vec3(merkez.x + dx, merkez.y, merkez.z + dz)
}

/** Gövdenin etrafına yaprak kabuğu koyar — botun yolunu kapatan gerçekçi engel */
function yaprakSar (server, surum, merkez, dx, dz, yukseklik = 4) {
  const mcData = require('minecraft-data')(surum)
  const yaprak = mcData.blocksByName.oak_leaves.defaultState
  const player = server.players[0]
  for (let y = 1; y < yukseklik + 1; y++) {
    for (let ex = -2; ex <= 2; ex++) {
      for (let ez = -2; ez <= 2; ez++) {
        if (ex === 0 && ez === 0) continue // gövde kalsin
        player.setBlock(
          new Vec3(merkez.x + dx + ex, merkez.y + y, merkez.z + dz + ez), yaprak)
      }
    }
  }
}

/** Kurulan blokların bota ulaşmasını bekle ve doğrula */
async function sahneyiDogrula (bot, konum, beklenen = 'oak_log', maksMs = 8000) {
  const bitis = Date.now() + maksMs
  while (Date.now() < bitis) {
    const b = bot.blockAt(konum)
    if (b && b.name === beklenen) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

/**
 * Sunucu tarafinda, adi verilen oyuncunun baglanip yere inmesini bekler.
 * Sahneyi ASIL botun konumuna kurmak icin gerekli — baska bir botun
 * konumuna kurarsan iki bot farkli yerlere dusuyor ve bot agaclari hic
 * gormuyor (bu hatayi bir kez yaptik).
 */
async function oyuncuyuBekle (server, isim, maksMs = 60000) {
  const bitis = Date.now() + maksMs
  let oyuncu = null

  while (Date.now() < bitis && !oyuncu) {
    oyuncu = Object.values(server.players).find((p) => p.username === isim) || null
    if (!oyuncu) await new Promise((r) => setTimeout(r, 300))
  }
  if (!oyuncu) throw new Error(`${isim} baglanmadi`)

  // Yere insin
  let oncekiY = null
  let sabit = 0
  while (Date.now() < bitis) {
    await new Promise((r) => setTimeout(r, 300))
    const y = oyuncu.position.y
    if (oncekiY !== null && Math.abs(y - oncekiY) < 0.01) {
      if (++sabit >= 3) break
    } else { sabit = 0 }
    oncekiY = y
  }

  return { oyuncu, merkez: oyuncu.position.floored() }
}

module.exports = {
  oyuncuyuBekle,
  yaprakSar,
  sunucuBaslat, botBaglat, botuBeklet, platformKur, agacDik, sahneyiDogrula, Vec3
}
