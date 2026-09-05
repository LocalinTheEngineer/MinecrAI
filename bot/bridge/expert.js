'use strict'

/**
 * Expert policies.
 *
 * The base of Milestone 3. Every step it answers "what would the expert do
 * with this observation?", and those (observation, action) pairs are the
 * training data for behaviour cloning.
 *
 * Design: the expert is reactive, it does not plan.
 *
 * This file was once turned into an A* path planner and reverted. The reason
 * was measured: BC accuracy fell from 88% to 52% and training and validation
 * loss plateaued together. That is not the signature of overfitting, it is
 * the signature of unlearnable data.
 *
 * The rule: the expert cannot rely on information the student cannot see.
 * The agent sees a 19-number observation; the planning expert knew the whole
 * map. The same observation got labelled "left" sometimes and "right" other
 * times, and the network learned the average of the two.
 *
 * So every decision here is derived from what the agent also sees: direction
 * of the target, whether front/left/right are blocked, what is in range.
 *
 * Two tasks, two experts. `odunUzmani` and `madenUzmani` share the same
 * helpers; the only difference is the priority list.
 */

// Off by more than this angle and turning comes first. Must stay in line with
// DONUS_ACISI (22.5°) in environment.js: if the turn step is larger than twice
// the tolerance the target is never hit and the bot oscillates.
const YAW_TOLERANS = 0.22

// Max steps spent chasing the same dropped item.
//
// Measured: in the mine task 79% of steps were "picking up nearby ore":
// breaking, walking, turning, with the item never reaching the inventory. One
// item lying on the ground but unreachable (fallen into the hole it dug, left
// behind a wall) kept the expert busy for a whole episode.
//
// Trees solved the same problem with a blacklist; a patience counter is
// simpler here because items are moving entities, so blacklisting their
// position does not work.
const ESYA_SABRI = 25

/** Yaw needed to face a target (Minecraft convention) */
function hedefYaw (botPos, hedefPos) {
  const dx = hedefPos.x + 0.5 - botPos.x
  const dz = hedefPos.z + 0.5 - botPos.z
  return Math.atan2(-dx, -dz)
}

/** Shortest difference between two angles, wrapped into -pi..pi */
function aciFarki (a, b) {
  let fark = a - b
  while (fark > Math.PI) fark -= 2 * Math.PI
  while (fark < -Math.PI) fark += 2 * Math.PI
  return fark
}

/** One step toward a point: turn when not aligned, walk when aligned */
function yonel (bot, hedefPos, donSebebi, yuruSebebi) {
  const istenen = hedefYaw(bot.entity.position, hedefPos)
  const fark = aciFarki(istenen, bot.entity.yaw)

  if (Math.abs(fark) > YAW_TOLERANS) {
    // in mineflayer, rising yaw means turning left (action 2)
    return fark > 0
      ? { action: 2, sebep: donSebebi + '_sola' }
      : { action: 1, sebep: donSebebi + '_saga' }
  }
  return { action: 0, sebep: yuruSebebi }
}

/**
 * Returns the action the expert would pick for the current state.
 *
 * Priority order, which sets the quality of the demo data:
 *   1. Break a log in range (highest-yield immediate work)
 *   2. Walk onto wood on the ground (the real reward source: 1.0 per wood)
 *   3. Plan the path to a tree, head for the next waypoint
 *   4. No path: reactively turn toward the target (last resort)
 *
 * @returns {{action: number, sebep: string}}
 */
/**
 * Mine expert.
 *
 * Same skeleton as the wood expert, differing in two places:
 *
 *  - For wood, "no target means wait" was right: if you cannot see a tree in
 *    a forest you turn and look, there is nothing to dig. The mine is the
 *    opposite, ore is hidden inside stone and not seeing it is normal. The
 *    right answer there is to dig a tunnel, not wait.
 *  - Breaking stone is forbidden for wood and is the task itself in the mine.
 *
 * The agent still reads the same 19-number observation and picks one of the
 * same 5 actions. Only the examples it imitates change.
 */
