"""MinecrAI'nin Gymnasium environment'i.

Standart bir Gym arayuzu sundugu icin stable-baselines3 gibi hazir RL
kutuphaneleri bu environment'i dogrudan egitebilir.

Kullanim:
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

# Gozlem vektorunun boyutu — bot/bridge/environment.js ile AYNI olmali
GOZLEM_BOYUTU = 13

# Aksiyonlar — bot/bridge/protocol.md ile ayni sirada.
#
# NOT: Eskiden bir "agaca_yaklas" aksiyonu vardi; pathfinder'i cagirip
# navigasyonun tamamini tek adimda yapiyordu. Ajan bunu kesfettigi anda
# yurumeyi ogrenmeyi birakip hep ona basacagi icin kaldirildi. Ayrintili
# gerekce: docs/architecture.md
AKSIYONLAR = [
    "ileri_yuru",
    "saga_don",
    "sola_don",
    "blogu_kir",
    "bekle",
]


class MinecraftEnv(gym.Env):
    """Mineflayer botunu bir RL environment'i gibi gosterir."""

    metadata = {"render_modes": ["human"], "render_fps": 2}

    def __init__(self, url: str = "ws://localhost:8765") -> None:
        super().__init__()

        self.action_space = spaces.Discrete(len(AKSIYONLAR))
        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(GOZLEM_BOYUTU,), dtype=np.float32
        )

        self.bridge = BridgeClient(url)
        self._son_info: Dict[str, Any] = {}

    # ------------------------------------------------------------ Gym API

    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        super().reset(seed=seed)
        cevap = self.bridge.reset()
        self._son_info = cevap.get("info", {})
        return self._obs(cevap["obs"]), self._son_info

    def uzman_aksiyonu(self) -> int:
        """Uzman politikanin bu durumda sececeği aksiyon (Milestone 3).

        Ogrenme yok — elle yazilmis kurallar. Amaci taklit edilecek ornegi
        uretmek. Bkz. bot/bridge/expert.js
        """
        return int(self.bridge.expert()["action"])

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        cevap = self.bridge.step(int(action))
        self._son_info = cevap.get("info", {})
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

    # ------------------------------------------------------------ yardimci

    @staticmethod
    def _obs(ham) -> np.ndarray:
        dizi = np.asarray(ham, dtype=np.float32)
        if dizi.shape != (GOZLEM_BOYUTU,):
            raise ValueError(
                f"Gozlem boyutu {dizi.shape}, beklenen ({GOZLEM_BOYUTU},). "
                "environment.js ile env.py uyusmuyor olabilir."
            )
        return np.clip(dizi, -1.0, 1.0)
