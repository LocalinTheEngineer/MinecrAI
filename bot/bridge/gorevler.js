'use strict'

const { kutukMu, oduncuSay, dogalAgacMi, govdeninDibi } = require('../skills/chopTree')

/**
 * Task definitions.
 *
 * The environment keeps everything a learning algorithm sees — observation,
 * actions, reward shape, episode logic. What differs per task lives here:
 * what counts as a target, whether it is collectable, how to count progress,
 * and how far to look. Two tasks, one environment, one PPO script.
 */

const CEVHER = /_ore$/

// Blocks the wood agent may break to clear a path. Stone and dirt are
// excluded on purpose: mining stone by hand takes minutes and has nothing
// to do with the task.
const YUMUSAK = /_leaves$|vine|_sapling$|bamboo|cobweb|azalea|moss_|snow|sugar_cane|cactus|_mushroom_block$|shroomlight|_wart_block$/

// Required pickaxe tier per ore. `uygunAlet` answers "do I hold a pickaxe",
// not "is it good enough" — hitting diamond with a stone pickaxe destroys
// the ore: the block breaks and nothing drops.
//
// With this table the agent is never sent at an ore its pickaxe cannot handle.
const KAZMA_SEVIYELERI = ['wooden', 'stone', 'iron', 'diamond', 'netherite']

const CEVHER_GEREKSINIMI = [
  { desen: /coal_ore$/, seviye: 'wooden' },
  { desen: /(copper|iron|lapis)_ore$/, seviye: 'stone' },
  { desen: /(gold|redstone|diamond|emerald)_ore$/, seviye: 'iron' }
]

/** Pickaxe tier this ore needs (falls back to the safest one when unknown) */
function gerekenSeviye (ad) {
  for (const { desen, seviye } of CEVHER_GEREKSINIMI) {
    if (desen.test(ad)) return seviye
  }
  return 'iron'
}

/** Tier of the best pickaxe in the inventory and its remaining hits */
function kazmaDurumu (bot) {
  let enIyi = -1
  let kalan = 0
  for (const esya of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(esya.name)
    if (!m) continue
    const tur = m[1] === 'golden' ? 'stone' : m[1]
    const i = KAZMA_SEVIYELERI.indexOf(tur)
    if (i < 0) continue
    const vurus = esya.maxDurability
      ? esya.maxDurability - (esya.durabilityUsed || 0)
      : Infinity
    if (i > enIyi) { enIyi = i; kalan = vurus } else if (i === enIyi) kalan += vurus
  }
  return { seviye: enIyi, kalan }
}

// Blocks never dug in the mine, under any condition
const MADEN_TEHLIKE = /lava|water|bedrock|_spawner$|chest|obsidian/
const DEEPSLATE_HARIC = /^(coal|iron|copper|gold|redstone|emerald|lapis|diamond)_ore$|^deepslate_(coal|iron|copper|gold|redstone|emerald|lapis|diamond)_ore$/

/** Ore and ingot count in the inventory (broken ore drops ingots or raw chunks) */
function cevherSay (bot) {
  return bot.inventory.items()
    .filter((i) => /^raw_|^coal$|^diamond$|^emerald$|^redstone$|^lapis_lazuli$|_ore$/.test(i.name))
    .reduce((toplam, i) => toplam + i.count, 0)
}

/**
 * Extra observation, 4 numbers, same for every task.
 *
 * Started out mine-only, and the measurement came from there: without it BC
 * accuracy was 25.5% against a 25% blind baseline over four actions. The
 * expert spends 39% of its steps picking up dropped ore and the observation
 * said nothing about dropped items, so the same observation carried "turn
 * left" one time and "turn right" the next: unlearnable data.
 *
 * The wood task has the same problem; the expert chases dropped logs there
 * too. In Milestone 6 (one agent, several tasks) both tasks share a network,
 * so the observation has to be shared as well; hence one shared function.
 *
 * All of it is egocentric, so Python needs no extra transform:
 *   sin(angle) : item on my right or my left
 *   cos(angle) : 1 = straight ahead, -1 = straight behind
 *   distance   : 0..1 (1 when there is no item)
 *   breakable obstacle: can I break the block in front of me
 *
 * The last number closes a separate gap: the expert picks between breaking
 * and going around by calling `onumuKapatan()`, but the observation only had
 * "is my front blocked", not "is it breakable".
 *
 * With no item, sin=0 and cos=0 are both sent; at a real angle the two cannot
 * be zero at once, so "no item" stays distinguishable.
 */
