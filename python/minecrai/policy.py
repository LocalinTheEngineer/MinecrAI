"""Taklit ederek ogrenen politika agi (behaviour cloning).

Kucuk bir MLP: 12 sayilik gozlemi alir, 5 aksiyon uzerinde olasilik dagilimi
uretir. Amac uzmani taklit etmek — yani "bu gozlemde uzman ne yapardi?"
sorusuna cevap veren bir siniflandirici.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from .env import GOZLEM_BOYUTU  # odun gorevinin boyutu (geriye donuk varsayilan)
AKSIYON_SAYISI = 5


class PolitikaAgi(nn.Module):
    # Gozlem boyutu GOREVE gore degisiyor (bkz. env.py `HAM_BOYUTLARI`).
    # Varsayilan odun gorevi, cunku Milestone 4'un kayitli modelleri o
    # boyutta ve `load_state_dict` boyut uyusmazliginda hata veriyor.
    def __init__(self, gizli: int = 128, gozlem_boyutu: int = GOZLEM_BOYUTU) -> None:
        super().__init__()
        self.gozlem_boyutu = gozlem_boyutu
        self.katmanlar = nn.Sequential(
            nn.Linear(gozlem_boyutu, gizli),
            nn.ReLU(),
            nn.Linear(gizli, gizli),
            nn.ReLU(),
            nn.Linear(gizli, AKSIYON_SAYISI),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.katmanlar(x)

    @torch.no_grad()
    def aksiyon_sec(self, gozlem: np.ndarray, orneklem: bool = False) -> int:
        """Tek bir gozlem icin aksiyon sec.

        orneklem=False  -> en yuksek skorlu aksiyon (degerlendirme icin)
        orneklem=True   -> olasiliga gore ornekle (kesifi korur)
        """
        x = torch.as_tensor(gozlem, dtype=torch.float32).unsqueeze(0)
        skorlar = self(x)
        if orneklem:
            olasilik = torch.softmax(skorlar, dim=-1)
            return int(torch.multinomial(olasilik, 1).item())
        return int(skorlar.argmax(dim=-1).item())


def kaydet(model: PolitikaAgi, yol: Path) -> None:
    yol.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), yol)


def yukle(yol: Path) -> PolitikaAgi:
    """Kayitli agirliklari yukler.

    Gozlem boyutunu DOSYADAN okuyor, cagirandan istemiyor. Gozlem boyutu
    artik goreve gore degisiyor (odun 19, maden 23) ve cagiranin dogru
    sayiyi gecmesine guvenmek sessiz bir hata kaynagi: yanlis sayi
    `load_state_dict`te anlasilmaz bir boyut hatasi veriyor. Ilk katmanin
    agirlik matrisi zaten dogru sayiyi tasiyor.
    """
    agirliklar = torch.load(yol, map_location="cpu")
    boyut = agirliklar["katmanlar.0.weight"].shape[1]
    model = PolitikaAgi(gozlem_boyutu=boyut)
    model.load_state_dict(agirliklar)
    model.eval()
    return model
