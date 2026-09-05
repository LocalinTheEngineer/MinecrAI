'use strict'
const fs = require('fs')
const path = require('path')
const arrays = ['allowed_tasks', 'protected_blocks', 'valuable_blocks', 'danger_blocks', 'forbidden_actions', 'reward_hints', 'notes']
function validateProfile (profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Profil JSON nesnesi olmali.')
  for (const key of ['name', 'description', 'default_task']) {
    if (typeof profile[key] !== 'string' || !profile[key].trim()) throw new Error(`Profil: ${key} dolu metin olmali.`)
  }
  for (const key of arrays) {
    if (!Array.isArray(profile[key]) || profile[key].some(v => typeof v !== 'string' || !v.trim())) throw new Error(`Profil: ${key} metin listesi olmali.`)
  }
  if (!profile.allowed_tasks.includes(profile.default_task)) throw new Error('Profil: default_task allowed_tasks icinde olmali.')
  return profile
}
function loadProfile (name = 'vanilla-survival') {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Profil adi gecersiz; profiles/ icindeki adi uzantisiz kullanin.')
  let profile
  try { profile = JSON.parse(fs.readFileSync(path.join(__dirname, `${name}.json`), 'utf8')) } catch { throw new Error(`Profil okunamadi: ${name}. JSON dosyasini kontrol edin.`) }
  return validateProfile(profile)
}
module.exports = { loadProfile, validateProfile }
