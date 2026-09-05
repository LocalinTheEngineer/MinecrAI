'use strict'
const r = require('./runtime')
async function start () {
  const args = process.argv.slice(2)
  const mode = args.find(a => !a.startsWith('--')) || 'bot'
  if (!['bot', 'bridge'].includes(mode) || args.some(a => !['bot', 'bridge', '--check-server'].includes(a)) || args.filter(a => !a.startsWith('--')).length > 1) throw new Error('Kullanim: npm start -- [bot|bridge] [--check-server]')
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ kurun.')
  if (r.missingDependencies().length) throw new Error('Node paketleri eksik. npm run setup -- --bot-only calistirin.')
  const config = r.loadConfig()
  if (!r.validPort(process.env.MC_PORT || config.port)) throw new Error('MC_PORT 1-65535 olmali.')
  if (!['offline', 'microsoft'].includes(config.auth)) throw new Error('MC_AUTH offline veya microsoft olmali.')
  if (mode === 'bridge') {
    if (!r.validPort(process.env.BRIDGE_PORT || config.bridgePort)) throw new Error('BRIDGE_PORT 1-65535 olmali.')
    if (!await r.portFree(config.bridgePort)) throw new Error('Bridge portu kullanimda. Eski bridge oturumunu kapatin veya BRIDGE_PORT ayarini degistirin.')
  }
  if (args.includes('--check-server') && !await r.serverReachable(config.host, config.port)) throw new Error('Minecraft sunucusuna ulasilamadi. Sunucuyu acin, MC_HOST / MC_PORT ayarlarini kontrol edin.')
  process.chdir(r.root)
  console.log(`MinecrAI ${mode} basliyor. Durdurmak icin Ctrl+C. Bot ve bridge ayni hesapla birlikte acilmamali.`)
  const bot = mode === 'bridge' ? require('../bot/bridge/server').kopruyuBaslat().bot : require('../bot/index').botOlustur()
  bot.once('error', () => { console.error('FAIL Baglanti hatasi. npm run doctor -- --server calistirin.'); process.exitCode = 1 })
  bot.once('kicked', () => { process.exitCode = 1 })
  bot.once('end', () => process.exit(process.exitCode || 0))
  process.once('SIGINT', () => { bot.quit(); setTimeout(() => process.exit(0), 1000).unref() })
}
start().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1 })
