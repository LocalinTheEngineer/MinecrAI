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

## 4. Observation design — why only 12 numbers?

Rather than raw pixels or a full world map, the observation is **12 hand-picked
scalars**.

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

All values are squeezed into `[-1, 1]`. Neural networks train poorly on inputs
with wildly different scales, so normalization is not optional.

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

## 11. What comes next

**Milestone 4 — PPO.**
Use the imitation-trained network as the initial policy and continue with PPO via
Stable-Baselines3. The learning curve (x: environment steps, y: episode return)
and a before/after comparison become the headline result in the README.

**Why this order?** Each stage produces something presentable on its own. If the
project stalls at any point, there is still a finished, demonstrable artifact.
