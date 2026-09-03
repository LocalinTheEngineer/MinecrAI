# Architecture — Design Notes

This document explains *why* the system is built the way it is. Read it before
the code. (Turkish version: [`mimari.md`](mimari.md))

---

## 1. The core problem

Reinforcement learning algorithms expect a very simple contract:

```
observe → choose an action → apply it → receive a reward and a new observation → repeat
```

Minecraft does not fit that contract at all:

- **It never pauses.** The world keeps running while the agent thinks. RL assumes
  discrete turns.
- **Actions take real time.** "Walk forward" is not instantaneous; it unfolds over
  seconds, and its outcome depends on terrain the agent cannot see in advance.
- **The observation is enormous.** A Minecraft world cannot be flattened into a
  vector without deciding what matters and throwing away the rest.

So the real work of this project is not writing a bot. It is **turning a live,
asynchronous game into something an RL algorithm can step through.** Every
architectural decision below follows from that.

---

## 2. Why two languages

|  | Node.js | Python |
|---|---|---|
| Minecraft client | **Mineflayer** — the only mature library for this | weak, largely unmaintained |
| RL ecosystem | essentially none | **Gymnasium, PyTorch, Stable-Baselines3** |

Forcing everything into one language means giving up the mature side of one of
these two ecosystems. Reimplementing the Minecraft protocol in Python, or an RL
stack in JavaScript, would be a much larger project than the one being attempted
here — and neither reimplementation would be the interesting part.

Instead, each side stays in its own language and they communicate over one
**narrow, explicitly documented contract**: JSON messages over a WebSocket,
specified in [`../bot/bridge/protocol.md`](../bot/bridge/protocol.md).

The contract is the point. Either side can be rewritten — swap PPO for DQN, swap
Mineflayer for a different client — and as long as the message shapes hold, the
other side does not change.

---

## 3. Layers

```
python/minecrai/env.py        ← the RL algorithm sees only this (gym.Env)
        │  reset() / step(action)
        ▼
python/minecrai/bridge.py     ← WebSocket client; speaks JSON, knows nothing about Minecraft
        │  {"cmd":"step","action":3}
        ▼  ~~~~~~~~ network boundary ~~~~~~~~
bot/bridge/server.js          ← WebSocket server; routes messages
        │
        ▼
bot/bridge/environment.js     ← the real logic: observation, reward, episode bookkeeping
        │
        ▼
bot/skills/*.js               ← reusable behaviours (chopTree, gel)
bot/utils/gorev.js            ← cooperative cancellation for long-running tasks
        │
        ▼
mineflayer                    ← Minecraft protocol
```

Each layer knows only the one directly beneath it. `env.py` has no concept of
Minecraft; `chopTree.js` has no concept of reinforcement learning. That
separation is what makes it possible to change the learning algorithm in
Milestone 4 without touching a single line of bot code.

---

## 4. Observation design — why a handful of numbers?

Rather than raw pixels or a full world map, the observation is a short vector of
**hand-picked scalars** — 16 for the wood task, 20 for mining, 21 in multi-task
mode.

This is a deliberate trade-off, not a shortcut. Pixel-based RL in Minecraft needs
days of GPU time; a compact, well-chosen feature vector lets the same algorithm
show measurable learning within minutes on a laptop. The cost is generality — the
agent cannot learn anything the feature vector does not expose. For the resource-
gathering tasks in scope, that is an acceptable price.

Contents (see `gozlem()` in `bot/bridge/environment.js`):

| Index | Feature | Answers |
|---|---|---|
| 0-2 | Unit vector toward nearest log | "Which way is the tree?" |
| 3 | Distance to that log, normalized | "How far?" |
| 4-5 | Bot yaw and pitch | "Where am I looking?" |
| 6 | Logs gathered **this episode** | "How much progress have I made?" |
| 7-8 | Health and hunger | "Am I still alive?" |
| 9 | Is the targeted block a log? | "Is mining here useful?" |
| 10 | On ground? | "Am I falling?" |
| 11 | Episode progress | Time pressure |
| 12-15 | Blocked ahead / left / right, jumpable step ahead | "Which way can I move?" |

All values are squeezed into `[-1, 1]`. Neural networks train poorly on inputs
with wildly different scales, so normalization is not optional.

**Four more for mining (16-19).** The egocentric bearing (sin, cos) and distance
of the nearest dropped item, and whether the block in front is one this bot can
*break*. Every one of these was added after a measurement, never from intuition —
see §9. Multi-task mode sends the same twenty for both tasks plus a task index.

