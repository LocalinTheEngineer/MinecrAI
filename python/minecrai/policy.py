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

GOZLEM_BOYUTU = 13
AKSIYON_SAYISI = 5


class PolitikaAgi(nn.Module):
    def __init__(self, gizli: int = 128) -> None:
        super().__init__()
        self.katmanlar = nn.Sequential(
            nn.Linear(GOZLEM_BOYUTU, gizli),
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
    model = PolitikaAgi()
    model.load_state_dict(torch.load(yol, map_location="cpu"))
    model.eval()
    return model
