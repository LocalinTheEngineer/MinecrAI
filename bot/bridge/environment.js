'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')

const { gorevGetir } = require('./gorevler')
const log = require('../utils/log')
const { aletKusan } = require('../skills/alet')
const { pathfinderDurdur, pathfinderHazirla } = require('../utils/gorev')
const config = require('../config')

const MAX_ADIM = 500

// Radians turned per turn action. Must stay in sync with YAW_TOLERANS in
// expert.js: if the turn step is larger than tolerance*2 the agent can never
// land on a heading and just oscillates left and right.
const DONUS_ACISI = Math.PI / 8  // 22.5 degrees

// Blocks worth breaking when they block the path: leaves, vines, saplings,
// mushrooms. Stone, dirt and ore are excluded on purpose: digging them by hand
// takes minutes and has nothing to do with the task.
const HEDEF_ODUN = 5

// Death penalty. A flat cost instead of writing the inventory loss into the
// reward: the agent should learn to avoid cliffs without one event wrecking
// the whole run.
const OLUM_CEZASI = -5

// Dropped items within this radius are cleared at episode start, so every
// episode begins from the same clean state.
const TEMIZLIK_YARICAPI = 100

// Shared constants (expert.js uses the same ones)
const {
  DURGUNLUK_SINIRI, TAKILMA_ESIGI, KACINMA_SURESI, HEDEF_SABIR, DIKEY_SABIR
} = require('./sabitler')

/**
 * Wraps the bot as an RL environment.
 *
 * The Python side only knows reset() and step(action), and gets back an
 * observation plus a reward. Minecraft's mess stays in this file.
 */
class MinecraftEnvironment {
  constructor (bot, secenekler = {}) {
    this.bot = bot

    // Scales every wait: 1 in game (real durations), 0 in tests, where
    // waiting for teleports and chunk loads against a fake bot is pointless.
    // Without it the smoke test took 43 seconds, most of it `tazeAlanaIsinla`
    // waiting 4 x 4 seconds.
    this.zamanCarpani = secenekler.zamanCarpani ?? 1

    // Which task. The fixed part of the environment (observation, actions,
    // reward shape, episode logic) is shared; the four task-specific questions
    // live in `gorevler.js`. Defaults to 'odun' so Milestone 1-4 is unaffected.
    this.gorev = gorevGetir(secenekler.gorev || 'odun')

    // Wide-observation request. null = the task's own default
    // (`gozlemProfili`). Multi-task training sets it to true explicitly: one
    // network covering both tasks needs a single observation width.
    this.genisGozlem = secenekler.genisGozlem ?? null

    this.adim = 0
    this.oncekiOdun = 0
    this.oncekiMesafe = null
    this.hedefKonum = null      // locked target tree
    this.bolumBaslangicOdun = 0 // inventory at episode start, see below
    this.takilmaSayaci = 0      // consecutive steps unable to move forward
    this.durgunlukSayaci = 0    // consecutive steps with no progress at all
    this.yerindeSayma = 0       // steps without actually changing position
    this.esyaKovalama = 0       // steps spent chasing the same dropped item
    this.sonOlcum = null
    this.sonOlcumOdun = 0
    this.kacinmaAdimi = 0       // steps left in obstacle-avoidance mode
    this.kacinmaYonu = 1        // 1 = right, 2 = left
    this.karaListe = new Set()  // targets found to be unreachable
    this.yol = []               // path the expert planned (waypoints)
    this.yolZamani = 0
    this.yolHedefi = null
    this.hedefDenemesi = 0      // steps without progress on the current target
    this.dikeyDenemesi = 0      // steps unable to break a vertical target
    this.oldu = false           // died during this episode

    // Death tracking. Dying drops the whole inventory on the ground. Before
    // this was handled, one episode reported "-451 wood" and "-452 reward":
    // the bot started with 451 logs, fell off a cliff, lost its inventory, and
    // the reward counted that as 451 wood lost. In PPO an outlier like that
    // can destroy the policy in a single update.
    this.bot.on('death', () => { this.oldu = true })
  }

  // ----------------------------------------------------------- observation

  /**
   * Target log.
   *
   * Two traps, both of which corrupted the training data:
   *
   *  1) `bot.findBlock` does not reliably return the nearest match: it would
   *     hand back a tree 26 blocks away while one 6 blocks away stood there.
   *     All candidates are fetched now and distances computed here.
   *
   *  2) Re-picking the target every step made it flip between two trees at
   *     similar distance. When the "tree direction" in the observation jumps
   *     every step, neither expert nor agent can be consistent, so the target
   *     is now locked until the chosen tree is gone.
   */
  /**
   * Search radius, per task (see `aramaYaricapi` in gorevler.js).
   *
   * Derived, not copied. It used to be a `this.yaricap` field computed once in
   * the constructor, a silent trap for Milestone 6: `server.js` swaps
   * `env.gorev` on a task change but never updated the field, so switching
   * from wood to mining left the radius at 64 and silently brought back the
   * "locks onto an unreachable target" bug. Derived state cannot go stale.
   */
  get yaricap () {
    return this.gorev.aramaYaricapi ?? config.searchRadius
  }

  /** Does this observation carry the extra 4 numbers? (task default or explicit request) */
  get genisMi () {
    if (this.genisGozlem !== null) return this.genisGozlem
    return this.gorev.gozlemProfili === 'genis'
  }

  /**
   * Switch task at episode start.
   *
   * `server.js` used to do this by hand with `env.gorev = ...`, which gets
   * fragile as more derived state is added. One entry point instead.
   */
  gorevDegistir (ad) {
    if (ad && ad !== this.gorev.ad) {
      this.gorev = gorevGetir(ad)
      this.hedefKonum = null
      this.karaListe.clear()
      this.hedefDenemesi = 0
      this.dikeyDenemesi = 0
      return true
    }
    return false
  }