**Three derived on the Python side.** The raw vector gives the target's direction
in world coordinates and the bot's yaw as separate numbers, so "is the target on
my left?" requires an `atan2` the network would have to learn. `zenginlestir()`
hands over the bearing in the bot's own frame (angle, sin, cos) instead. Nothing
new is measured — it is a change of frame, which is why it applies retroactively
to already-recorded demonstrations. Multi-task mode also expands the task index
into a one-hot. Totals the network sees: 19 wood, 23 mining, 25 multi-task.

---

## 5. Reward design (reward shaping)

This is the most consequential — and most commonly botched — part of an RL
project.

```
r = 1.00 · (logs gained)
  + 0.20 · (log broken)
  + 0.05 · (blocks closer to the nearest log)
  - 0.01 · (per-step time penalty)
```

**Why not simply "+1 when you collect wood"?**
A randomly acting agent will essentially never collect wood by chance. If the
reward never fires, there is no gradient to learn from — the classic *sparse
reward* problem. The task has to be decomposed into a sequence of achievable
sub-goals:

- approaching a tree pays a little → the agent first learns to navigate
- breaking a log pays more → then it learns to mine
- collecting the drop pays most → finally it learns the actual objective

**Why the time penalty?** Without it, doing nothing scores the same as trying.
A small negative per step makes idling strictly worse than acting.

**The trap — reward hacking.** If the proximity term were large, the optimal
policy would be to oscillate back and forth near a tree, farming approach reward
forever and never chopping anything. The coefficient is deliberately kept an
order of magnitude below the terminal reward to make that strategy unprofitable.
This is worth stating explicitly because it is the kind of failure that looks
like a broken algorithm when it is really a broken incentive.

---

## 6. Episode boundaries

- **terminated** — the task genuinely finished: 5 logs collected
- **truncated** — the clock ran out: 500 steps elapsed

Gymnasium insists on distinguishing these, and it matters: "succeeded" and "ran
out of time" imply different value estimates for the final state, and bootstrapping
them identically biases the learned value function.

---

## 7. Cancellation

Long-running skills (`chopTree` can take tens of seconds) run as async loops.
A naive `stop` command that only halts pathfinding leaves the loop spinning —
the bot keeps chopping after being told to stop.

`bot/utils/gorev.js` implements cooperative cancellation: every long task holds a
`GorevKontrol` handle and calls `kontrolEt()` at each iteration, which throws if a
stop has been requested. In-flight promises (`bot.dig`, `pathfinder.goto`) are
wrapped so they lose the race against a cancellation signal. Measured stop
latency in the automated test is ~0.1 s.

This also matters for RL: an environment that cannot reliably abort an episode
cannot be reset cleanly, and a bad reset silently corrupts training data.

---

## 8. Milestone 3 — imitation learning, and what it taught us

The scripted `chopTree` skill solves the task, but it calls the pathfinder
directly — it cannot be expressed in the agent's action space, so it cannot
serve as a demonstration. `bot/bridge/expert.js` reimplements the same
behaviour using **only the five actions the agent has**. Every step it answers
"what would the expert do here?", and those `(observation, action)` pairs form
a supervised dataset. At that point this is no longer RL — it is classification.

Three failures showed up, and each one is worth knowing:

**The expert is too good.** Because episodes start near a tree, over 80% of the
recorded actions were "break block" and "turn left" never appeared at all. The
network learned "always mine", which does nothing when no tree is in front. The
fix is twofold: randomise the starting yaw so the demonstrations contain turning
and walking, and inject action noise during collection — execute a random action
sometimes, but still label the state with what the expert *would* have done.
That produces exactly the recovery states the learner needs, and is the standard
answer to covariate shift in behaviour cloning.

**Episode-relative counting.** Termination originally compared total inventory
against the goal. Inventory does not reset between episodes, so after the first
successful episode every later one ended on step 1. Roughly 90% of the training
data silently vanished. Counts are now taken relative to the episode start.

**Target flicker.** `findBlock` does not reliably return the nearest match, and
re-selecting a target each step made the "direction to tree" observation jump
between two trees at similar distance. Neither the expert nor a learner can act
coherently on an input that flips every step, so the target is now locked for as
long as it exists.

None of these are exotic. They are the ordinary failure modes of turning a game
into an RL environment, and finding them is most of the work.

## 9. The expert must be realizable from the observation

Behaviour cloning learns a mapping from observation to action. If the expert's
action depends on information the observation does not contain, the network
cannot fit it — not because it is too small, but because the target is not a
function of the input.

We ran into this twice, and both times the number told us before the video did.

