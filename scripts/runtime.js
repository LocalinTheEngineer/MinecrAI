'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const root = path.resolve(__dirname, '..')
const venvPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

function findPython (probe = spawnSync) {
  const candidates = [[venvPython, []], ['python', []], ['python3', []], ['py', ['-3']]]
  for (const [command, prefix] of candidates) {
    const result = probe(command, [...prefix, '-c', 'import sys; print(sys.version.split()[0]); sys.exit(0 if sys.version_info >= (3,10) else 1)'], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true })
    if (!result.error && result.status === 0) return { command, prefix, version: result.stdout.trim() }
  }
  return null
}
function run (command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } })
  if (result.error) console.error('FAIL Komut baslatilamadi. Kurulumu ve PATH ayarini kontrol edin.')
  return result.status ?? 1
}
function pythonPackages (python) {
  return spawnSync(python.command, [...python.prefix, '-c', 'import gymnasium, numpy, websocket, stable_baselines3, torch, matplotlib, tensorboard'], { cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true }).status === 0
}
function missingDependencies () {
  return Object.keys(require('../package.json').dependencies).filter(name => {
    try { require.resolve(name, { paths: [root] }); return false } catch { return true }
  })
}
function loadConfig () {
  require('dotenv').config({ path: path.join(root, '.env'), quiet: true })
  return require('../bot/config')
}
function validPort (value) { return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 65535 }
function portFree (port) {
  return new Promise(resolve => {
    const server = require('net').createServer()
    server.once('error', () => resolve(false))
    server.listen(port, () => server.close(() => resolve(true)))
  })
}
function serverReachable (host, port) {
  return new Promise(resolve => {
    const socket = require('net').createConnection({ host, port })
    const done = ok => { socket.destroy(); resolve(ok) }
    socket.setTimeout(2000)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}
module.exports = { fs, path, root, venvPython, findPython, run, pythonPackages, missingDependencies, loadConfig, validPort, portFree, serverReachable }
