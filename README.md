# MinecrAI

A Minecraft bot you can give commands to, and an RL project for teaching it to
collect resources.

MinecrAI joins a Java Edition server as a player. You can ask it to chop trees,
craft tools, mine ore or follow you. There is also a Python environment for
collecting demonstrations and training policies with behaviour cloning and PPO.

It runs as a **companion app / external bot**, not a Fabric or Forge mod.

[![Node](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

<img src="docs/images/demo_ppo.gif" width="520" alt="A trained PPO policy gathering wood in Minecraft">

*The wood-gathering policy after roughly 20,000 training steps on a live server.*

[Windows setup (Türkçe)](docs/install.md) · [Experiments](docs/development-notes.md) ·
[Architecture](docs/architecture.md)

## What you can do

- Use in-game commands to gather resources, craft tools, save places and build
  simple structures.
- Add a Gemini or Anthropic key for natural-language commands in Turkish.
  Without a key, the regular commands still work.
- Record a scripted expert, train a policy to imitate it, then continue training
  with PPO. The RL tasks currently cover wood gathering and mining, including
  a shared policy for both.

The everyday bot skills are scripted. The RL policies learn a smaller set of
movement and block-breaking actions; they do not learn the entire command list.

## Quick start

You need **Node.js 22+** and a running **Minecraft Java server**. The experiments
use **1.20.4**. Python is only needed for RL and the Python tests.

Clone the repository, then install the bot:

```powershell
git clone https://github.com/LocalinTheEngineer/MinecrAI.git
cd MinecrAI
npm run setup -- --bot-only
```

Edit the generated `.env` to match your server. The defaults are
`localhost:25565`, Minecraft `1.20.4` and `MC_AUTH=offline`. Use offline auth only
with a trusted local offline-mode server. For a premium server, use
`MC_AUTH=microsoft` and a Minecraft Java account.

Once the server is running:

```powershell
npm start
```

Type `komut` in the game to see the command list. Stop the bot with **Ctrl+C**.
On Windows, you can also double-click `scripts/start-minecrai.cmd`.
Setup preserves an existing `.env`; it does not download or start Minecraft.
The full `doctor` check reports missing Python in a bot-only installation;
this does not prevent `npm start` from running the chat-command bot.

For server setup, account login and common errors, see the
[installation guide](docs/install.md).

## A few commands to try

| Command | What it does |
|---|---|
| `gel` | Walk to you |
| `kes 3` | Chop three trees |
| `uret tas kazma` | Gather materials and craft a stone pickaxe |
| `kaz demir` | Mine iron |
| `burasi ev` / `git ev` | Save a place / return to it |
| `envanter` | Show the inventory |
| `dur` | Stop the current task |
| `komut` | Show all commands |

<img src="docs/images/demo_uret.gif" width="520" alt="The bot gathering materials and crafting a stone pickaxe">

*`uret tas kazma`: the bot works through the recipes and gathers the missing materials.*

## Try the RL environment

Install Python **3.10+**, then run the full setup and tests:

```powershell
npm run setup
npm test
npm run doctor
```

Start bridge mode in one terminal:

```powershell
npm start -- bridge
```

When it prints that the bridge is ready, run the random baseline in a second
terminal from the repository root:

```powershell
.\.venv\Scripts\python.exe python\random_agent.py --url ws://localhost:8765
```

On Linux/macOS, use `.venv/bin/python` instead. The random baseline checks the
connection; it is not a trained policy. Model weights are not bundled.

**Choose either bot mode or bridge mode.** Bridge mode creates its own bot and
accepts Python actions instead of chat commands. Running both with the same
account can disconnect one of them. Keep the bridge port private; it currently
has no authentication.

For demonstrations, training and evaluation commands, see the
[training workflow](docs/development-notes.md#training-workflow).

## How it works

```text
Python / Gymnasium  <-->  Node.js / Mineflayer  <-->  Minecraft Java server
                      WebSocket                  game protocol
```

Mineflayer handles the Minecraft connection. Python receives observations and
sends actions through the WebSocket bridge. The RL agent can walk, turn, break
a block or wait. Wood and mining tasks share this interface.

The [architecture notes](docs/architecture.md) explain the design, and the
[bridge protocol](bot/bridge/protocol.md) describes the messages.
[Türkçe mimari notları](docs/mimari.md) are also available.

## What the experiments showed

The trained policies collected more resources than the random baseline in the
recorded evaluations. In the shared-policy mining evaluation, PPO collected
**2.75 more ore per episode** than random, with a paired 95% confidence interval
of **[0.53, 4.97]**.

The extra benefit of PPO over imitation alone was inconclusive. The experiments
also do not establish whether sharing a policy improves learning across tasks.
The [full results and debugging notes](docs/development-notes.md) include the
comparisons, limitations and problems found along the way.

## Development

```powershell
npm run test:node
npm run test:python
npm run doctor -- --server
```

`npm test` runs both suites without Minecraft and automatically prefers `.venv`.
The Node tests use fake bots; the Python tests also run training scripts on
synthetic data. Doctor checks dependencies and settings; `--server` adds a TCP
connection check, not a full Minecraft login test.

The main folders are `bot/`, `python/`, `scripts/`, `profiles/` and `test/`.
Vanilla and Skyblock profiles are currently metadata templates. Selecting one
**does not change the bot's behaviour** or make it safe for Skyblock.

Next steps are testing installation on clean machines, preparing a companion
release and validating a compatible modpack/server pack.

- [Profile format](docs/profiles.md)
- [Release and modpack publishing plan](docs/publishing.md)
- [Detailed repository layout](docs/development-notes.md#repository-layout)

## License

[MIT](LICENSE). Minecraft game files, account credentials and trained models are
not included in the distribution.
