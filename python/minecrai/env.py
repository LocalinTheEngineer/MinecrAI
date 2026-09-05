"""MinecrAI's Gymnasium environment.

It exposes a standard Gym interface, so off-the-shelf RL libraries such as
stable-baselines3 can train against it directly.

Usage:
    from minecrai import MinecraftEnv
    env = MinecraftEnv()
    obs, info = env.reset()
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .bridge import BridgeClient

# Raw observation size coming from Node, must match environment.js.
#
# It varies per task, deliberately.
#
# The mine task gets 4 extra numbers (egocentric direction/distance of the
# dropped item, and whether the blocking block in front is breakable). Without
# them BC accuracy was 25.5% against a 25% blind baseline over four actions,
# so the net learned nothing: the expert spends 39% of its steps picking up
# dropped ore and the observation said nothing about items.
# Details: `ekGozlem` in bot/bridge/gorevler.js.
#
# The wood task stays at 16: Milestone 4's trained models (bc_policy.pt,
# ppo_son.zip) expect a 19-wide input. Widening the observation there too
# would make working, measured, published models unloadable, which is too
# high a price for fixing a new task.
ORTAK = 16          # base numbers sent for every task
EK = 4              # EK_GOZLEM in gorevler.js: dropped item + breakable obstacle
TURETILEN = 3       # `zenginlestir`: egocentric target angle

HAM_BOYUTLARI = {"odun": ORTAK, "maden": ORTAK + EK}

# Multi-task (Milestone 6): both tasks share one network.
#
# Two conditions:
#   1) Observation width must be shared -> wood also sends the wide
#      observation (`genisGozlem: true`), so both are ORTAK + EK.
#   2) The net must know which task it is in. On the same observation the wood
#      task says "do not break stone" while the mine task says "break it";
#      without the task bit those labels contradict each other and the net
#      learns their average, the same failure as the frozen observation in
#      Milestone 5b for a different reason.
#
# In the raw record the task sits in the last column as an index (0=wood,
# 1=mine) and is turned into a one-hot on the way into the net. Storing an
# index keeps demos readable and old records stay valid if the task list grows.
COKLU_GOREVLER = ["odun", "maden"]
HAM_BOYUTLARI["hepsi"] = ORTAK + EK + 1

GOZLEM_BOYUTLARI = {ad: n + TURETILEN for ad, n in HAM_BOYUTLARI.items()}
# the one-hot replaces the single index column in the raw record: +len-1
GOZLEM_BOYUTLARI["hepsi"] = ORTAK + EK + TURETILEN + len(COKLU_GOREVLER)


def ham_boyutu(gorev: str = "odun") -> int:
    return HAM_BOYUTLARI[gorev]


def gozlem_boyutu(gorev: str = "odun") -> int:
    return GOZLEM_BOYUTLARI[gorev]


def genis_gozlem_mi(gorev: str) -> bool:
    """Whether to ask Node for the EK numbers as well.

    Wood defaults to the narrow observation (16): Milestone 4's trained models
    expect a 19-wide input and we do not break them. Multi-task training turns
    it on because it needs a shared width.
    """
    return gorev != "odun"


def zenginlestir_coklu(ham: np.ndarray) -> np.ndarray:
    """Converts a multi-task raw observation into the network's input format.

    In  : [ORTAK+EK numbers] + [task index]                       (= 21)
    Out : [ORTAK+EK numbers] + [3 derived] + [task one-hot 2]      (= 25)
    """
    ham = np.asarray(ham, dtype=np.float32)
    gozlem = zenginlestir(ham[..., :-1])
    indis = ham[..., -1].astype(np.int64)
    tek = np.eye(len(COKLU_GOREVLER), dtype=np.float32)[indis]
    return np.concatenate([gozlem, tek], axis=-1)


def zenginlestirici(gorev: str):
    """The enrichment function for this task."""
    return zenginlestir_coklu if gorev == "hepsi" else zenginlestir


# Backwards-compatible names: the wood task's sizes. Older code imports these
# directly (policy.py, pretrain_ppo.py).
HAM_BOYUTU = HAM_BOYUTLARI["odun"]
GOZLEM_BOYUTU = GOZLEM_BOYUTLARI["odun"]


def zenginlestir(ham: np.ndarray) -> np.ndarray:
    """Adds the egocentric target angle to a raw observation.

    The raw observation gives the target direction in world coordinates
    (dx, dy, dz) and the bot's yaw as a separate number. Answering "is the
    target to my left or my right" means combining them through an atan2,
    a hard nonlinearity for a small MLP.

    The expert's turn decision depends directly on that angle. Handing it over
    ready-made makes the decision readable from the sign of a single number,
    and measured BC accuracy goes up clearly.

    The information is already in the raw observation; nothing new is measured,
    it is only reshaped into something the net can use. That is why it can be
    applied retroactively to old recorded data.

    The 3 added numbers:
      - angle / pi      : signed difference, -1..1 (left positive)
      - sin(angle)      : continuous form of the angle (no jump at +-pi)
      - cos(angle)      : 1 = straight ahead, -1 = straight behind
    """
    ham = np.asarray(ham, dtype=np.float32)
    dx, dz = ham[..., 0], ham[..., 2]
    yaw = ham[..., 4] * np.pi

    hedef_yaw = np.arctan2(-dx, -dz)
    fark = hedef_yaw - yaw
    fark = (fark + np.pi) % (2 * np.pi) - np.pi  # wrap into -pi..pi

    ek = np.stack([fark / np.pi, np.sin(fark), np.cos(fark)], axis=-1)
    return np.concatenate([ham, ek.astype(np.float32)], axis=-1)

# Actions, in the same order as bot/bridge/protocol.md.
#
# There used to be an "agaca_yaklas" action that called the pathfinder and did
# the whole navigation in one step. It was removed because once the agent finds
# it, it stops learning to walk and just presses that. Full reasoning:
# docs/architecture.md
AKSIYONLAR = [
    "ileri_yuru",
    "saga_don",
    "sola_don",
    "blogu_kir",
    "bekle",
]


class MinecraftEnv(gym.Env):
    """Presents the Mineflayer bot as an RL environment."""

    metadata = {"render_modes": ["human"], "render_fps": 2}

    def __init__(
        self,
        url: str = "ws://localhost:8765",
        gorev: str = "odun",
        genis_gozlem: bool | None = None,
    ) -> None:
        self.gorev = gorev
        super().__init__()

        # Whether to ask Node for the EK numbers. None = the task's default.
        # The multi-task wrapper (coklu.py) sets it to True explicitly.
        self.genis_gozlem = (
            genis_gozlem_mi(gorev) if genis_gozlem is None else genis_gozlem
        )

        self.ham_boyutu = ORTAK + (EK if self.genis_gozlem else 0)
        self.gozlem_boyutu = self.ham_boyutu + TURETILEN

        self.action_space = spaces.Discrete(len(AKSIYONLAR))
        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(self.gozlem_boyutu,), dtype=np.float32
        )

        self.bridge = BridgeClient(url)
        self._son_info: Dict[str, Any] = {}

        # Raw observation (the 16 numbers Node sends), before enrichment.
        #
        # Demos must store the raw form: `zenginlestir` is a pure function of
        # it, so changing the derived fields later can be recomputed from old
        # demos. Storing the enriched form loses that, and it already cost us
        # once: the training side enriched a second time, produced a
        # 19+3=22-wide input and the net crashed.
        self.son_ham_gozlem: np.ndarray | None = None
        self.son_uzman_sebep = "?"
        self.son_uzman_tani: Dict[str, Any] = {}

    # ------------------------------------------------------------ Gym API

    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        super().reset(seed=seed)
        # The task is sent on every reset. If Node's task did not change this
        # is a no-op; if it did, the switch happens at an episode boundary. So
        # changing task per episode in multi-task training needs no extra
        # protocol.
        cevap = self.bridge.reset(self.gorev, self.genis_gozlem)
        self._son_info = cevap.get("info", {})
        self.son_ham_gozlem = np.asarray(cevap["obs"], dtype=np.float32)
        return self._obs(cevap["obs"]), self._son_info

    def uzman_aksiyonu(self) -> int:
        """The action the expert policy would pick here (Milestone 3).

        No learning, just hand-written rules. Its job is to produce examples to
        imitate. See bot/bridge/expert.js
        """
        cevap = self.bridge.expert()
        self.son_uzman_sebep = cevap.get("sebep", "?")
        self.son_uzman_tani = cevap.get("tani", {})
        return int(cevap["action"])

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        cevap = self.bridge.step(int(action))
        self._son_info = cevap.get("info", {})

        # Update the raw observation here too.
        #
        # This line was missing for a while and threw away two demo collection
        # runs (~45 minutes). `son_ham_gozlem` was only written in `reset()`,
        # so it stayed frozen at the reset value for the whole episode. Since
        # `collect_demos.py` records it every step, all samples of an episode
        # had the same observation with different actions.
        #
        # Measured: 4498 samples contained only 30 unique observation rows,
        # exactly the episode count. 100% of the samples were contradictory.
        # The best accuracy reachable on such data is the majority class
        # (33.2%); BC training got 30.7% and the loss sat exactly at
        # ln(4)=1.386, meaning the net had learned to spread equal probability
        # over four actions and nothing else.
        #
        # Lesson: when the net will not learn, look at the data first. Adding
        # features was a reasonable hypothesis but unmeasured, and it cost
        # another collection run. Opening the data took two minutes.
        self.son_ham_gozlem = np.asarray(cevap["obs"], dtype=np.float32)

        return (
            self._obs(cevap["obs"]),
            float(cevap["reward"]),
            bool(cevap["terminated"]),
            bool(cevap["truncated"]),
            self._son_info,
        )

    def render(self) -> None:
        odun = self._son_info.get("odun", 0)
        adim = self._son_info.get("adim", 0)
        print(f"adim={adim:4d}  odun={odun}")

    def close(self) -> None:
        self.bridge.close()

    # ------------------------------------------------------------ helpers

    def _obs(self, ham) -> np.ndarray:
        dizi = np.asarray(ham, dtype=np.float32)
        if dizi.shape != (self.ham_boyutu,):
            raise ValueError(
                f"Ham gozlem boyutu {dizi.shape}, '{self.gorev}' gorevi icin "
                f"beklenen ({self.ham_boyutu},). environment.js ile env.py "
                "uyusmuyor olabilir."
            )
        return np.clip(zenginlestir(dizi), -1.0, 1.0)