function madenUzmani (bot, env) {
  // 1) Ore or ingot on the ground: the real reward source (1.0), breaking is 0.2
  const yakinEsya = env.yakinEsya(5)
  if (yakinEsya && env.esyaKovalama < ESYA_SABRI) {
    env.esyaKovalama++
    return hedefeYonel(bot, env, yakinEsya.position, 'yakin_cevheri_aliyorum')
  }

  // 2) Break ore in range
  if (env.onundekiKutuk()) {
    return { action: 3, sebep: 'onumde_cevher_var' }
  }

  // 3) Ore visible but far: turn toward it and walk
  const hedef = env.enYakinKutuk()
  if (hedef) {
    // Yaw is meaningless for a vertical target.
    //
    // `hedefYaw` only looks at dx and dz; height difference does not enter
    // because the agent has no look-up-or-down action. With ore almost
    // straight overhead dx and dz are near zero, so a one-block wobble swings
    // the angle by 180 degrees and the bot spins forever trying to "turn
    // toward" the target.
    //
    // Measured: 76% of steps were turns, 10% walking, and 13 of 15 episodes
    // ended with zero resources. This happens far more often in a mine than
    // in a forest because ore veins run in every direction, ceiling and floor
    // included.
    //
    // The right move for a vertical target is not turning: break it if in
    // range (breaking already looks in 3D), otherwise move on and open up
    // the angle.
    const yatay = Math.hypot(
      hedef.position.x + 0.5 - bot.entity.position.x,
      hedef.position.z + 0.5 - bot.entity.position.z
    )
    if (yatay < 2) {
      // In range: break it (breaking already looks in 3D)
      if (env.onumuKapatan()) {
        return { action: 3, sebep: 'dikey_hedef_kiriyorum' }
      }

      // Can't break it: drop the target.
      //
      // The first version here was "move on, open up the angle", and that
      // opened a new loop: the bot walks away, horizontal distance passes 2,
      // it turns back to the target, closes in, walks away again. Net
      // displacement zero. Measured, 13 of 15 episodes ended at exactly 60
      // steps with exactly -0.60 reward, the no-progress cutoff.
      //
      // The right move is giving up, not going around: up is not in the
      // action space, so this target is not for us. Blacklist it and look at
      // the next one.
      env.hedefiBirak()
      const yeni = env.enYakinKutuk()
      if (yeni) return hedefeYonel(bot, env, yeni.position, 'cevhere')
      if (env.onumuKapatan()) return { action: 3, sebep: 'tunel_aciyorum' }
      return { action: 0, sebep: 'tunelde_ilerliyorum' }
    }
    return hedefeYonel(bot, env, hedef.position, 'cevhere')
  }

  // 4) Dropped items a bit further out
  const esya = env.yakinEsya()
  if (esya) {
    return hedefeYonel(bot, env, esya.position, 'uzak_cevheri_aliyorum')
  }

  // 5) No ore in sight: dig a tunnel.
  //
  // The wood expert says 'wait' here, which would be fatal in a mine: the
  // agent waits 500 steps without seeing any reward and the whole imitation
  // dataset becomes "wait". Ore is behind stone; break what is in front and
  // move on.
  if (env.onumuKapatan()) {
    return { action: 3, sebep: 'tunel_aciyorum' }
  }
  return { action: 0, sebep: 'tunelde_ilerliyorum' }
}

function odunUzmani (bot, env) {
  // 1) Pick up dropped wood nearby first.
  //
  // This is deliberately the first rule. "Break a log in range" used to come
  // first, and in a dense forest breaking one log immediately puts another in
  // range, so collecting never got a turn: the bot kept breaking and walking
  // while wood piled up on the ground.
  //
  // The reward already said as much: collecting wood is 1.0, breaking a log
  // 0.2. Collecting is worth five times as much, so it goes first.
  const yakinEsya = env.yakinEsya(5)
  if (yakinEsya && env.esyaKovalama < ESYA_SABRI) {
    env.esyaKovalama++
    return hedefeYonel(bot, env, yakinEsya.position, 'yakin_odunu_aliyorum')
  }

  // 2) Break a breakable log in range
  if (env.onundekiKutuk()) {
    return { action: 3, sebep: 'onumde_kutuk_var' }
  }

  // 2b) Clear leaves and such blocking the way
  if (env.onumuKapatan()) {
    return { action: 3, sebep: 'yolumu_aciyorum' }
  }

  // 3) Dropped wood a bit further out
  const esya = env.yakinEsya()
  if (esya) {
    return hedefeYonel(bot, env, esya.position, 'uzak_odunu_aliyorum')
  }

  // 4) No tree, nothing to do
  const hedef = env.enYakinKutuk()
  if (!hedef) {
    return { action: 4, sebep: 'AGAC_BULAMIYORUM' }
  }

  return hedefeYonel(bot, env, hedef.position, 'agaca')
}

