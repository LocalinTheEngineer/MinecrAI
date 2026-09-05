"""Policy network trained by imitation (behaviour cloning).

Small MLP: takes the 12-number observation, produces a distribution over 5
actions. It imitates the expert, so it is really a classifier answering "what
would the expert do in this observation?".
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from .env import GOZLEM_BOYUTU  # wood task size (backwards-compatible default)
AKSIYON_SAYISI = 5


class PolitikaAgi(nn.Module):
    # Observation size depends on the task (see `HAM_BOYUTLARI` in env.py).
    # Defaults to the wood task because Milestone 4's saved models have that
    # size and `load_state_dict` errors out on a mismatch.
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
        """Pick an action for a single observation.

        orneklem=False  -> highest scoring action (for evaluation)
        orneklem=True   -> sample from the distribution (keeps exploration)
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
    """Loads saved weights.

    Reads the observation size from the file rather than taking it from the
    caller. The size now varies per task (wood 19, mine 23) and trusting the
    caller to pass the right number is a silent failure source: a wrong number
    surfaces as an unreadable shape error in `load_state_dict`. The first
    layer's weight matrix already carries the right number.
    """
    agirliklar = torch.load(yol, map_location="cpu")
    boyut = agirliklar["katmanlar.0.weight"].shape[1]
    model = PolitikaAgi(gozlem_boyutu=boyut)
    model.load_state_dict(agirliklar)
    model.eval()
    return model
