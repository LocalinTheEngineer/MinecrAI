"""Gorev basina dosya yollari.

NEDEN VAR: iki gorev (odun / maden) ayni scriptleri kullaniyor ama
ayri modeller ve ayri veriler uretiyor. Yollari her scriptte tek tek
kurmak, bir gun birinin digerinin modelini ezmesiyle biterdi -- ve o
hatayi fark etmek saatler alirdi (yanlis model sessizce yuklenir).

Odun gorevi MEVCUT dosya adlarini koruyor (geriye donuk uyum);
maden gorevi '_maden' ekiyle ayriliyor.
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
