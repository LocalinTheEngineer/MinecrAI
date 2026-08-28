'use strict'

/**
 * Ortak sabitler.
 *
 * environment.js ile expert.js birbirini require ederse dairesel bağımlılık
 * oluşuyor ve biri boş nesne alıyor. Paylaşılan sayılar burada duruyor.
 */

module.exports = {
  // Bu kadar adım üst üste ilerleyemezsek "engele takıldık" sayılır
  TAKILMA_ESIGI: 3,

  // Takılınca kaç adım boyunca kaçınma manevrası yapılacak
  KACINMA_SURESI: 7,

  // Bu kadar adım hiçbir ilerleme olmazsa bölümü bitir
  DURGUNLUK_SINIRI: 60,

  // Hedefin dibindeyiz ama bu kadar adımdır bir şey kıramıyorsak
  // o hedef ulaşılamıyordur; kara listeye alıp başkasına geç
  HEDEF_SABIR: 20
}
