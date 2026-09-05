'use strict'

/**
 * Task cancellation.
 *
 * Problem: typing "dur" while the bot was chopping did nothing to the chopping
 * loop, it kept spinning because nothing told it to stop.
 *
 * Fix: every long-running job gets this object. The job calls
 * `kontrol.kontrolEt()` at the start of each step; if the cancel flag is up,
 * that call throws and breaks the loop.
 */

class IptalEdildi extends Error {
  constructor () {
    super('gorev_iptal_edildi')
    this.name = 'IptalEdildi'
  }
}

class GorevKontrol {
  constructor () {
    this.iptalIstendi = false
    this.calisiyor = false
  }

  /** Called when a new task starts */
  baslat () {
    this.iptalIstendi = false
    this.calisiyor = true
  }

  /** Called when the task ends */
  bitir () {
    this.calisiyor = false
    this.iptalIstendi = false
  }

  /** The "dur" command calls this */
  durdur () {
    this.iptalIstendi = true
  }

  /** Called regularly from inside long jobs; breaks the loop on cancel */
  kontrolEt () {
    if (this.iptalIstendi) throw new IptalEdildi()
  }

  /** Cancellable wait */
  async bekle (ms, adim = 100) {
    const bitis = Date.now() + ms
    while (Date.now() < bitis) {
      this.kontrolEt()
      await new Promise((r) => setTimeout(r, Math.min(adim, bitis - Date.now())))
    }
  }
}

/** Bound a promise by both a timeout and cancellation */
async function sinirli (soz, ms, kontrol) {
  // The timer has to be cleared when the promise wins the race. It used to be
  // left running: with the 4-minute budget `git` uses, node stayed awake for
  // four minutes after a walk that took ten seconds.
  let zamanlayici = null
  let saat = null

  try {
    return await Promise.race([
      soz,
      new Promise((_, red) => {
        zamanlayici = setTimeout(() => red(new Error('zaman_asimi')), ms)
      }),
      new Promise((_, red) => {
        saat = setInterval(() => {
          if (kontrol && kontrol.iptalIstendi) red(new IptalEdildi())
        }, 100)
      })
    ])
  } finally {
    if (zamanlayici) clearTimeout(zamanlayici)
    if (saat) clearInterval(saat)
  }
}

/**
 * Safe form of pathfinder.stop().
 *
 * In mineflayer-pathfinder `stop()` does not cut the path right away, it only
 * raises a sticky `stopPathing` latch. The latch is consumed by the next
 * `resetPath` call — and `goto()` starts with exactly `setGoal -> resetPath`.
 *
 * So a `stop()` that leaves the latch up makes the next `goto()` fail with
 * "Path was stopped before it could be completed" before it even computes a
 * path. The message looks like a terrain problem; the cause is the earlier
 * call.
 *
 * Hence `setGoal(null)` after every `stop()` to consume the latch.
 */
function pathfinderDurdur (bot) {
  try {
    bot.pathfinder.stop()
    bot.pathfinder.setGoal(null) // consume the latch, or the next goto dies
  } catch (err) { /* harmless if pathfinder is not loaded */ }
}

/**
 * Called before a new `goto()`: clears a latch left behind somewhere else.
 * Defensive, because where a latch came from is not always knowable.
 */
function pathfinderHazirla (bot) {
  try {
    bot.pathfinder.setGoal(null)
  } catch (err) { /* harmless */ }
}

/**
 * Pathfinder goto with stuck detection.
 *
 * Problem: on the edge of a ledge the bot ends up running without moving.
 * Pathfinder found a path and is pressing keys, but the bot is physically
 * jammed. A timeout alone is not enough: waiting out the 15-second timeout is
 * slow and reports it as "no path found", when there is a path and the bot is
 * just stuck.
 *
 * Fix: watch the position. No progress for a while means stuck, and waiting
 * longer buys nothing. Stop, release the keys, and tell the caller "takildim"
 * so it can move on to another target.
 *
 * @returns {Promise<{ok:boolean, sebep?:string}>}
 */
async function pathfinderGit (bot, hedef, kontrol, {
  zamanAsimi = 15000,
  durgunlukMs = 4000,
  esik = 0.6,
  kurtarmayiDene = true
} = {}) {
  pathfinderHazirla(bot)

  let sonKonum = bot.entity.position.clone()
  let sonIlerleme = Date.now()
  let saat = null

  const takilmaSozu = new Promise((_resolve, reject) => {
    saat = setInterval(() => {
      try {
        if (bot.entity.position.distanceTo(sonKonum) > esik) {
          sonKonum = bot.entity.position.clone()
          sonIlerleme = Date.now()
        } else if (Date.now() - sonIlerleme > durgunlukMs) {
          reject(new Error('takildim'))
        }
      } catch (err) { /* if the bot is gone the timeout takes over */ }
    }, 500)
  })

  try {
    await sinirli(
      Promise.race([bot.pathfinder.goto(hedef), takilmaSozu]),
      zamanAsimi,
      kontrol
    )
    return { ok: true }
  } catch (err) {
    pathfinderDurdur(bot)
    try { bot.clearControlStates() } catch (e) {}
    if (err instanceof IptalEdildi) throw err
    if (saat) { clearInterval(saat); saat = null }

    const takildi = err.message === 'takildim'

    // Detection alone is half a fix.
    //
    // Knowing it is stuck does not free the bot: it stands in the same narrow
    // gap, only now it knows. The caller moves to another target, pathfinder
    // still finds no path, and the loop restarts. That is what the screenshots
    // kept showing.
    //
    // So: get free first, then retry once. The retry passes
    // `kurtarmayiDene: false`, so it cannot recurse again.
    if (takildi && kurtarmayiDene) {
      const { kurtar } = require('./kurtar')
      const kurtuldu = await kurtar(bot, kontrol)
      if (kurtuldu) {
        return pathfinderGit(bot, hedef, kontrol, {
          zamanAsimi: Math.min(zamanAsimi, 10000),
          durgunlukMs,
          esik,
          kurtarmayiDene: false
        })
      }
    }

    return { ok: false, sebep: takildi ? 'takildim' : 'yol_yok' }
  } finally {
    if (saat) clearInterval(saat)
  }
}

module.exports = {
  GorevKontrol, IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla, pathfinderGit
}
