"""Per-task file paths.

Both tasks (wood / mine) run the same scripts but produce separate models and
separate data. Building the paths inline in each script would eventually let
one task overwrite the other's model, and that failure is silent: the wrong
model simply loads.

The wood task keeps the existing file names for backwards compatibility; the
mine task is separated by a '_maden' suffix.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict

KOK = Path(__file__).resolve().parent.parent.parent


def yollar(gorev: str = "odun") -> Dict[str, Path]:
    ek = "" if gorev == "odun" else f"_{gorev}"
    veri = KOK / "data" / "demonstrations"
    model = KOK / "models"
    return {
        "veri": veri / f"demos{ek}.npz",
        "bc_model": model / f"bc_policy{ek}.pt",
        "bc_grafik": model / f"bc_egitim{ek}.png",
        "ppo_on": model / f"ppo_pretrained{ek}.zip",
        "ppo_son": model / f"ppo_son{ek}.zip",
        "ppo_kontrol": model / f"ppo_kontrol{ek}.zip",
        "ppo_kayit": model / f"ppo_gecmis{ek}.csv",
        "karsilastirma": model / f"karsilastirma{ek}.png",
        "ogrenme": model / f"ogrenme_egrisi{ek}.png",
    }
