"""Multi-task environment (Milestone 6): one agent, two tasks.

`MinecraftEnv` already tells Node which task it is playing on every `reset()`.
Multi-task training adds one thing on top of that, switching the task from
episode to episode, and that imposes two rules:

  1. Observation width must be shared. The wood task sends 16 numbers by
     default (Milestone 4's models expect that); here `genis gozlem` is turned
     on so both go up to 20.

  2. The net must know which task it is in. On the same observation ("there is
     stone in front of me") the right answer for wood is "walk around it" and
     for mine "break it". Without the task bit both labels land on the same
     input and the net learns their average, which is neither.

     Milestone 5b was another form of this: a frozen observation gave every
     sample of an episode the same input with different labels and the net got
     stuck at `ln(4)`. Different cause, same failure: no learning when the
     distinguishing information is missing from the observation.

Task order is round-robin, not random. Random picking gives an unbalanced
split over short runs (19/11 across 30 episodes) and ruins the "which task is
it better at" comparison. Round-robin plays each task the same number of times.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .env import (
    AKSIYONLAR,
    COKLU_GOREVLER,
    MinecraftEnv,
    gozlem_boyutu,
    zenginlestir_coklu,
)


class CokluGorevEnv(gym.Env):
    """One Gym environment that plays both tasks round-robin.

    From outside it is an ordinary `gym.Env`: `collect_demos.py`,
    `train_ppo.py` and `eval_agent.py` work without knowing any special case.
    """

    metadata = {"render_modes": ["human"], "render_fps": 2}

    def __init__(
        self,
        url: str = "ws://localhost:8765",
        gorevler: list[str] | None = None,
    ) -> None:
        super().__init__()
        self.gorevler = list(gorevler or COKLU_GOREVLER)
        self.gorev = "hepsi"          # for yollar.py and reporting
        self._sira = -1

        # A single sub-environment; the task changes at episode start. Node
        # handles the switch in `gorevDegistir()` (search radius, locked target
        # and blacklist included).
        self.alt = MinecraftEnv(url=url, gorev=self.gorevler[0], genis_gozlem=True)

        self.action_space = spaces.Discrete(len(AKSIYONLAR))
        self.gozlem_boyutu = gozlem_boyutu("hepsi")
        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(self.gozlem_boyutu,), dtype=np.float32
        )

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

        # GOREVI DISARIDAN DAYATABILME.
        #
        # Varsayilan donusumlu sira egitim icin dogru. Ama DEGERLENDIRME
        # icin yetmiyor ve bu sessiz bir olcum hatasiydi:
        #
        # `eval_agent` politikalari sirayla kosturuyor ve her bolum gorevi
        # bir ilerletiyor. Politika sayisi TEK ise (su an 5) her politika
        # turdan tura gorev degistiriyor ve dengeli cikiyor -- ama bu
        # KAZARA. Politika sayisi CIFT olsaydi (ornegin bc modeli
        # bulunamayip 4'e duserse) her politika HEP AYNI gorevi alirdi:
        # rastgele ajan hep odun, PPO hep maden. Karsilastirma tamamen
        # anlamsiz olur ve hicbir belirti vermez.
        #
        # Ustelik calisan halde bile tam eslesme yok: ayni turda politika A
        # odun, politika B maden oynuyor. "Eslestirilmis karsilastirma"
        # dedigimiz sey gorev bakimindan eslesmiyordu.
        #
        # Artik degerlendirme turun gorevini acikca soyluyor ve o turdaki
        # butun politikalar AYNI gorevi ayni sirada oynuyor.
        istenen = (options or {}).get("gorev")
        if istenen is not None:
            if istenen not in self.gorevler:
                raise ValueError(
                    f"bilinmeyen gorev {istenen!r}; secenekler: {self.gorevler}")
            self._sira = self.gorevler.index(istenen)
        else:
            self._sira = (self._sira + 1) % len(self.gorevler)
        self.alt.gorev = self.gorevler[self._sira]

        gozlem, info = self.alt.reset()
        info = dict(info)
        info["gorev"] = self.alt.gorev
        return self._birlestir(), info

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        _, odul, bitti, kesildi, info = self.alt.step(action)
        info = dict(info)
        info["gorev"] = self.alt.gorev
        return self._birlestir(), odul, bitti, kesildi, info

    def uzman_aksiyonu(self) -> int:
        aksiyon = self.alt.uzman_aksiyonu()
        self.son_uzman_sebep = self.alt.son_uzman_sebep
        self.son_uzman_tani = self.alt.son_uzman_tani
        return aksiyon

    def render(self) -> None:
        self.alt.render()

    def close(self) -> None:
        self.alt.close()

    # ------------------------------------------------------------ yardimci

    def gorev_indisi(self) -> int:
        return self._sira % len(self.gorevler)

    def _birlestir(self) -> np.ndarray:
        """Alt ortamin ham gozlemine gorev indisini ekleyip zenginlestirir.

        `son_ham_gozlem` HAM hali sakliyor (gorev indisi dahil, one-hot'a
        cevrilmeden). Demolar ham kaydediliyor cunku zenginlestirme ham'in
        saf bir fonksiyonu: turetilmis alanlari degistirirsek eski kayitlar
        yeniden toplanmadan kullanilabiliyor.
        """
        ham = self.alt.son_ham_gozlem
        if ham is None:
            raise RuntimeError("alt ortam henuz gozlem uretmedi (reset cagrildi mi?)")
        self.son_ham_gozlem = np.concatenate(
            [ham, np.array([self.gorev_indisi()], dtype=np.float32)]
        )
        return np.clip(zenginlestir_coklu(self.son_ham_gozlem), -1.0, 1.0)


def ortam_kur(url: str, gorev: str):
    """Gorev adina gore dogru ortami kurar.

    Butun CLI scriptleri bunu cagiriyor, boylece 'hepsi' ozel durumu tek
    yerde duruyor -- her scriptte ayri bir if olsaydi biri unutulurdu.
    """
    if gorev == "hepsi":
        return CokluGorevEnv(url=url)
    return MinecraftEnv(url=url, gorev=gorev)
