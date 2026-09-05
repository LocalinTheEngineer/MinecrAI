'use strict'
const { root, path, findPython, pythonPackages, run } = require('./runtime')
const mode = process.argv[2] || 'all'
let failed = false
if (mode !== 'python') {
  if (run(process.execPath, [path.join(root, 'test/smoke.js')])) failed = true
  if (run(process.execPath, ['--test', path.join(root, 'test/setup.test.js')])) failed = true
}
if (mode !== 'node') {
  const python = findPython()
  if (!python) {
    console.error('FAIL Python 3.10+ bulunamadi. Python kurup npm run setup calistirin; .venv otomatik kullanilir.')
    failed = true
  } else if (!pythonPackages(python)) {
    console.error('FAIL Python paketleri yuklenemedi. npm run setup ile python/requirements.txt paketlerini kurun.')
    failed = true
  } else {
    console.log(`PASS Python ${python.version}: ${python.command}`)
    if (run(python.command, [...python.prefix, path.join(root, 'test/smoke.py')])) failed = true
  }
}
process.exitCode = failed ? 1 : 0