/**
 * Head for the target; if the front is blocked, turn to whichever side is open.
 *
 * The avoidance direction used to be picked at random. A random decision is by
 * definition not learnable from any observation: the network saw the same
 * input labelled "left" sometimes and "right" other times and learned the
 * average. That is what dropped validation accuracy from 88% to 52%.
 *
 * The direction now comes from what the agent also sees: is my left or my
 * right blocked.
 */
function hedefeYonel (bot, env, hedefPos, etiket) {
  // Avoidance mode: once we decide to go around, walk a few steps that way.
  //
  // Without it the expert fell into a two-step loop:
  //   align -> front blocked -> go around left (now turned, no longer aligned)
  //   -> turn back to target -> front blocked -> go around left -> ...
  //
  // The measurement was clear: 43% of steps were "turning to target", 31%
  // "going around an obstacle" and only 3% walking. The bot spun in place and
  // never collected a single resource in any episode.
  //
  // Deciding to go around means committing to actually move that way.
  if (env.kacinmaAdimi > 0) {
    env.kacinmaAdimi--
    if (!env.onumdeEngelVar()) {
      return { action: 0, sebep: etiket + '_kacinirken_yuruyorum' }
    }
  }

  const istenen = hedefYaw(bot.entity.position, hedefPos)
  const fark = aciFarki(istenen, bot.entity.yaw)
  const hizali = Math.abs(fark) <= YAW_TOLERANS

  // Aligned with a clear front: walk
  if (hizali && !env.onumdeEngelVar()) {
    return { action: 0, sebep: etiket + '_yuruyorum' }
  }

  if (hizali) {
    // Try breaking before going around.
    //
    // This check did not exist and breaking never got a turn: the expert's
    // priority list does have "break the block in my way", but the earlier
    // "pick up the nearby item" entry matched first and branched here. So the
    // bot saw wood behind a leaf block and tried to walk around it forever.
    //
    // Even more critical in the mine: the path to ore goes through stone by
    // definition. You cannot get there without breaking.
    if (env.onumuKapatan()) {
      return { action: 3, sebep: etiket + '_engeli_kiriyorum' }
    }

    // Can't break it (rock, a player's house, a protected area): go around.
    // Set the avoidance counter so we don't turn and immediately turn back.
    env.kacinmaAdimi = 3

    // Put the obstacle's name in the reason.
    //
    // This branch once ate a whole mine run: the expert broke nothing in 4
    // episodes because `tuff` and `calcite` counted as unbreakable. The reason
    // only said "engel_soldan_dolasiyorum", so finding the cause took two
    // rounds. It now shows up as "kiramadigim_tuff" in the `gorev_kontrol.py`
    // distribution.
    const engel = env.onumdekiEngel()
    const ad = engel ? `_kiramadigim_${engel.name}` : ''

    const sol = env.solumKapali()
    const sag = env.sagimKapali()
    if (sol && !sag) return { action: 1, sebep: etiket + ad + '_sagdan_dolasiyorum' }
    if (sag && !sol) return { action: 2, sebep: etiket + ad + '_soldan_dolasiyorum' }

    // Both sides the same: turn the way that is closer to the target (deterministic)
    return fark >= 0
      ? { action: 2, sebep: etiket + ad + '_soldan_dolasiyorum' }
      : { action: 1, sebep: etiket + ad + '_sagdan_dolasiyorum' }
  }

  // Not aligned: turn toward the target
  return fark > 0
    ? { action: 2, sebep: etiket + '_donuyorum_sola' }
    : { action: 1, sebep: etiket + '_donuyorum_saga' }
}

/**
 * Pick the expert for the current task.
 *
 * Whichever task the environment is running, that task's expert speaks. Both
 * experts share the same helpers (`hedefeYonel`, the angle math); the only
 * difference is the priority list.
 */
function uzmanAksiyonu (bot, env) {
  return env.gorev && env.gorev.ad === 'maden'
    ? madenUzmani(bot, env)
    : odunUzmani(bot, env)
}

module.exports = {
  uzmanAksiyonu, odunUzmani, madenUzmani, hedefeYonel, yonel, hedefYaw, aciFarki
}
