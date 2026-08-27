// Sadece test icin: flying-squid ile sahte sunucu ac ve botun yanina agac dik
const squid = require('flying-squid')
const Vec3 = require('vec3')
const VERSION = process.env.TEST_VERSION || '1.20.2'
const PORT = parseInt(process.env.TEST_PORT || '25599', 10)

const server = squid.createMCServer({
  motd: 'MinecrAI test', port: PORT, 'max-players': 5, 'online-mode': false,
  logging: false, gameMode: 0, difficulty: 1, worldFolder: null,
  generation: { name: 'diamond_square', options: { worldHeight: 80 } },
  kickTimeout: 60000, plugins: {}, modpe: false, 'view-distance': 4,
  'player-list-text': { header: 't', footer: 't' }, 'everybody-op': true,
  'max-entities': 100, version: VERSION
})

server.on('listening', () => console.log('TESTSERVER: hazir', PORT))

// Oyuncu girince yanina bir agac dik
server.on('newPlayer', (player) => {
  setTimeout(() => {
    try {
      const mcData = require('minecraft-data')(VERSION)
      const logState = mcData.blocksByName.oak_log.defaultState
      const p = player.position.floored()
      for (let k = 0; k < 3; k++) {
        for (let i = 0; i < 5; i++) {
          player.setBlock(new Vec3(p.x + 3 + k * 2, p.y + i, p.z + 1), logState)
        }
      }
      console.log('TESTSERVER: 3 agac dikildi @', p.x + 3, p.y, p.z + 1)
    } catch (e) { console.log('TESTSERVER agac hatasi:', e.message) }
  }, 1500)
})