const EK_GOZLEM = (env) => {
  const bot = env.bot
  const esya = env.yakinEsya()

  let sin = 0
  let cos = 0
  let mesafe = 1
  if (esya) {
    const fark = esya.position.minus(bot.entity.position)
    const uzaklik = Math.max(Math.hypot(fark.x, fark.z), 0.001)
    const esyaYaw = Math.atan2(-fark.x, -fark.z)
    let aci = esyaYaw - bot.entity.yaw
    aci = ((aci + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
    sin = Math.sin(aci)
    cos = Math.cos(aci)
    mesafe = Math.min(uzaklik / 8, 1)
  }

  return [sin, cos, mesafe, env.onumuKapatan() ? 1 : 0]
}

// How many numbers this adds, in one place: the tests and env.py read it
EK_GOZLEM.uzunluk = 4

const GOREVLER = {
  /** Default task: collect wood in a forest. Milestones 1-4 were built on it. */
  odun: {
    ad: 'odun',
    hedefAdet: 5,
    temizlemeEtiketi: '#minecraft:logs',
    yuzeyGorevi: true,

    hedefMi: (blok) => kutukMu(blok),
    dogalMi: (bot, blok) => dogalAgacMi(bot, blok),
    say: (bot) => oduncuSay(bot),

    // Target the trunk base, not the log we found — cutting top-down is
    // slower and sends the agent climbing.
    hedefiDuzelt: (bot, blok) => govdeninDibi(bot, blok),

    // Only soft plant blocks may be cleared here.
    engelKirilabilirMi: (bot, blok) => !!blok && YUMUSAK.test(blok.name),

    // Straight-line distance is the right measure in open terrain.
    hedefMaliyeti: (bot, konum) => konum.distanceTo(bot.entity.position),

    // Walking the agent near a target at episode start is fair here:
    // crossing open ground is not the task.
    baslangictaYurut: true,

    // 64 blocks is walkable within one episode in open terrain.
    aramaYaricapi: 64,

    ekGozlem: EK_GOZLEM,

    // Narrow (16) by default: the Milestone 4 models expect 19 inputs and
    // would stop loading if this grew. Multi-task training turns it on via
    // `genisGozlem` because one network needs one input size.
    gozlemProfili: 'dar'
  },

  /** Milestone 5: collect ore underground. */
  maden: {
    ad: 'maden',
    hedefAdet: 5,
    // Wipe the whole inventory. Ores have no single tag like
    // `#minecraft:logs`, so skipping the clear let the inventory fill up
    // across episodes. Measured: with 36 slots full, `/give iron_pickaxe`
    // succeeds server-side ("Gave 1 [Iron Pickaxe]") but the item never
    // arrives. A pickaxe-less bot destroys ore instead of collecting it, and
    // the episodes are wasted. The wood task hit the same bug.
    //
    // '*' = wipe everything. The pickaxe is handed out during episode setup
    // anyway, so every episode starts from the same clean state, which is
    // what RL wants.
    temizlemeEtiketi: '*',
    yuzeyGorevi: false,

    // Episodes start at this depth. Iron is dense around y=15; diamond
    // (y=-58) is richer but sits near bedrock with a lot of lava, which is
    // pointless death risk during training.
    baslangicY: 15,

    // Pickaxe handed to the agent at the start of an episode.
    //
    // Breaking ore with the wrong pickaxe destroys it. What the agent has to
    // learn is "find ore and break it"; getting tools is a separate problem
    // and the hand-written `kaz.js` already solves it. The agent does not
    // craft the axe in the tree task either.
    aletVer: 'iron_pickaxe',

    hedefMi: (blok) => !!blok && CEVHER.test(blok.name) && DEEPSLATE_HARIC.test(blok.name),

    // "Is this player-built" does not apply to ore, nobody builds ore. But
    // breaking it with the wrong pickaxe destroys it, so the real question is
    // "can I break it": is the pickaxe I hold good enough?
    dogalMi: (bot, blok) => {
      if (!blok) return false
      // Is my pickaxe good enough for this ore? "Do I have a pickaxe" is not
      // enough: hitting diamond with a stone pickaxe destroys the diamond.
      const { seviye, kalan } = kazmaDurumu(bot)
      if (kalan <= 0) return false
      return seviye >= KAZMA_SEVIYELERI.indexOf(gerekenSeviye(blok.name))
    },

    say: (bot) => cevherSay(bot),
    hedefiDuzelt: (bot, blok) => blok, // the vein itself, nothing to adjust

    // In the mine, breaking stone is the task.
    //
    // The wood task forbids breaking stone because mining stone there is
    // wasted time. The mine is the opposite: the only way to reach ore is
    // through stone and the agent holds a pickaxe. Two tasks answer the same
    // question differently, which is why the decision lives here and not in
    // the environment.
    engelKirilabilirMi: (bot, blok) => {
      if (!blok || blok.boundingBox !== 'block') return false
      if (MADEN_TEHLIKE.test(blok.name)) return false
      const { uygunAlet } = require('../skills/alet')
      if (uygunAlet(bot, blok)) return true
      // Shovel blocks (dirt, gravel, sand, clay, mud) break fast by hand too,
      // so not carrying a shovel is no reason to let them block the way.
      // Stone is different: mining stone by hand takes minutes.
      return /^mineable\/shovel$/.test(blok.material || '') ||
        /dirt|gravel|sand/.test(blok.name)
    },

    /**
     * Vertical distance costs more than horizontal.
     *
     * Straight-line distance is the wrong measure in a mine. The agent's
     * actions are horizontal: walk forward, turn right, turn left. Going up
     * needs pillaring or breaking the ceiling and jumping, and neither is in
     * the action space.
     *
     * Result: an ore 8 blocks straight up counted as "closer" than one 12
     * blocks away at the end of an open tunnel, and the bot locked onto a
     * target it could not reach.
     *
     * Vertical difference is tripled: 8 blocks up is 24 units, 12 blocks
     * ahead is 12. The reachable one wins now.
     */
    hedefMaliyeti: (bot, konum) => {
      const p = bot.entity.position
      const yatay = Math.hypot(konum.x + 0.5 - p.x, konum.z + 0.5 - p.z)
      const dikey = Math.abs(konum.y - p.y)
      return yatay + dikey * 3
    },

    /**
     * No walking the agent in at episode start in the mine.
     *
     * `baslangicaTasi()` approaches the target with pathfinder, and
     * pathfinder runs with `canDig: true`, so it tunnels through stone.
     *
     * In a forest that is harmless: walking across open ground is not the
     * task. In a mine it is exactly the task. The environment digs the tunnel
     * on the agent's behalf and drops it next to the ore; the agent collects
     * reward without learning anything and the learning curve means nothing.
     *
     * Same reason "walk to the tree with pathfinder" was removed from the
     * action space, only here it came in through the back door.
     */
    baslangictaYurut: false,

    /**
     * The search radius has to be small in the mine.
     *
     * This is why PPO training collapsed after episode 2: episode 1 collected
     * 5 ores, episodes 2-18 all scored zero.
     *
     * `findBlocks` sees through walls. Underground at y=15 there is always
     * some ore within 64 blocks, 40 blocks deep in stone. After the agent
     * finished the local vein the environment still reported "a target
     * exists", so `tazeMadeneIsinla()` never ran and the agent spent every
     * episode tunnelling toward ore it could not reach. Episodes ended at
     * exactly 60 steps, the no-progress cutoff.
     *
     * The forest does not have this problem: 64 blocks there is open ground
     * the agent can walk. In a mine, one block of progress means turn, break
     * and walk; realistic range in an episode is ~15 blocks.
     *
     * At 16 the environment's invariant holds again: at the start of an
     * episode there is a reachable target.
     */
    aramaYaricapi: 16,

    /**
     * Drop a vertical target quickly.
     *
     * Going up is not in the action space. An ore straight overhead that is
     * out of reach is unreachable, full stop.
     *
     * This logic used to live only in `expert.js`. Once PPO took the wheel
     * nobody called it and the agent spent whole episodes locked onto an
     * unreachable target. Same lesson again: the expert cannot rely on
     * environment state the student cannot affect, so this decision belongs
     * to the environment, not the expert.
     */
    dikeyBirakma: true,

    /**
     * Mine-specific extra observation: show the agent what the expert sees.
     *
     * Measured BC accuracy was 25.5%. With four actions blind guessing is
     * 25% and "always break" would hit 33%, so the network learned nothing.
     * BC and pretrain both pointed at the same place, so it was not a data
     * split bug: the data really was unlearnable.
     *
     * Cause: the expert spends 39% of its steps picking up dropped ore
     * (`yakin_cevheri_aliyorum_*`), and the observation said nothing about
     * dropped items. The same observation was labelled "turn right" one time
     * and "turn left" the next, and what separated the two was never shown
     * to the agent.
     *
     * Third time the same rule shows up in this project: the expert cannot
     * rely on information the student cannot see.
     *
     * Why it surfaced now: before the line-of-sight fix the bot broke ore
     * through walls, the drops landed somewhere unreachable and this branch
     * almost never ran. Once the bot was fixed the branch started running and
     * the gap in the observation showed.
     *
     * Why only in the mine: the wood task was measured with 16 numbers in
     * Milestone 4 and its models are saved. Growing the observation there
     * would make those models unloadable.
     *
     * Four numbers, all egocentric, so Python needs no extra transform:
     *   sin(angle) : item on my right or my left
     *   cos(angle) : 1 = straight ahead, -1 = straight behind
     *   distance   : 0..1 (1 when there is no item)
     *   breakable obstacle: can I break the block in front of me
     *
     * The last number closes a separate gap: the expert picks between
     * breaking and going around by calling `onumuKapatan()`, but the
     * observation only had "is my front blocked", not "is it breakable".
     *
     * With no item, sin=0 and cos=0 are both sent; at a real angle the two
     * cannot be zero at once, so "no item" stays distinguishable.
     */
    ekGozlem: EK_GOZLEM,

    // On by default in the mine: this task's measured results (Milestone 5b)
    // were taken with the 20-number observation.
    gozlemProfili: 'genis'
  }
}

function gorevGetir (ad) {
  return GOREVLER[ad] || GOREVLER.odun
}

module.exports = {
  GOREVLER, gorevGetir, cevherSay, kazmaDurumu, gerekenSeviye, KAZMA_SEVIYELERI,
  EK_GOZLEM
}