**The planner mistake.** The scripted expert was upgraded to call the A*
pathfinder and steer toward the next waypoint. Its demonstrations looked better
in the game — the bot stopped getting wedged against terrain. But validation
accuracy on the cloned policy fell from ~88% to 52%, and crucially *training*
loss plateaued at the same value as validation loss. That signature is not
overfitting; it is a target the network cannot represent. The agent's
observation contains "direction to the target tree", not "the plan routes left
around this hill", so identical observations carried contradictory labels.

The general rule: an expert may be smarter than the learner, but it must not act
on information the learner cannot perceive.

**The random-tiebreak mistake.** The same defect in miniature: when blocked, the
expert picked a turn direction at random. A random choice is by construction
unlearnable. Replacing it with "turn toward whichever side is open" makes the
decision a function of the observation — provided the observation reports which
side is open, which is why indices 13-15 exist.

The fix in both cases was the same shape: either remove the privileged
information from the expert, or add the missing perception to the observation.
We did both — the expert is reactive again, and the agent gained local obstacle
sensors.

**The dropped-item mistake (Milestone 5b).** The rule came back a third time, in
a shape we did not recognise until we measured it. After line-of-sight was
enforced on digging (§10), ore stopped being broken through walls, so drops began
landing at the bot's feet — and the expert started spending **39% of its steps**
walking to them. The observation said nothing about dropped items. Cloning
accuracy collapsed to 25.5%, where blind guessing among four actions is 25%.
Adding the item's egocentric bearing and distance was the fix.

Note what happened here: nobody changed the expert. Fixing an unrelated bug
shifted the *distribution of situations* the expert encountered, and a latent
observability gap became the dominant one. The rule is not a checklist item you
satisfy once.

**The task-identity requirement (Milestone 6).** In multi-task training the same
observation — *there is stone in front of me* — has one correct answer in the
wood task ("go around") and the opposite one in mining ("break it"). Measured on
real demonstrations: the wood expert breaks on 19% of steps, the mining expert on
32%. Without a task signal in the observation those labels land on identical
inputs and the network learns their average, which is neither. This is the same
rule again, with the hidden variable being *which task am I in* rather than
anything about the world.

## 10. Benchmarking inside a world that changes

Two measurement bugs cost more time than any code bug, and both produced
confident, wrong numbers.

**Contamination.** After ninety episodes of chopping, the test area was full of
dropped logs and empty of trees. A random policy wandering for 150 steps walks
over those piles and "collects" 4.6 wood — no skill involved. Meanwhile the
expert, which had scored 4.7 wood per episode during collection, scored 0,
because there was nothing left to chop. The policies had not changed; the world
had. Evaluating in a fresh area with `/kill @e[type=item]` first is now part of
the procedure.

**Ordering bias.** Running policies in blocks — all of A, then all of B — gives
the first one the freshest forest and the last one the stripped remains. The
evaluation now interleaves them round-robin so depletion falls on everyone
equally.

Neither of these is exotic. They are the environment-side analogue of a leaked
test set: the measurement apparatus quietly encoding information that has
nothing to do with what you meant to measure.

**A third, smaller one:** the cloned policy was evaluated with `argmax`, which is
deterministic. When it entered a state whose best action did not change the
state, it repeated that action until the episode timed out — three of five
episodes ended at exactly the stagnation cutoff. Sampling from the policy's
distribution breaks the loop, and is what PPO does during training anyway.

**A fourth, and the most expensive: contradictory training data.** The raw
observation kept for demo recording was written on `reset()` but not on `step()`,
so it stayed frozen at its episode-start value. Every sample within an episode
carried the *same* observation and a *different* action. The file looked normal;
the failure surfaced hours later as "the network will not learn". Opening it and
counting rows was decisive: **4,498 samples, 30 unique observations** — exactly
the episode count. The ceiling for such data is the majority class (33.2%);
cloning scored 30.7% and the loss sat at precisely `ln 4 = 1.386`, i.e. the
network had learned to emit a uniform distribution over the four used actions and
nothing else.

Two collection runs were wasted before this was found, and the first diagnosis
was wrong — a plausible but unverified hypothesis about missing features. The
lesson is worth stating plainly because it is cheap and was skipped anyway:
**when a network will not learn, look at the data before forming a hypothesis.**
`collect_demos.py` now prints the unique-observation ratio after every run.

**A fifth, caught before it cost anything.** Evaluation runs policies round-robin
while the multi-task environment advances its task on every reset. With five
policies — an odd number — each policy alternates tasks across rounds and the
split comes out even. That is luck, not design: with an even number of policies
(one missing model file away) every policy would have been locked to a single
task, random always chopping wood while PPO always mined, with no visible
symptom. The round now names its task and every policy in it plays that task.

