'use strict'

const { chopTree, chopTrees, oduncuSay, kutukMu, agaciTopla, dusenleriTopla } = require('./chopTree')
const { gel } = require('./gel')
const { baltaYap, aletKusan, uygunAlet } = require('./alet')

/**
 * Bütün "skill"ler (botun yapabildiği işler) buradan dışa açılır.
 * Yeni bir yetenek eklediğinde sadece buraya bir satır ekleyeceksin.
 */
module.exports = {
  chopTree, chopTrees, gel, baltaYap, aletKusan, uygunAlet,
  oduncuSay, kutukMu, agaciTopla, dusenleriTopla
}
