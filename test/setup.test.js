'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('net')
const path = require('path')
const { spawnSync } = require('child_process')
const { findPython, venvPython, validPort, portFree, serverReachable } = require('../scripts/runtime')
const { loadProfile, validateProfile } = require('../profiles/loader')

test('Python selection prefers venv, falls back, and reports missing Python', () => {
  const calls = []
  const ok = { status: 0, stdout: '3.12.0\n' }
  assert.equal(findPython(command => { calls.push(command); return ok }).command, venvPython)
  assert.deepEqual(calls, [venvPython])
  assert.equal(findPython(command => command === 'py' ? ok : { status: 1 }).command, 'py')
  assert.equal(findPython(() => ({ error: new Error('missing') })), null)
})
test('profiles reject malformed fields and path traversal; examples load', () => {
  const profile = loadProfile()
  assert.equal(loadProfile('skyblock').default_task, 'odun')
  assert.throws(() => loadProfile('../package'))
  assert.throws(() => loadProfile('absent-profile'))
  assert.throws(() => validateProfile({ ...profile, default_task: 'unknown' }))
  assert.throws(() => validateProfile({ ...profile, danger_blocks: 'lava' }))
  assert.throws(() => validateProfile(null))
})
test('port checks reject invalid config and detect an occupied TCP port', async () => {
  for (const value of ['8765x', '0', '-1', '65536', 'NaN']) assert.equal(validPort(value), false)
  assert.equal(validPort('8765'), true)
  const server = net.createServer(socket => socket.end())
  await new Promise(resolve => server.listen(0, resolve))
  const port = server.address().port
  try {
    assert.equal(await portFree(port), false)
    assert.equal(await serverReachable('127.0.0.1', port), true)
  } finally { await new Promise(resolve => server.close(resolve)) }
  assert.equal(await portFree(port), true)
  assert.equal(await serverReachable('127.0.0.1', port), false)
})

test('launcher selects exactly one entry point even outside the repo directory', () => {
  const root = path.resolve(__dirname, '..')
  for (const mode of ['bot', 'bridge']) {
    const script = `
      const root = ${JSON.stringify(root)};
      const path = require('path');
      const r = require(path.join(root, 'scripts/runtime.js'));
      r.loadConfig = () => ({host: 'localhost', port: 25565, bridgePort: 8765, auth: 'offline'});
      r.missingDependencies = () => [];
      r.portFree = async () => true;
      const makeBot = () => new (require('events').EventEmitter)();
      const entries = [
        ['bot/index.js', {botOlustur: () => {console.log('ENTRY:bot'); return makeBot()}}],
        ['bot/bridge/server.js', {kopruyuBaslat: () => {console.log('ENTRY:bridge'); return {bot: makeBot()}}}]
      ];
      for (const [file, exports] of entries) require.cache[require.resolve(path.join(root, file))] = {exports};
      process.argv = [process.execPath, 'start.js', ${JSON.stringify(mode)}];
      require(path.join(root, 'scripts/start.js'));
    `
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: require('os').tmpdir(), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, MC_PORT: '25565', BRIDGE_PORT: '8765' }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.stdout.match(/ENTRY:\w+/g), [`ENTRY:${mode}`])
  }
})