  enYakinKutuk () {
    // Reuse the locked target if it is still there
    if (this.hedefKonum) {
      const mevcut = this.bot.blockAt(this.hedefKonum)
      if (this.gorev.hedefMi(mevcut)) return mevcut
      this.hedefKonum = null // gone, pick a new one
    }

    const adaylar = this.bot.findBlocks({
      matching: (b) => this.gorev.hedefMi(b),
      maxDistance: this.yaricap,
      count: 128
    })
    if (adaylar.length === 0) return null

    // Nearest first, skipping player builds to get the first natural tree.
    // The cost metric is per task: straight-line distance in the forest, and
    // one that penalises vertical offset in the mine, since the agent moves
    // horizontally.
    const maliyet = this.gorev.hedefMaliyeti ||
      ((bot, konum) => konum.distanceTo(bot.entity.position))
    adaylar.sort((a, b) => maliyet(this.bot, a) - maliyet(this.bot, b))

    for (const konum of adaylar) {
      const anahtar = `${konum.x},${konum.y},${konum.z}`
      if (this.karaListe.has(anahtar)) continue

      const blok = this.bot.blockAt(konum)
      if (!this.gorev.dogalMi(this.bot, blok)) continue

      // Aim at the base of the trunk, not the log we found. In a forest the
      // nearest log in 3D is usually a branch up top, and locking onto it made
      // the bot wander toward a point it could never reach. Aiming at the base
      // lets it walk up and break its way upward, which is what a human player
      // does. Base of the trunk for wood, the block itself for mining.
      const dip = this.gorev.hedefiDuzelt(this.bot, this.bot.blockAt(konum))?.position || konum
      this.hedefKonum = dip
      return this.bot.blockAt(dip)
    }
    return null
  }

  /**
   * Drop the current target and never pick it again.
   *
   * The expert sometimes sees a target is unreachable before the environment
   * does (an ore directly overhead, for instance: the action space has no
   * "go up"). Better to blacklist it and move on than to circle it.
   */
  hedefiBirak () {
    if (!this.hedefKonum) return false
    const k = this.hedefKonum
    this.karaListe.add(`${k.x},${k.y},${k.z}`)
    this.hedefKonum = null
    this.hedefDenemesi = 0
    return true
  }

