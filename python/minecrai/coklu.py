"""Cok gorevli ortam (Milestone 6): TEK ajan, iki gorev.

FIKIR: `MinecraftEnv` zaten hangi gorevi oynadigini her `reset()`te Node'a
bildiriyor. Cok gorevli egitim bunun uzerine tek bir sey ekliyor -- gorevi
BOLUMDEN BOLUME degistirmek -- ve iki kural dayatiyor:

  1. Gozlem genisligi ortak olmali. Odun gorevi varsayilan olarak 16 sayi
     gonderiyor (Milestone 4'un modelleri oyle bekliyor); burada `genis
     gozlem` acilarak ikisi de 20'ye cikiyor.

  2. Ag hangi gorevde oldugunu BILMELI. Bu, uzerinde durmaya deger:
     ayni gozlemde ("onumde tas var") odun gorevinin dogru cevabi
     "dolas", maden gorevinin dogru cevabi "kir". Gorev bilgisi olmadan
     bu iki etiket ayni girdiye dusuyor ve ag ikisinin ortalamasini
     ogreniyor -- yani hicbirini.

     Milestone 5b'de tam olarak bunun bir baska bicimini yasadik: donmus
     gozlem yuzunden bolumun butun ornekleri ayni girdiye farkli etiket
     tasiyordu ve ag `ln(4)`te takildi. Sebep farkli, ariza ayni:
     AYIRT EDICI BILGI GOZLEMDE YOKSA OGRENME YOK.

GOREV SIRASI DONUSUMLU, rastgele degil. Rastgele secim kisa kosularda
dengesiz dagilim uretiyor (30 bolumde 19/11 gibi) ve "hangi gorevde daha
iyi" karsilastirmasini bozuyor. Donusumlu sira her gorevi esit sayida
oynatiyor.
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
    """Iki gorevi donusumlu oynatan tek bir Gym ortami.

    Disaridan bakinca sirandan bir `gym.Env`: `collect_demos.py`,
    `train_ppo.py` ve `eval_agent.py` hicbir ozel durum bilmeden calisiyor.
    """

    metadata = {"render_modes": ["human"], "render_fps": 2}

    def __init__(
        self,
        url: str = "ws://localhost:8765",
        gorevler: list[str] | None = None,
    ) -> None:
        super().__init__()
        self.gorevler = list(gorevler or COKLU_GOREVLER)
        self.gorev = "hepsi"          # yollar.py ve raporlama icin
        self._sira = -1

        # Tek bir alt ortam; gorevi bolum basinda degistiriyoruz.
        # Node tarafi gorev degisimini `gorevDegistir()` ile ele aliyor
        # (arama yaricapi, kilitli hedef ve kara liste dahil).
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
