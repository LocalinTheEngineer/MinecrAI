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

### Observation space — `Box(13,)`

Relative direction and distance to the target log, yaw/pitch, wood gathered this
episode, health, hunger, whether a log is in front, ground contact, episode
progress, and whether a breakable block is blocking the way.

### Reward

```
r = 1.00 · (wood gained)
  + 0.20 · (log broken)
  + 0.05 · (blocks closer to nearest log)
  - 0.01 · (time penalty per step)
```

Episode terminates at 5 logs collected, truncates at 500 steps.

## Roadmap

| Milestone | What | Status |
|---|---|---|
| **1** | Rule-based bot: connect, pathfind, chop trees, collect drops, cancellable tasks | ✅ Done |
| **2** | Node↔Python bridge + Gymnasium environment + random-agent baseline | ✅ Done |
| **3** | Behaviour cloning from scripted demonstrations | ✅ Done |
| **4** | PPO training, learning curve, before/after comparison | ⬜ Planned |
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

> Türkçe okuyanlar için mimari notları: [`docs/mimari.md`](docs/mimari.md)

## Repository layout

```
bot/                  Node.js — everything that touches Minecraft
  index.js              Milestone 1 entry point (chat-controlled bot)
  config.js             all settings, read from .env
  skills/               reusable behaviours (chopTree, gel)
  utils/gorev.js        cooperative cancellation for long-running tasks
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
  requirements.txt
docs/
  architecture.md       design rationale — read this first
  mimari.md             same notes in Turkish
test/
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

## License

MIT — see [LICENSE](LICENSE).
