'use strict'
const { fs, path, root, venvPython, findPython, run } = require('./runtime')
function setup () {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ kurun.')
  if (!process.env.npm_execpath) throw new Error('Bu komutu npm run setup ile calistirin.')
  if (run(process.execPath, [process.env.npm_execpath, 'ci'])) throw new Error('npm ci basarisiz. Ag baglantisini ve package-lock.json dosyasini kontrol edin.')
  const env = path.join(root, '.env')
  if (!fs.existsSync(env)) fs.copyFileSync(path.join(root, '.env.example'), env, fs.constants.COPYFILE_EXCL)
  for (const dir of ['models', 'data/demonstrations']) fs.mkdirSync(path.join(root, dir), { recursive: true })
  if (process.argv.includes('--bot-only')) { console.log('PASS Bot kurulumu tamam. .env ayarlarini kontrol edip npm start calistirin.'); return }
  const python = findPython()
  if (!python) throw new Error('Python 3.10+ bulunamadi. Python kurun ve npm run setup komutunu tekrarlayin.')
  if (!fs.existsSync(venvPython) && run(python.command, [...python.prefix, '-m', 'venv', path.join(root, '.venv')])) throw new Error('.venv olusturulamadi. Python venv destegini kontrol edin.')
  if (run(venvPython, ['-m', 'pip', 'install', '-r', path.join(root, 'python/requirements.txt')])) throw new Error('Python paketleri kurulamadi. Ag/Python uyumlulugunu kontrol edip tekrar deneyin. Mevcut .venv silinmedi.')
  console.log('PASS Kurulum tamam. .env ayarlarini kontrol edin; npm test ve npm run doctor calistirin.')
}
try { setup() } catch (error) { console.error(`FAIL ${error.message}`); process.exitCode = 1 }
