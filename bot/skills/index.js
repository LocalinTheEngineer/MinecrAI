'use strict'

const { chopTree, chopTrees, oduncuSay, kutukMu, agaciTopla, dusenleriTopla } = require('./chopTree')
const { gel } = require('./gel')

/**
 * Bütün "skill"ler (botun yapabildiği işler) buradan dışa açılır.
 * Yeni bir yetenek eklediğinde sadece buraya bir satır ekleyeceksin.
 */
module.exports = { chopTree, chopTrees, gel, oduncuSay, kutukMu, agaciTopla, dusenleriTopla }