  /**
   * Breakable log in front of the bot.
   *
   * Not `blockAtCursor`, because the agent has no look up/down action (see
   * docs/architecture.md, action space). With the view pinned horizontal the
   * ray only hit the single block at eye level and never saw the rest of the
   * trunk, so the bot stood at the base of a tree breaking nothing.
   *
   * Vertical aim is done automatically here since it is not the agent's to
   * control; horizontal alignment stays the agent's job. It still has to learn
   * to turn toward a tree and approach it, just not to look up.
   */
  onundekiKutuk (menzil = 4.4, koniKosinusu = 0.82) {
    const bot = this.bot
    const goz = bot.entity.position.offset(0, bot.entity.height, 0)
    const bakis = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))

    const adaylar = bot.findBlocks({
      matching: (b) => this.gorev.hedefMi(b), maxDistance: menzil + 1, count: 48
    })

    let enIyi = null
    let enIyiSkor = -Infinity

    for (const konum of adaylar) {
      const merkez = konum.offset(0.5, 0.5, 0.5)
      const fark = merkez.minus(goz)
      const yatay = new Vec3(fark.x, 0, fark.z)
      const uzaklik = yatay.norm()

      // Reach in Minecraft is 3D distance from the eye. This used to check
      // horizontal distance only and cap the vertical offset at 2.5, which
      // marked the upper blocks of a trunk right next to the bot as out of
      // reach, so it looked for a way to climb instead of breaking them.
      if (fark.norm() > menzil) continue

      // Horizontal alignment is meaningless for a block straight overhead
      if (uzaklik > 0.9) {
        const hiza = yatay.scaled(1 / uzaklik).dot(bakis) // 1 = dead ahead
        if (hiza < koniKosinusu) continue
      }

      const aday = bot.blockAt(konum)
      if (!this.gorev.dogalMi(bot, aday)) continue // do not break player builds

      // Line of sight is required: no breaking through a wall.
      //
      // Mineflayer's `canDigBlock` only checks distance (digging.js:
      // `distanceTo(...) <= 5.1`), not line of sight, and the server accepted
      // it, so the bot broke ore 4 blocks away through solid stone. The ore
      // then dropped behind the wall out of reach: the break reward was paid
      // but nothing entered the inventory, which is where the zero in the
      // measurements came from.
      //
      // Worse for learning: the agent that was supposed to learn to dig a
      // tunnel to the ore got the reward without digging one, short-circuiting
      // the whole task.
      if (typeof bot.canSeeBlock === 'function' && !bot.canSeeBlock(aday)) continue

      // Cutting bottom-up is more efficient: prefer the lower block
      const skor = -fark.norm() - Math.max(0, fark.y) * 0.3
      if (skor > enIyiSkor) { enIyiSkor = skor; enIyi = aday }
    }

    return enIyi
  }

  /**
   * Is there a one-block step ahead?
   *
   * Solid block at foot level plus air at head level = a step the bot can jump
   * onto. Two blocks high cannot be jumped, so that does not count.
   */
  onumdeBasamakVar () {
    const bot = this.bot
    const bakis = new Vec3(-Math.sin(bot.entity.yaw), 0, -Math.cos(bot.entity.yaw))
    const p = bot.entity.position

    const ayakHizasi = bot.blockAt(p.offset(bakis.x * 0.8, 0.1, bakis.z * 0.8))
    const basHizasi = bot.blockAt(p.offset(bakis.x * 0.8, 1.2, bakis.z * 0.8))
    const ustu = bot.blockAt(p.offset(bakis.x * 0.8, 2.2, bakis.z * 0.8))

    if (!ayakHizasi || ayakHizasi.boundingBox !== 'block') return false
    if (basHizasi && basHizasi.boundingBox === 'block') return false // 2 blocks, no jump
    if (ustu && ustu.boundingBox === 'block') return false           // ceiling

    return true
  }

  /**
   * Is any solid block in the way, breakable or not?
   *
   * `onumuKapatan` only counts breakable soft blocks (leaves and such) because
   * the "break" action targets those. But walking into a dirt wall also stops
   * progress, and the agent has to be able to see it, otherwise it cannot
   * learn to stop walking into walls.
   *
   * A jumpable one-block step is not an obstacle.
   */
  /**
   * Samples points in front of the bot, not just the centre line.
   *
   * Both the obstacle sensor and the blocking-block check looked at a single
   * point straight ahead. The player box is 0.6 blocks wide, so a block off to
   * the diagonal stops movement even when the centre is clear.
   *
   * Seen in game: leaves on the left and right diagonal, centre empty. The
   * sensor reported clear, the agent pushed forward, the game did not let it
   * through. It jumped, still stuck, and never tried breaking, because the
   * blocking-block check had the same blind spot.
   *
   * Three samples: left edge, centre, right edge.
   */
  onumdekiNoktalar (menzil, yukseklikler) {
    const yaw = this.bot.entity.yaw
    const ileri = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const yan = new Vec3(-Math.cos(yaw), 0, Math.sin(yaw)) // perpendicular to forward
    const p = this.bot.entity.position

    // Centre first, then the diagonals. Order matters: written as
    // `[-0.35, 0, 0.35]` the bot always broke the left diagonal, because
    // `onumuKapatan()` returns the first block it finds. The centre block
    // stayed, the agent pushed forward and the game did not let it through.
    // The block that actually stops movement is the centre one.
    const noktalar = []
    for (const yukseklik of yukseklikler) {
      for (const kayma of [0, -0.35, 0.35]) {
        noktalar.push(p.offset(
          ileri.x * menzil + yan.x * kayma,
          yukseklik,
          ileri.z * menzil + yan.z * kayma
        ))
      }
    }
    return noktalar
  }

  onumdeEngelVar () {
    return !!this.onumdekiEngel()
  }

  /**
   * The blocking block itself, or null.
   *
   * `onumdeEngelVar()` was yes/no only, which hid a whole class of failure:
   * "there is a solid block ahead but `onumuKapatan()` does not consider it
   * breakable". In the measurements it only showed indirectly, as the expert
   * breaking nothing across 4 episodes, and took two rounds to track down.
   * (Cause: `aletTipi()` did not know 439 blocks such as `tuff` and `calcite`.)
   *
   * The block name now goes into the expert's reason string, so it shows up
   * directly in `gorev_kontrol.py` output.
   */
  onumdekiEngel () {
    if (this.onumdeBasamakVar()) return null

    for (const nokta of this.onumdekiNoktalar(0.8, [0.1, 1.2])) {
      const blok = this.bot.blockAt(nokta)
      if (blok && blok.boundingBox === 'block') return blok
    }
    return null
  }

  /** Walks down from the given log to the lowest log of the trunk */
  govdeninDibi (konum) {
    let en_alt = konum
    for (let i = 0; i < 24; i++) {
      const alt = en_alt.offset(0, -1, 0)
      if (!this.gorev.hedefMi(this.bot.blockAt(alt))) break
      en_alt = alt
    }
    return en_alt
  }

  /**
   * Is there an obstacle in the given yaw direction?
   *
   * The agent must be able to see left and right. When the expert is stuck it
   * has to turn somewhere, and picking that direction at random makes the
   * decision unlearnable from the observation, while "turned left because the
   * right is blocked" is recoverable from it.
   *
   * Basic rule of imitation learning: the expert must not rely on information
   * the student cannot see. These helpers are what keep that true.
   */
  yondeEngelVar (yawFarki) {
    const bot = this.bot
    const yaw = bot.entity.yaw + yawFarki
    const bakis = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const p = bot.entity.position

    // Foot level solid, head level clear: a jumpable step, not an obstacle
    const ayak = bot.blockAt(p.offset(bakis.x * 0.8, 0.1, bakis.z * 0.8))
    const bas = bot.blockAt(p.offset(bakis.x * 0.8, 1.2, bakis.z * 0.8))

    if (bas && bas.boundingBox === 'block') return true
    if (ayak && ayak.boundingBox === 'block') {
      const ust = bot.blockAt(p.offset(bakis.x * 0.8, 2.2, bakis.z * 0.8))
      if (ust && ust.boundingBox === 'block') return true // cannot jump
      return false // one-block step, passable
    }
    return false
  }

  solumKapali () { return this.yondeEngelVar(Math.PI / 2) }
  sagimKapali () { return this.yondeEngelVar(-Math.PI / 2) }

  /** Nearest item on the ground (wood dropped by a broken log) */
  yakinEsya (yaricap = 8) {
    let enIyi = null
    let enIyiMesafe = Infinity
    for (const e of Object.values(this.bot.entities)) {
      if (e.name !== 'item') continue
      const m = e.position.distanceTo(this.bot.entity.position)
      if (m < yaricap && m < enIyiMesafe) { enIyiMesafe = m; enIyi = e }
    }
    return enIyi
  }

  /**
   * Breakable block in the way.
   *
   * Walking to a tree the agent would hit a wall of leaves and stay there: it
   * had "break the log" but no "break what is in front of me". A real player
   * breaks the leaves and walks through.
   *
   * Eye level and foot level are both checked; either one filled means no
   * forward movement.
   */
  onumuKapatan (menzil = 1.6) {
    // Saying "any breakable block" here was a big mistake: after falling into
    // a cave the bot tried to mine stone by hand, which takes minutes and has
    // nothing to do with the task. Only the soft plant blocks around the tree
    // count as obstacles.
    const bot = this.bot

    const kirilabilir = (blok) => {
      if (!blok || blok.name === 'air') return false
      if (blok.boundingBox !== 'block') return false // water, grass etc. do not block
      // What may be broken is per task: leaves and such for wood, stone itself
      // for mining. The decision lives in gorevler.js.
      if (!this.gorev.engelKirilabilirMi(bot, blok)) return false
      return bot.canDigBlock(blok)
    }

    // Ahead: three points wide, foot and head level, at two distances.
    //
    // One distance was not enough: the default 1.6 blocks lands past the
    // neighbouring block and missed the leaf right in front. The obstacle
    // sensor looks at 0.8 and breaking looked at 1.6, so the agent saw
    // "blocked" and then found nothing to break.
    for (const uzaklik of [0.8, menzil]) {
      for (const nokta of this.onumdekiNoktalar(uzaklik, [0.1, 1.1])) {
        const blok = bot.blockAt(nokta)
        if (kirilabilir(blok)) return blok
      }
    }

    // Overhead. Sometimes the only way out is jumping, and leaves above the
    // head prevent it: seen in game as the bot jumping in place over and over.
    // Above counts as an obstacle too.
    const ustu = bot.blockAt(bot.entity.position.offset(0, 2.1, 0))
    if (kirilabilir(ustu)) return ustu

    return null
  }

  gozlem () {
    const bot = this.bot
    const p = bot.entity.position
    const kutuk = this.enYakinKutuk()

    let dx = 0; let dy = 0; let dz = 0; let mesafe = 1
    if (kutuk) {
      const fark = kutuk.position.minus(p)
      mesafe = Math.max(fark.norm(), 0.001)
      dx = fark.x / mesafe
      dy = fark.y / mesafe
      dz = fark.z / mesafe
      mesafe = Math.min(mesafe / this.yaricap, 1)
    }

    const baktigi = this.onundekiKutuk()

    return [
      dx, dy, dz,
      mesafe,
      bot.entity.yaw / Math.PI,
      bot.entity.pitch / Math.PI,
      Math.min(this.bolumOdunu() / this.gorev.hedefAdet, 1),
      (bot.health ?? 20) / 20,
      (bot.food ?? 20) / 20,
      this.gorev.hedefMi(baktigi) ? 1 : 0,
      bot.entity.onGround ? 1 : 0,
      this.adim / MAX_ADIM,
      this.onumdeEngelVar() ? 1 : 0, // blocked ahead
      this.solumKapali() ? 1 : 0,    // blocked on the left
      this.sagimKapali() ? 1 : 0,    // blocked on the right
      this.onumdeBasamakVar() ? 1 : 0, // jumpable step ahead
      // Extra numbers (see `EK_GOZLEM` in gorevler.js). Off by default for the
      // wood task, whose Milestone 4 models expect 16 numbers; multi-task
      // training turns them on with `genisGozlem: true`.
      ...(this.genisMi && this.gorev.ekGozlem ? this.gorev.ekGozlem(this) : [])
    ]
  }

  /**
   * Wood collected during this episode.
   *
   * Not the inventory total: the inventory is not cleared between episodes.
   * Using the absolute count, once 5 wood was collected in the first episode
   * every later one ended in a single step as "target already reached" and
   * almost all training data was lost.
   */
  bolumOdunu () {
    return this.gorev.say(this.bot) - this.bolumBaslangicOdun
  }

  /** Raw, un-normalised distance, for the reward calculation */
  hamMesafe () {
    const kutuk = this.enYakinKutuk()
    if (!kutuk) return null
    return kutuk.position.distanceTo(this.bot.entity.position)
  }

  // ---------------------------------------------------------------- action

  async aksiyonUygula (action) {
    const bot = this.bot
    const oncekiKonum = bot.entity.position.clone()
    let kirilanKutuk = 0

    switch (action) {
      case 0: { // walk forward
        // Jump assist so one-block steps do not trap the bot.
        //
        // This used to be "walk, check after 250ms whether we moved, jump if
        // not", which was timing-dependent and unreliable: if the bot moved a
        // little in the first half and got stuck in the second, the check
        // never fired and it slid sideways along the wall.
        //
        // Now the check happens up front instead of guessing: a solid block
        // ahead with air above it is a step, so jump is held from the start.
        // Not a macro, just the game's physics; Bedrock ships this as an
        // "auto jump" setting.
        const basamakVar = this.onumdeBasamakVar()

        bot.setControlState('forward', true)
        if (basamakVar) bot.setControlState('jump', true)
        await this.bekle(280)

        // Still stuck (an obstacle we did not predict): jump once more
        if (!basamakVar && bot.entity.onGround &&
            bot.entity.position.xzDistanceTo(oncekiKonum) < 0.08) {
          bot.setControlState('jump', true)
        }
        await this.bekle(280)

        bot.setControlState('jump', false)
        bot.setControlState('forward', false)
        break
      }

      case 1: // turn right (22.5°)
        await bot.look(bot.entity.yaw - DONUS_ACISI, 0, true)
        break

      case 2: // turn left (22.5°)
        await bot.look(bot.entity.yaw + DONUS_ACISI, 0, true)
        break

      case 3: { // break the block ahead (the blocking block if there is no log)
        const hedef = this.onundekiKutuk() || this.onumuKapatan()
        if (hedef && bot.canDigBlock(hedef)) {
          const kutuktu = this.gorev.hedefMi(hedef)
          try {
            // Equip the right tool if we have one; bare hands are ~8x slower
            await aletKusan(bot, hedef)
            // Vertical aim is automatic, then the view is pinned horizontal again
            await bot.lookAt(hedef.position.offset(0.5, 0.5, 0.5), true)
            await bot.dig(hedef)
            if (kutuktu) kirilanKutuk = 1 // reward is for logs only
          } catch (err) { /* a failed dig already costs the time penalty */ }
          await bot.look(bot.entity.yaw, 0, true)
        }
        break
      }

      case 4: // wait
      default:
        await this.bekle(200)
        break
    }

    return kirilanKutuk
  }

  // ------------------------------------------------------------------ loop

  async reset () {
    this.adim = 0
    this.hedefKonum = null
    this.takilmaSayaci = 0
    this.durgunlukSayaci = 0
    this.yerindeSayma = 0
    this.esyaKovalama = 0
    this.sonOlcum = null
    this.sonOlcumOdun = 0
    this.kacinmaAdimi = 0
    this.karaListe.clear()
    this.hedefDenemesi = 0
    this.dikeyDenemesi = 0
    this.yol = []
    this.yolZamani = 0
    this.yolHedefi = null
    this.oldu = false
    pathfinderDurdur(this.bot)
    this.bot.clearControlStates()

    // The agent has no look up/down action. Pinning the view horizontal keeps
    // the "break" action targeting the block at eye level.
    await this.bot.look(this.bot.entity.yaw, 0, true)

    // Start the episode facing a random direction.
    //
    // The expert used to start every episode already facing a tree, so nearly
    // all demo data was the "break" action and "turn left" never appeared. A
    // network trained on that only learns to break and is lost when no tree is
    // in front of it. A random start heading produces turning and walking
    // examples in the demos.
    await this.bot.look(Math.random() * 2 * Math.PI - Math.PI, 0, true)

    // Set up the episode per task. Wood and mining setups are opposites: one
    // wants the surface, the other underground. The only shared part is making
    // sure there is something to collect before the episode starts.
    //
    // Getting out of water is task-independent. It used to sit inside the
    // surface setup and the bot drowned on the mining task: water pockets
    // underground are common, but the rescue only ran for wood. The agent has
    // no swim action, so drowning is the environment's problem in every task.
    await this.sudanCik()

    // Clear the inventory first, then run setup. Order matters: setup gives
    // the agent a pickaxe, and clearing afterwards would delete it. Written
    // the other way round once, the inventory filled up across episodes and
    // `/give` stopped doing anything.
    if (this.gorev.temizlemeEtiketi === '*') {
      this.bot.chat(`/clear ${this.bot.username}`)
      await this.bekle(300)
    } else if (this.gorev.temizlemeEtiketi) {
      this.bot.chat(`/clear ${this.bot.username} ${this.gorev.temizlemeEtiketi}`)
    }

    if (this.gorev.yuzeyGorevi) {
      await this.yuzeyKurulumu()
    } else {
      await this.yeraltiKurulumu()
    }

    // Do not let target-less episodes pass silently. After drowning, the bot
    // respawned somewhere with no trees and 50+ consecutive episodes ended
    // with "0 resources, 60 steps, -0.60 reward". The numbers kept scrolling
    // past and nothing said there was nothing to learn here, so PPO tried to
    // learn from the noise.
    if (!this.enYakinKutuk()) {
      this.hedefsizBolum = (this.hedefsizBolum || 0) + 1
      if (this.hedefsizBolum >= 3) {
        const p = this.bot.entity.position
        log.hata(
          `${this.hedefsizBolum} bölümdür ${this.gorev.ad} bulamıyorum! ` +
          `Konum: x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} z=${p.z.toFixed(0)}. ` +
          'Bu bölümler eğitime ZARAR veriyor — eğitimi durdurup botu ' +
          'uygun bir yere ışınla (/tp MinecrAI <x> <y> <z>).'
        )
      }
    } else {
      this.hedefsizBolum = 0
    }

    // Move the episode start to a sane distance from the tree.
    //
    // This pathfinder call is episode setup, not an agent action. The
    // distinction matters: the agent still learns walking and turning itself,
    // this only makes every episode start from a similar distribution.
    // Otherwise, as the trees get cut down, the bot ends up stranded in a
    // cleared forest producing empty episodes.
    //
    // Only for tasks where it does not solve the task itself: in the mine the
    // pathfinder would dig the tunnel on the agent's behalf.
    if (this.gorev.baslangictaYurut !== false) await this.baslangicaTasi()
    // Empty the inventory.
    //
    // Wood piles up between episodes and the inventory (36 slots x 64) fills
    // up eventually. Once full, broken logs do not enter it: "wood = 0" while
    // the reward stays positive, because it contains a 0.2 x broken-log term.
    // Measured: from about episode 110 on, every episode ended with 0 wood
    // after 500 steps. The 5-wood target then becomes unreachable, episodes
    // never end, and the main source of reward is permanently zeroed out.
    //
    // The `#minecraft:logs` tag covers every log type; the axe and other tools
    // stay in the inventory. Whichever resource the task collects is what gets
    // cleared. Mining has no such tag (ores are not grouped under one), so the
    // clear is skipped there and the inventory counter is zeroed at episode
    // start instead.

    // Clear the dropped items too.
    //
    // Clearing the inventory and leaving the ground is not enough: each
    // episode piles onto the previous one's litter, and later episodes let the
    // agent walk over old stacks and collect free reward it did not earn.
    //
    // It learns the wrong lesson from that ("walking gives me wood") and the
    // measurements inflate: this is why a random agent "collected" 4.6 wood in
    // the evaluation. Every episode should start from the same clean state.
    this.bot.chat(`/kill @e[type=item,distance=..${TEMIZLIK_YARICAPI}]`)
    await this.bekle(500)

    const kalanOdun = this.gorev.say(this.bot)
    if (kalanOdun > 0) {
      // /clear does nothing unless the bot is op: warn instead of failing silently
      log.uyari(
        `Envanter temizlenemedi (${kalanOdun} kütük kaldı). ` +
        `Bot op mu? Sunucu konsoluna: op ${this.bot.username}`
      )
    }

    this.oncekiOdun = kalanOdun
    this.bolumBaslangicOdun = this.oncekiOdun
    this.oncekiMesafe = this.hamMesafe()

    return { obs: this.gozlem(), info: { odun: 0, adim: 0 } }
  }

  /**
   * Episode setup: bring the bot to the surface if it is underground.
   *
   * Walking forward the agent can fall into a pit or a cave, and getting out
   * with its 5 actions is practically impossible, wasting the episode. Episode
   * setup, not an agent action, like setting the start position.
   */
  /**
   * Is there open sky overhead?
   *
   * The old check only looked 5 blocks up and was wrong in a big cave: with
   * the ceiling 20 blocks up it reported open sky while the bot was 40 blocks
   * underground. That is what happened when the bot fell into a mine and could
   * not get out; the rescue never fired because the environment did not notice
   * it was stuck.
   *
   * The right question is not "is there a ceiling nearby" but "is it open all
   * the way up".
   */
  acikHavadaMi (tavan = 200) {
    const p = this.bot.entity.position.floored()
    for (let y = p.y + 2; y < tavan; y++) {
      const b = this.bot.blockAt(new Vec3(p.x, y, p.z))
      if (b && b.boundingBox === 'block') return false
    }
    return true
  }

  async yuzeyeCik (zamanAsimi = 20000) {
    const bot = this.bot
    const p = bot.entity.position.floored()

    if (this.acikHavadaMi()) return false

    // First spot going up with solid ground plus two blocks of air above it
    for (let y = p.y + 2; y < p.y + 48; y++) {
      const alt = bot.blockAt(new Vec3(p.x, y - 1, p.z))
      const orta = bot.blockAt(new Vec3(p.x, y, p.z))
      const ust = bot.blockAt(new Vec3(p.x, y + 1, p.z))
      if (!alt || !orta || !ust) continue
      if (alt.boundingBox !== 'block') continue
      if (orta.name !== 'air' || ust.name !== 'air') continue

      try {
        pathfinderHazirla(bot)
        await Promise.race([
          bot.pathfinder.goto(new goals.GoalBlock(p.x, y, p.z)),
          new Promise((_, red) => setTimeout(() => red(new Error('zaman_asimi')), zamanAsimi))
        ])
        return true
      } catch (err) {
        pathfinderDurdur(bot)
        return false
      }
    }
    return false
  }

  /**
   * Teleport to a fresh area when no trees are left nearby.
   *
   * The agent cuts down the forest it learns in. As training goes on the trees
   * run out, the bot has to walk further, episodes get longer and reward
   * drops: measured at 30-120 steps early on, 280-320 after episode 50.
   *
   * That breaks RL's basic assumption of a stationary environment. When the
   * environment gets harder on its own the learning curve stops being
   * measurable: a flat line could be real improvement and there is no way to
   * tell.
   *
   * `/spreadplayers` places the bot safely on solid ground at a random spot;
   * the bot is op so it can run the command. Episode setup, not an agent
   * action, like setting the start position.
   */
  async tazeAlanaIsinla (deneme = 4) {
    const bot = this.bot

    for (let i = 0; i < deneme; i++) {
      const p = bot.entity.position
      // Move away from the centre so the same area is not consumed twice
      const menzil = 120 + i * 80

      bot.chat(`/spreadplayers ${Math.round(p.x)} ${Math.round(p.z)} 40 ${menzil} false ${bot.username}`)

      // Teleport plus chunk load
      await this.bekle(2500)
      this.hedefKonum = null
      this.karaListe.clear()

      if (this.enYakinKutuk()) return true
      await this.bekle(1500) // one more chance if the chunks arrived late
      if (this.enYakinKutuk()) return true
    }
    return false
  }

  /** Water at foot or eye level? */
  suyunIcindeMi () {
    const p = this.bot.entity.position
    for (const dy of [0, 1]) {
      const b = this.bot.blockAt(p.offset(0, dy, 0))
      if (b && /water|bubble_column/.test(b.name)) return true
    }
    return false
  }

  /**
   * Get out of the water.
   *
   * The action space has no swimming: forward, right, left, break, wait. Fall
   * in and there is nothing to do but drown, and it did: after that death the
   * training log has 50+ consecutive episodes of "0 wood, 60 steps, -0.60
   * reward". Punishing the agent in a situation it cannot learn out of is
   * noise, not learning, so the environment fixes it.
   */
  async sudanCik () {
    if (!this.suyunIcindeMi()) return false

    log.uyari('Sudayım — çıkmaya çalışıyorum.')
    this.bot.setControlState('jump', true) // jumping in water = swimming up
    const bitis = Date.now() + 6000
    while (Date.now() < bitis && this.suyunIcindeMi()) {
      await this.bekle(300)
    }
    this.bot.setControlState('jump', false)

    // Still in water: teleporting to land is the only option left
    if (this.suyunIcindeMi()) {
      await this.tazeAlanaIsinla()
      return true
    }
    return true
  }

  /**
   * Surface task setup (wood): get out of water or a cave, and teleport to a
   * fresh area if no trees are left around.
   */
  async yuzeyKurulumu () {
    await this.yuzeyeCik()

    // The action space has no "climb to the surface"; being stuck in a cave
    // is the environment's problem.
    if (!this.acikHavadaMi()) {
      log.uyari('Yeraltındayım — yüzeye ışınlanıyorum.')
      await this.tazeAlanaIsinla()
    }

    // The agent cuts down the forest it learns in; a non-stationary
    // environment makes the learning curve unmeasurable.
    if (!this.enYakinKutuk()) await this.tazeAlanaIsinla()
  }

  /**
   * Teleport to a fresh mining area.
   *
   * Collecting 40 demo episodes, the first 18 went well (8, 6, 22, 12 ore) and
   * 19-35 were almost all zero: the bot had exhausted the ore around it. The
   * wood task solves this with `/spreadplayers`, but that command puts the
   * player on the surface, which is useless in a mine since the descent would
   * start over every time.
   *
   * Instead: teleport to a distant XZ point at the same depth. Teleporting
   * there blind leaves the bot inside stone and suffocates it, so a 1x2 pocket
   * is opened with `/fill` and a floor placed under it first. Both are op
   * commands, and the bot has to be op anyway (that is how it gets a pickaxe).
   */
  async tazeMadeneIsinla (deneme = 4) {
    const bot = this.bot

    // Verify after the teleport. With the search radius down to 16 (see
    // gorevler.js) a random point can genuinely have no ore near it. The wood
    // task's `tazeAlanaIsinla` already retries in a loop; the mining side was
    // one-shot and produced target-less episodes, which are pure noise to PPO.
    for (let i = 0; i < deneme; i++) {
      const p = bot.entity.position
      const y = Math.floor(p.y)

      // Random direction, 60-140 blocks out
      const aci = Math.random() * 2 * Math.PI
      const uzaklik = 60 + Math.random() * 80
      const x = Math.round(p.x + Math.cos(aci) * uzaklik)
      const z = Math.round(p.z + Math.sin(aci) * uzaklik)

      // Open the pocket first, then teleport: the other order means suffocating
      bot.chat(`/fill ${x} ${y} ${z} ${x} ${y + 1} ${z} air`)
      bot.chat(`/setblock ${x} ${y - 1} ${z} stone keep`)
      await this.bekle(300)
      bot.chat(`/tp ${bot.username} ${x + 0.5} ${y} ${z + 0.5}`)
      await this.bekle(600)

      this.hedefKonum = null
      this.karaListe.clear()

      if (this.enYakinKutuk()) {
        log.bilgi(`Taze maden bölgesi: x=${x} y=${y} z=${z}`)
        return true
      }
      await this.bekle(900) // one more chance if the chunk arrived late
      this.hedefKonum = null
      if (this.enYakinKutuk()) {
        log.bilgi(`Taze maden bölgesi: x=${x} y=${y} z=${z}`)
        return true
      }
    }
    log.uyari(`${deneme} denemede ${this.yaricap} blok içinde cevher bulamadım.`)
    return false
  }

  /**
   * Underground task setup (mining).
   *
   * The descent is deliberately not taught to the agent: getting from y=64
   * down to ore level takes thousands of steps and an episode is 500, so the
   * agent would never reach a reward and never learn anything.
   *
   * The task is scoped to "you are at ore level with a pickaxe, collect 5 ore
   * in 500 steps", which is the same size as the tree task and trains with the
   * same PPO code. The descent is episode setup, like `baslangicaTasi` in the
   * wood task.
   */
  async yeraltiKurulumu () {
    const bot = this.bot

    // 1) Breaking ore without a pickaxe destroys it: guarantee the tool first
    if (this.gorev.aletVer) {
      const { uygunAlet } = require('../skills/alet')
      if (!uygunAlet(bot, { name: 'iron_ore' })) {
        bot.chat(`/give ${bot.username} ${this.gorev.aletVer} 1`)
        await this.bekle(600)

        // Verify what was given. `/give` needs op and fails silently. Without
        // a pickaxe the bot breaks ore and nothing drops, which is exactly
        // what the measurements showed: 63% "ore in front of me", 0 resources.
        if (!uygunAlet(bot, { name: 'iron_ore' })) {
          // The server log showed `/give` succeeding; the item could not
          // enter the inventory because all 36 slots were full. Reporting
          // "you are not op" was the wrong diagnosis and cost hours of
          // looking in the wrong place.
          const dolu = bot.inventory.items().length
          log.hata(
            `${this.gorev.aletVer} envantere giremedi (${dolu} slot dolu). ` +
            'Envanter dolu olabilir ya da bot op değildir — sunucu ' +
            'konsolunda /give çıktısına bak.'
          )
        }
      }
    }

    // 2) Descend by depth, not by "can I see ore".
    //
    // Written once as "no need to descend if ore is already visible", the task
    // never worked. Ore is visible on the surface too: a coal vein in a cliff
    // face, iron at a cave mouth. The bot locked onto unreachable ore 30
    // blocks away and circled on the surface.
    //
    // The measurements said it: 63% "turning toward ore", 10% walking, no
    // breaking at all. Underground it would have had stone in front of it and
    // would have broken it.
    //
    // The task says "start at ore level", so the criterion is depth.
    const hedefY = this.gorev.baslangicY ?? 15
    if (Math.floor(bot.entity.position.y) > hedefY + 6) {
      // Spread the descent over episodes.
      //
      // y=70 to y=15 is ~55 steps down, 3 blocks broken each, taking minutes.
      // On the first attempt the Python socket timed out and dropped the
      // training run; reset must not block for minutes.
      //
      // So each reset descends at most 12 steps. The bot stays underground, so
      // after a few episodes it reaches the target depth and the descent stops
      // running. Same total time, without one call that hangs.
      log.bilgi(`Maden görevi: y=${hedefY} hedefi, şu an y=${Math.floor(bot.entity.position.y)}`)
      const { seviyeyeIn } = require('../skills/kaz')
      const sahteKontrol = { kontrolEt () {}, bekle: (ms) => this.bekle(ms) }
      try {
        await seviyeyeIn(bot, hedefY, sahteKontrol, { seviye: 'stone', maksBasamak: 12 })
      } catch (err) {
        log.uyari(`İniş yarıda kaldı: ${err.message}`)
      }
      return
    }

    // 4) At depth but no ore: the area is exhausted, move to a fresh one.
    //    The agent mines out the area it learns in, and a non-stationary
    //    environment makes the learning curve unmeasurable. The wood task
    //    teleports for the same reason.
    if (!this.enYakinKutuk()) {
      await this.tazeMadeneIsinla()
    }
  }

  /** Episode setup: walk to a sane distance if there is a tree nearby */
  async baslangicaTasi (idealMesafe = 10, zamanAsimi = 15000) {
    const hedef = this.enYakinKutuk()
    if (!hedef) return false

    const mesafe = hedef.position.distanceTo(this.bot.entity.position)
    if (mesafe <= idealMesafe + 5) return false

    try {
      pathfinderHazirla(this.bot)
      await Promise.race([
        this.bot.pathfinder.goto(new goals.GoalNear(
          hedef.position.x, hedef.position.y, hedef.position.z, idealMesafe
        )),
        new Promise((_, red) => setTimeout(() => red(new Error('zaman_asimi')), zamanAsimi))
      ])
      return true
    } catch (err) {
      pathfinderDurdur(this.bot)
      return false
    } finally {
      this.hedefKonum = null
      // the pathfinder leaves the bot facing the target: re-randomise the heading
      await this.bot.look(Math.random() * 2 * Math.PI - Math.PI, 0, true)
    }
  }

  /**
   * In water? Then swim up.
   *
   * The action space has no swimming, so once in water the bot sinks and
   * drowns whatever it does. That happened once and produced 50 episodes of
   * garbage data. Getting out of water at episode start was already handled;
   * falling in mid-episode still killed it.
   *
   * The jump key means "swim up" in water. Pressing it on the agent's behalf
   * does not widen the action space, it prevents a death the agent cannot
   * affect, the same way it does not manage its own health bar.
   */
  async suUstundeKal () {
    if (!this.suyunIcindeMi()) return false
    this.bot.setControlState('jump', true)
    await this.bekle(150)
    this.bot.setControlState('jump', false)
    return true
  }

  /**
   * Replace the pickaxe if it breaks mid-episode.
   *
   * An iron pickaxe lasts 250 hits; an episode is 500 steps and tunnelling
   * eats hits, so breaking is expected, not an edge case.
   *
   * Once broken the agent keeps hitting ore and every hit destroys one, which
   * is exactly the "63% ore in front of me, 0 resources" measurement. The
   * agent cannot tell from its observation: tool state is not in there, and
   * does not need to be.
   *
   * Tool supply is not what this task is about (the hand-written `kaz.js`
   * already handles it). What the agent learns is "find ore and break it".
   */
  async aletiTazele () {
    if (!this.gorev.aletVer) return
    const { kazmaDurumu } = require('./gorevler')
    if (kazmaDurumu(this.bot).kalan > 0) return

    this.bot.chat(`/give ${this.bot.username} ${this.gorev.aletVer} 1`)
    await this.bekle(300)
    if (kazmaDurumu(this.bot).kalan <= 0) {
      log.hata(
        `Kazma kırıldı ve yenisini veremedim (bot op değil mi?). ` +
        'Bu bölümde kırılan her cevher YOK OLUYOR.'
      )
    }
  }

  async step (action) {
    this.adim++
    await this.suUstundeKal()
    if (action === 3) await this.aletiTazele()
    const oncekiKonum = this.bot.entity.position.clone()

    const kirilanKutuk = await this.aksiyonUygula(action)

    // Did we move? "Walk forward" with no change in position means we hit
    // something.
    const ilerleme = this.bot.entity.position.xzDistanceTo(oncekiKonum)
    if (action === 0 && ilerleme < 0.08) this.takilmaSayaci++
    else if (action === 0) this.takilmaSayaci = 0

    // --- reward ---
    const odun = this.gorev.say(this.bot)

    // A drop in the inventory is a loss, not a collection (death, full
    // inventory). The agent is meant to learn to collect wood; writing
    // inventory losses into the reward produces huge negative outliers.
    const yeniOdun = Math.max(0, odun - this.oncekiOdun)

    // Collecting something resets the item-chase counter: the chase worked.
    if (yeniOdun > 0) this.esyaKovalama = 0
    this.oncekiOdun = odun

    const mesafe = this.hamMesafe()
    let yaklasma = 0
    if (mesafe !== null && this.oncekiMesafe !== null) {
      yaklasma = this.oncekiMesafe - mesafe
    }
    this.oncekiMesafe = mesafe

    let reward =
      1.00 * yeniOdun +
      0.20 * kirilanKutuk +
      0.05 * yaklasma -
      0.01

    // Death: a flat, moderate penalty, not the size of the inventory loss.
    // The agent should learn to avoid cliffs, not be traumatised by one fall.
    if (this.oldu) reward += OLUM_CEZASI

    // No progress at all (no wood, no closing distance): bump the counter.
    // Spending 300 steps of an episode against a wall corrupts the data and
    // eats hours of PPO training for an episode that teaches nothing.
    if (yeniOdun <= 0 && kirilanKutuk === 0 && Math.abs(yaklasma) < 0.05) {
      this.durgunlukSayaci++
    } else {
      this.durgunlukSayaci = 0
    }

    // Close to the target but breaking nothing means it is unreachable (up a
    // tree, in the middle of water, behind a cliff). Blacklist it and move on,
    // otherwise the whole episode is spent there.
    if (this.hedefKonum) {
      const yakin = this.hedefKonum.xzDistanceTo(this.bot.entity.position) < 4
      if (yakin && kirilanKutuk === 0 && yeniOdun <= 0) this.hedefDenemesi++
      else this.hedefDenemesi = 0

      if (this.hedefDenemesi >= HEDEF_SABIR) {
        this.karaListe.add(
          `${this.hedefKonum.x},${this.hedefKonum.y},${this.hedefKonum.z}`)
        this.hedefKonum = null
        this.hedefDenemesi = 0
      }
    }

    // Giving up on a vertical target is the environment's job, not the
    // expert's.
    //
    // Directly under or over the target (horizontal distance < 2) with nothing
    // breakable in range means the target is out of scope: the action space
    // has no "go up". `HEDEF_SABIR` (20 steps) is far too slow here, since the
    // stuck-in-place cutoff is 60 steps and three bad targets eat a whole
    // episode.
    //
    // This logic lived in `expert.js` and nothing called it once PPO took the
    // wheel; episodes 2-18 of that run all ended with zero resources.
    if (this.gorev.dikeyBirakma && this.hedefKonum) {
      const p = this.bot.entity.position
      const yatay = Math.hypot(
        this.hedefKonum.x + 0.5 - p.x,
        this.hedefKonum.z + 0.5 - p.z
      )
      if (yatay < 2 && !this.onumuKapatan() && kirilanKutuk === 0) {
        this.dikeyDenemesi++
      } else {
        this.dikeyDenemesi = 0
      }
      if (this.dikeyDenemesi >= DIKEY_SABIR) {
        this.hedefiBirak()
        this.dikeyDenemesi = 0
      }
    }

    const bolumOdun = Math.max(0, this.bolumOdunu())

    // Stuck-in-place detection.
    //
    // `durgunlukSayaci` watches the change in distance to the target and
    // resets on the slightest movement. An agent buried in leaves wiggles a
    // little left and right, so the counter never filled: the training log has
    // a 455-step episode with 0 wood and -4.53 reward, nearly the whole step
    // limit spent in the top of a tree.
    //
    // This check is different: it records the actual position every 20 steps.
    // Less than 2 blocks of movement in 60 steps with no wood collected means
    // no progress, however much it wiggles.
    if (this.adim % 20 === 0) {
      const suan = this.bot.entity.position
      if (this.sonOlcum &&
          suan.distanceTo(this.sonOlcum) < 2 &&
          bolumOdun === this.sonOlcumOdun) {
        this.yerindeSayma += 20
      } else {
        this.yerindeSayma = 0
      }
      this.sonOlcum = suan.clone()
      this.sonOlcumOdun = bolumOdun
    }

    const terminated = bolumOdun >= this.gorev.hedefAdet || this.oldu
    const truncated = this.adim >= MAX_ADIM ||
      this.durgunlukSayaci >= DURGUNLUK_SINIRI ||
      this.yerindeSayma >= 60

    return {
      obs: this.gozlem(),
      reward,
      terminated,
      truncated,
      info: {
        odun: bolumOdun, envanter: odun, adim: this.adim, yeniOdun, kirilanKutuk,
        takildi: this.takilmaSayaci, durgun: this.durgunlukSayaci, oldu: this.oldu
      }
    }
  }

  /**
   * Diagnostics: why the expert decided what it did, and what is around it.
   *
   * "The expert is doing nothing" left nothing to go on but guesswork. This
   * shows how the environment looks to the expert in one glance.
   */
  taniBilgisi () {
    const hedef = this.enYakinKutuk()
    const esya = this.yakinEsya()
    const p = this.bot.entity.position

    return {
      konum: [Math.round(p.x), Math.round(p.y), Math.round(p.z)],
      hedefVar: !!hedef,
      hedefMesafe: hedef ? +hedef.position.distanceTo(p).toFixed(1) : null,
      menzildeKutuk: !!this.onundekiKutuk(),
      yerdeEsya: !!esya,
      esyaMesafe: esya ? +esya.position.distanceTo(p).toFixed(1) : null,
      onumKapali: this.onumdeEngelVar(),
      karaListe: this.karaListe.size,
      envanterOdun: this.gorev.say(this.bot)
    }
  }

  /** Action the expert policy would pick in this state (Milestone 3) */
  uzmanAksiyonu () {
    const { uzmanAksiyonu } = require('./expert')
    return uzmanAksiyonu(this.bot, this)
  }

  // ----------------------------------------------------------------- helpers

  bekle (ms) {
    return new Promise((r) => setTimeout(r, ms * this.zamanCarpani))
  }

  zamanAsimiyla (soz, ms) {
    return Promise.race([
      soz,
      new Promise((_, red) => setTimeout(() => red(new Error('zaman asimi')), ms))
    ])
  }
}

module.exports = {
  MinecraftEnvironment, MAX_ADIM, HEDEF_ODUN, DONUS_ACISI, OLUM_CEZASI,
  DURGUNLUK_SINIRI, TAKILMA_ESIGI, KACINMA_SURESI
}
