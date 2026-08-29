'use strict'

const { chopTree, chopTrees, oduncuSay, kutukMu, agaciTopla, dusenleriTopla } = require('./chopTree')
const { gel } = require('./gel')
const { baltaYap, aletKusan, uygunAlet } = require('./alet')
const { takipBaslat, takipBirak, takipVarMi } = require('./takip')
const { ver } = require('./ver')
const { uret } = require('./uret')
const { kaz, kazmaSeviyesi } = require('./kaz')
const { sutunaCik, sutundanIn } = require('./sutun')

/**
 * Bütün "skill"ler (botun yapabildiği işler) buradan dışa açılır.
 * Yeni bir yetenek eklediğinde sadece buraya bir satır ekleyeceksin.
 */
module.exports = {
  chopTree, chopTrees, gel, baltaYap, aletKusan, uygunAlet,
  takipBaslat, takipBirak, takipVarMi, ver, uret, kaz, kazmaSeviyesi, sutunaCik, sutundanIn,
  oduncuSay, kutukMu, agaciTopla, dusenleriTopla
}
