'use strict'
const r = require('./runtime')
async function doctor () {
  let failures = 0
  const report = (status, text) => { console.log(`${status} ${text}`); if (status === 'FAIL') failures++ }
  report(Number(process.versions.node.split('.')[0]) >= 22 ? 'PASS' : 'FAIL', `Node ${process.versions.node}; gereken 22+. Eskiyse Node kurulumunu guncelleyin.`)
  const missing = r.missingDependencies()
  report(missing.length ? 'FAIL' : 'PASS', missing.length ? `Node paketleri eksik: ${missing.join(', ')}. npm ci calistirin.` : 'Node dependencies bulunuyor.')
  const python = r.findPython()
  report(python ? 'PASS' : 'FAIL', python ? `Python ${python.version}: ${python.command}` : 'Python 3.10+ bulunamadi. Python kurup npm run setup calistirin.')
  report(r.fs.existsSync(r.venvPython) ? 'PASS' : 'WARN', '.venv: yoksa npm run setup ile olusturun; varsa otomatik tercih edilir.')
  if (python) report(r.pythonPackages(python) ? 'PASS' : 'FAIL', 'Python paketleri: yuklenemiyorsa npm run setup calistirin.')
  report(r.fs.existsSync(r.path.join(r.root, '.env')) ? 'PASS' : 'WARN', '.env: yoksa .env.example dosyasini .env olarak kopyalayin; varsayilanlar kullanilir.')
  for (const dir of ['models', 'data/demonstrations']) report(r.fs.existsSync(r.path.join(r.root, dir)) ? 'PASS' : 'WARN', `${dir}: eksikse npm run setup olusturur.`)
  if (!missing.includes('dotenv')) {
    const config = r.loadConfig()
    const mcValid = r.validPort(process.env.MC_PORT || config.port)
    const bridgeValid = r.validPort(process.env.BRIDGE_PORT || config.bridgePort)
    report(mcValid ? 'PASS' : 'FAIL', `MC_HOST=${config.host} MC_PORT=${process.env.MC_PORT || config.port} MC_VERSION=${config.version}; .env veya ortamdan, yoksa varsayilan. Port 1-65535 olmali.`)
    report(['offline', 'microsoft'].includes(config.auth) ? 'PASS' : 'FAIL', 'MC_AUTH offline veya microsoft olmali.')
    report(bridgeValid ? 'PASS' : 'FAIL', 'BRIDGE_PORT 1-65535 olmali.')
    if (bridgeValid) report(await r.portFree(config.bridgePort) ? 'PASS' : 'WARN', `Bridge port ${config.bridgePort}: doluysa calisan bridge olabilir; yeni oturum icin kapatin veya portu degistirin.`)
    if (process.argv.includes('--server') && mcValid) report(await r.serverReachable(config.host, config.port) ? 'PASS' : 'WARN', 'Minecraft TCP erisimi: basarisizsa sunucuyu acin, adres/port/firewall ayarini kontrol edin. TCP basarisi Minecraft girisini garanti etmez.')
    report(config.geminiAnahtari || config.anthropicAnahtari ? 'PASS' : 'WARN', 'Sohbet anahtari yoksa dogal dil kapali, tam komutlar calisir. Anahtar degerleri yazdirilmaz.')
    try { const p = require('../profiles/loader').loadProfile(process.env.MINECRAI_PROFILE || 'vanilla-survival'); report('PASS', `Profil: ${p.name} (yalnizca metadata, davranisa uygulanmaz).`) } catch (error) { report('FAIL', error.message) }
  } else report('WARN', 'Ayar/profil kontrolu icin once npm ci calistirin.')
  console.log(`\n${failures} FAIL. WARN satirlarini ihtiyaciniza gore duzeltin. Rehber: docs/install.md`)
  process.exitCode = failures ? 1 : 0
}
doctor().catch(() => { console.error('FAIL Tani tamamlanamadi. Kurulum ve .env ayarlarini docs/install.md ile kontrol edin.'); process.exitCode = 1 })