The pattern across all five: the measurement apparatus quietly encoding something
that has nothing to do with what you meant to measure. Code bugs announce
themselves. Measurement bugs return confident numbers.

## 11. One environment, several tasks

Mining was added as a second RL task without touching the environment. That was
the point of the exercise: if a second task needs a second environment, the first
one was overfitted to its task.

The parts that stay fixed are the ones a learning algorithm sees — the five
actions, the reward shape, the episode logic, the training scripts, the
evaluation harness. What differs between tasks is a small set of *questions*,
answered in one file (`bot/bridge/gorevler.js`):

| question | wood | mining |
|---|---|---|
| what is a target? | a log | an ore |
| is this target legitimate? | not part of a player's build | **is my pickaxe good enough for it?** |
| how do I count progress? | logs held | ores and ingots held |
| what may I break to clear a path? | leaves and plants | stone too — we carry a pickaxe |
| how do I rank candidate targets? | straight-line distance | vertical difference costs 3× |
| how far do I look? | 64 blocks | **16 blocks** |
| walk me near a target at episode start? | yes | **no** |

Two of these rows are worth their own paragraph, because both were mistakes
first.

**Search radius.** `findBlocks` sees through walls. At y=15 there is always an ore
within 64 blocks — typically forty blocks behind solid stone. The environment
therefore never believed the area was exhausted, never relocated the bot, and
every episode was spent tunnelling toward something unreachable: episode 1
collected 5 ore, episodes 2-18 collected none. Sixteen blocks is roughly what an
agent can tunnel through in one episode, and with it the environment's invariant
comes back — *at episode start there is a reachable target*.

**Walk me near a target.** In the forest this is harmless setup: walking across
open ground is not the task. Underground it *is* the task, and the pathfinder
digs. The environment would have tunnelled to the ore on the agent's behalf and
then handed it the reward. Same reason the action space has no "pathfind to the
tree" action — this was the same shortcut sneaking in through the setup code.

Per-task file paths (`python/minecrai/yollar.py`) keep each task's data and models
apart. Without that, one task would eventually overwrite the other's model and the
symptom — a silently wrong model loading — would take hours to trace.

## 12. One agent, several tasks

The natural next question: can a single network do both, told only which task it
is in? Everything above is shared, so the additions are small.

**A shared observation width.** Wood sends 16 numbers, mining 20. One network
needs one input size, so multi-task mode requests the wide observation for both.
Wood keeps its narrow default outside multi-task mode, so the earlier trained
models still load — a change that breaks published results to make a new task
convenient is a bad trade.

**Task identity in the observation.** Covered in §9: without it, contradictory
labels land on identical inputs.

**Strict alternation, not random sampling.** Over a short run, random task
selection produces lopsided splits — 19/11 in thirty episodes is unremarkable —
which quietly biases any per-task comparison.

One thing measurement revealed that design did not anticipate: **the two tasks
want the bot in physically different places.** Wood happens on the surface, mining
at y=15, and the environment descends at most twelve steps per reset. Alternating
tasks means every mining episode begins by climbing back down. Measured: mining
episodes averaged 131 steps in multi-task collection against roughly 87 standalone,
and 8 of 20 finished empty. That is a real cost of multi-task learning in an
embodied setting, and it is not visible from the algorithm side at all.

## 13. What comes next

Nothing is committed. Directions that would build on what exists rather than
restart:

- **Speedrun framing.** The reward currently caps out when the episode terminates
  at five resources, so improvement can only show up as *speed* — which is exactly
  what Milestone 4 measured (reward flat, episode length −19%). Making time the
  objective rather than a side effect would fix a measurement problem we already
  hit. It also mostly exists: `uret <item>` already resolves a recipe tree at
  runtime; adding a clock and a fixed seed gives a reproducible benchmark.
- **Hierarchical control.** The agent currently learns walking and turning. An
  agent whose actions are the existing *skills* would learn ordering instead —
  "more wood now, or go mine?" — reusing every part of the current system.
- **Lower measurement variance.** Lapis and redstone drop 4-9 items per block, so
  a single lucky block can end an episode. It applies to every policy equally and
  so does not bias comparisons, but it inflates variance — and variance is what
  has repeatedly prevented us from separating two policies.

**Why this order, throughout?** Each stage produces something presentable on its
own. If the project stalls at any point, there is still a finished, demonstrable
artifact.
