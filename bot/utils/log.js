'use strict'

const renk = {
  gri: '\x1b[90m', yesil: '\x1b[32m', sari: '\x1b[33m',
  kirmizi: '\x1b[31m', mavi: '\x1b[36m', sifirla: '\x1b[0m'
}

function saat () {
  return new Date().toLocaleTimeString('tr-TR')
}

module.exports = {
  bilgi: (...m) => console.log(`${renk.gri}[${saat()}]${renk.sifirla} ${renk.mavi}i${renk.sifirla}`, ...m),
  basari: (...m) => console.log(`${renk.gri}[${saat()}]${renk.sifirla} ${renk.yesil}+${renk.sifirla}`, ...m),
  uyari: (...m) => console.log(`${renk.gri}[${saat()}]${renk.sifirla} ${renk.sari}!${renk.sifirla}`, ...m),
  hata: (...m) => console.log(`${renk.gri}[${saat()}]${renk.sifirla} ${renk.kirmizi}x${renk.sifirla}`, ...m)
}
