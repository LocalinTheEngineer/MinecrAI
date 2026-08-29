<div align="center">

# MinecrAI

**A Minecraft agent that learns to gather resources with reinforcement learning.**

Mineflayer (Node.js) drives the game. A WebSocket bridge exposes it to Python as a
standard Gymnasium environment, so any RL algorithm can train against real Minecraft.

[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://python.org)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-1.0-0081A5)](https://gymnasium.farama.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

</div>

---

## Why this project

Most "Minecraft bot" projects are long chains of `if/else`. This one is not.
The goal is a real learning loop: an explicit environment definition, a shaped
reward function, a training loop, and a learning curve you can point at.

The hard part is not the bot — it is turning a live, asynchronous game into
something an RL algorithm can actually step through. That bridge is the core
contribution here.

## Architecture

```
┌──────────────────┐   WebSocket    ┌─────────────────────┐   protocol   ┌───────────────┐
│  Python          │   JSON msgs    │  Node.js            │   packets    │  Minecraft    │
│                  │ ─────────────► │                     │ ───────────► │  Java server  │
│  Gymnasium Env   │                │  Mineflayer bot     │              │  (1.20.4)     │
│  PPO / SB3       │ ◄───────────── │  + pathfinder       │ ◄─────────── │               │
│                  │  obs, reward   │  + skills           │  world state │               │
└──────────────────┘                └─────────────────────┘              └───────────────┘
        │                                     │
        │                                     └── bot/bridge/environment.js
        │                                         observation, reward, episode logic
        │
        └── python/minecrai/env.py
            gym.Env: reset() / step(action) / observation_space / action_space
```

Design rationale — why a bridge, how the observation and reward were chosen, and
the reward-hacking trap that shaped the coefficients — is written up in
**[docs/architecture.md](docs/architecture.md)**.

**Why a bridge instead of doing everything in one language?**
Mineflayer is the only mature Minecraft client library, and it is Node.js.
The RL ecosystem (Gymnasium, Stable-Baselines3, PyTorch) is Python. Rather than
reimplementing either side, the bridge keeps each in its own language and defines
one narrow contract between them — documented in [`bot/bridge/protocol.md`](bot/bridge/protocol.md).

### Action space — `Discrete(5)`

| # | Action |
|---|--------|
| 0 | Walk forward (0.5 s) |
| 1 | Turn right (22.5°) |
| 2 | Turn left (22.5°) |
| 3 | Break the block in front — the log if there is one, otherwise whatever blocks the way (leaves) |
| 4 | No-op |

An earlier version had a "pathfind to the nearest tree" action. It was removed:
it performed the entire navigation in one step, so an agent that discovered it
would never learn to navigate. Removing it is what makes the learning curve
mean something.

### Observation space — `Box(19,)`

Relative direction and distance to the target log, yaw/pitch, wood gathered this
episode, health, hunger, whether a log is in front, ground contact, episode
progress, and four local obstacle sensors: blocked ahead / left / right, and
whether a jumpable step is in front.

Node sends 16 raw numbers; the Python side derives three more — the target's
bearing **in the bot's own frame** (angle, sin, cos) — before the network sees
them. The raw vector gives direction in world coordinates and yaw separately, so
"is the target on my left" requires an `atan2` the network would have to learn.
Handing it over directly makes the turn decision readable from one number's sign.
Nothing new is measured; it is a change of frame, which is why it applies
retroactively to already-recorded demonstrations.

The obstacle sensors and this reframing both exist so the expert's decisions are
**realizable from the observation**. See `docs/architecture.md` — measured, not
assumed.

### Reward

```
r = 1.00 · (wood gained)
  + 0.20 · (log broken)
  + 0.05 · (blocks closer to nearest log)
  - 0.01 · (time penalty per step)
```

Episode terminates at 5 logs collected, truncates at 500 steps.

## Results

### Training (Milestone 4)

PPO, warm-started from the cloned policy, ran for **20,234 steps / 150 episodes**
(~59 min of live Minecraft) against the real server.

| | start | end | change |
|---|---|---|---|
| Mean reward | +4.46 | +4.61 | +0.15 |
| Episode length | 152 steps | 123 steps | **−19%** |

Reward is close to flat, and that is expected rather than disappointing: the episode
**terminates at 5 logs**, so reward is capped by construction. Once a policy reliably
reaches the cap, the only place improvement can still show up is *how fast* it gets
there — and that is exactly the column that moved. A learning curve that reports only
reward would have shown nothing here.

![learning curve](docs/images/ogrenme_egrisi.png)

### Evaluation

Four policies, **20 episodes each**, round-robin ordering (policy 1, 2, 3, 4, 1, 2, …)
so a forest that thins out over the session penalises everyone equally rather than
whoever ran last. `±` is the standard error of the mean.

| policy | reward | wood | steps |
|---|---|---|---|
| **ppo** | **+4.07 ± 0.77** | **3.5** | 91 |
| bc | +2.84 ± 0.67 | 2.6 | 98 |
| random | +1.14 ± 0.74 | 2.4 | 129 |
| scripted expert | +0.55 ± 0.55 | 1.1 | 88 |

Per-episode variance is large (sd ≈ 3.3), so the honest reading is pairwise rather
than a leaderboard. Taking "difference greater than the sum of the two standard
errors" as the bar:

- **ppo > random** — 2.93 vs 1.51. Significant. This is the headline: the trained
  agent beats the random baseline.
- **ppo > scripted expert** — 3.52 vs 1.32. Significant.
- **bc > random** — 1.70 vs 1.41. Significant, narrowly.
- **ppo > bc** — 1.23 vs 1.44. **Not significant.** PPO leads on all three columns
  (reward, wood, steps), which is suggestive, but 20 episodes cannot separate it from
  behaviour cloning. Claiming otherwise would be reading noise.

`eval_agent.py` prints all pairs and estimates how many episodes the top pair would
actually need, instead of comparing only the top two and calling it a ranking.

### Why the scripted expert scores last

It is deterministic. When it faces a situation its priority list handles badly —
a log wedged behind leaves, a two-block ledge — it makes the same wrong decision
every step until the stagnation cutoff fires. The learned policies sample their
actions, so they jitter out of the same trap within a few steps. The expert is still
good enough to be worth imitating (it produced the demonstrations both learned
policies came from); it just has no escape hatch.

The same effect appeared inside behaviour cloning: evaluating the cloned policy with
`argmax` froze it in 3 of 5 episodes, and switching to sampling raised it from 1.6 to
5.0 logs per episode without retraining anything.

## Roadmap

| Milestone | What | Status |
|---|---|---|
| **1** | Rule-based bot: connect, pathfind, chop trees, collect drops, cancellable tasks | ✅ Done |
| **2** | Node↔Python bridge + Gymnasium environment + random-agent baseline | ✅ Done |
| **3** | Behaviour cloning from scripted demonstrations | ✅ Done |
| **4** | PPO training warm-started from the cloned policy, learning curve | ✅ Done |
| **5** | Extended task set: mining, simple crafting | ⬜ Planned |

Each milestone stands on its own — the repo is presentable at any point.

## Quick start

**Requirements:** Node.js 18+, Python 3.10+, Java 21 (for the Minecraft server).

### 1. A local Minecraft server

The bot joins a server as an ordinary player, so you need one running. Download the
[1.20.4 vanilla server jar](https://mcversions.net/download/1.20.4) into its own
folder, then:

```bash
java -Xmx2G -jar server.jar nogui     # fails once and writes eula.txt
```

Set `eula=true` in `eula.txt`, then in `server.properties`:

```properties
online-mode=false        # let the bot join without a Mojang account
difficulty=peaceful      # no mobs interrupting training
spawn-protection=0       # the bot may break blocks near spawn
```

Start it again and leave it running. Launch your own client on **1.20.4** and
connect to `localhost` if you want to watch.

### 2. Install and run

```bash
npm install
python -m venv .venv && .venv/Scripts/activate     # Windows; use bin/activate on Linux/macOS
pip install -r python/requirements.txt

cp .env.example .env        # edit if your server is not on localhost:25565

npm run bot                 # Milestone 1
```

Then type in the in-game chat:

| Command | Effect |
|---|---|
| `gel` | Walk to the player who typed it |
| `kes` | Find the nearest tree, chop it, pick up the drops |
| `kes 3` | Chop 3 trees (1-64) |
| `kes surekli` | Keep chopping until told to stop |
| `envanter` / `nerede` | Report inventory / coordinates |
| `takip` | Follow the player until told to stop |
| `ver odun 10` | Toss items from the bot's inventory |
| `koru` | Mark a no-dig zone around you — the bot never breaks blocks there |
| `komut` | List every command |
| `dur` | Abort the current task immediately |

### 3. The RL loop (Milestone 2)

```bash
npm run bridge                        # terminal A
cd python && python random_agent.py   # terminal B
```

Rewards will be negative — this baseline acts randomly and does not learn.

### 4. Learning from demonstrations (Milestone 3)

```bash
npm run bridge                        # terminal A
# terminal B:
cd python
python collect_demos.py --bolum 40    # record the scripted expert
python train_bc.py --epoch 60         # train a policy to imitate it
python eval_agent.py --bolum 10       # random vs learned vs expert
```

`train_bc.py` writes a loss/accuracy plot and `eval_agent.py` writes the
random-vs-learned-vs-expert comparison to `models/`.

### 5. Reinforcement learning (Milestone 4)

```bash
cd python
python pretrain_ppo.py --epoch 80              # hand the cloned policy to PPO (offline)
# terminal A: npm run bridge
python train_ppo.py --baslangic ../models/ppo_pretrained.zip --adim 20000
python plot_ogrenme.py                         # learning curve, safe to run mid-training
```

**On wall-clock cost.** A step in live Minecraft takes roughly 0.4 s, so 20k steps
is about two hours. Training is therefore built to be interrupted: every episode is
appended to `models/ppo_gecmis.csv`, a checkpoint is written every 1000 steps, and
`Ctrl+C` exits cleanly. `--devam` resumes from the last checkpoint, and
`plot_ogrenme.py` will draw the curve from a partial run.

**Why warm-start rather than train from scratch?** A fresh PPO policy acts randomly,
and at 0.4 s per step it would take many hours before the first useful behaviour
appears. `pretrain_ppo.py` trains Stable-Baselines3's own policy object with a
supervised loss on the demonstration data, so PPO starts from a policy that already
solves the task and spends its budget improving rather than discovering.

> Türkçe okuyanlar için mimari notları: [`docs/mimari.md`](docs/mimari.md)

## Repository layout

```
bot/                  Node.js — everything that touches Minecraft
  index.js              Milestone 1 entry point (chat-controlled bot)
  config.js             all settings, read from .env
  skills/               reusable behaviours (chopTree, gel, alet, takip, ver)
  utils/gorev.js        cooperative cancellation + safe pathfinder stop
  utils/koruma.js       player-marked no-dig zones
  bridge/
    server.js           WebSocket server exposing reset/step to Python
    environment.js      observation, reward and episode logic
    expert.js           scripted expert expressed in the agent's action space
    protocol.md         the Node↔Python contract
python/
  minecrai/
    bridge.py           WebSocket client
    env.py              gymnasium.Env implementation
  random_agent.py       baseline: random actions, proves the loop works
  collect_demos.py      Milestone 3: record the scripted expert
  train_bc.py           Milestone 3: behaviour cloning + training plots
  eval_agent.py         Milestone 3: random vs learned vs expert comparison
  minecrai/policy.py    the imitation network (PyTorch MLP)
  pretrain_ppo.py       Milestone 4: warm-start SB3's policy from demonstrations
  train_ppo.py          Milestone 4: PPO with checkpointing and CSV logging
  plot_ogrenme.py       Milestone 4: the learning curve
  requirements.txt
docs/
  architecture.md       design rationale — read this first
  mimari.md             same notes in Turkish
test/
  smoke.js              fast runtime test with a fake bot — no Minecraft needed
  e2e.js                automated test against a local flying-squid server
```

## Tests

`test/e2e.js` spins up an in-process Minecraft server (`flying-squid`), builds a
flat platform, plants trees and asserts two things — that the bot finds and chops
a tree, and that a `dur` (stop) request actually aborts an in-progress chop.
No manual Minecraft client needed.

```bash
node test/e2e.js
```

`test/smoke.js` is the fast one (~1 s, no server at all): it drives the environment,
the expert and the skills against a fake bot object. It exists because of a real bug —
a careless search-and-replace produced `this.pathfinderDurdur(bot)`, which is valid
syntax and passes every `require()` check, then throws `bot is not defined` only once
that line actually runs, mid-episode. Import checks cannot catch that class of bug;
executing the code can.

```bash
node test/smoke.js
```

## License

MIT — see [LICENSE](LICENSE).
