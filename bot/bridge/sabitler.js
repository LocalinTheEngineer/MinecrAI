'use strict'

/**
 * Shared constants.
 *
 * environment.js and expert.js requiring each other is a circular dependency
 * and one of them ends up with an empty object. Shared numbers live here.
 */

module.exports = {
  // No forward movement for this many steps in a row counts as stuck on an obstacle
  TAKILMA_ESIGI: 3,

  // How many steps the avoidance manoeuvre runs once stuck
  KACINMA_SURESI: 7,

  // End the episode after this many steps without any progress
  DURGUNLUK_SINIRI: 60,

  // Standing right next to the target but breaking nothing for this many
  // steps means it is unreachable: blacklist it and pick another
  HEDEF_SABIR: 20,

  // Directly below or above the target (horizontal < 2) with nothing in
  // range to break: unreachable. Going up is not in the action space, so
  // waiting buys nothing; give up fast.
  DIKEY_SABIR: 3
}
