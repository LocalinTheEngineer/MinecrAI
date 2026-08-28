"""Ogrenme egrisini cizer — README'nin vitrini.

train_ppo.py egitim boyunca her bolumu CSV'ye yazdigi icin bu script
EGITIM DEVAM EDERKEN de calistirilabilir; o ana kadarki egriyi cizer.

Kullanim:
    python plot_ogrenme.py
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

KOK = Path(__file__).parent.parent
VARSAYILAN_KAYIT = KOK / "models" / "ppo_gecmis.csv"
VARSAYILAN_CIKTI = KOK / "models" / "ogrenme_egrisi.png"


def hareketli_ortalama(dizi, pencere):
    if len(dizi) < pencere:
        return np.array(dizi, dtype=float)
    return np.convolve(dizi, np.ones(pencere) / pencere, mode="valid")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kayit", type=Path, default=VARSAYILAN_KAYIT)
    ap.add_argument("--cikti", type=Path, default=VARSAYILAN_CIKTI)
    ap.add_argument("--pencere", type=int, default=10, help="yumusatma penceresi")
    args = ap.parse_args()

    if not args.kayit.exists():
        raise SystemExit(f"Kayit yok: {args.kayit}\nOnce train_ppo.py calistir.")

    adimlar, oduller, odunlar = [], [], []
    with open(args.kayit, encoding="utf-8") as f:
        for satir in csv.DictReader(f):
            adimlar.append(int(satir["toplam_adim"]))
            oduller.append(float(satir["odul"]))
            odunlar.append(int(satir["odun"]))

    if len(oduller) < 2:
        raise SystemExit("Grafik icin en az 2 bolum lazim.")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    p = min(args.pencere, max(2, len(oduller) // 4))
    fig, (sol, sag) = plt.subplots(1, 2, figsize=(12, 4.5))

    sol.plot(adimlar, oduller, alpha=0.25, color="tab:blue", label="bolum odulu")
    yum = hareketli_ortalama(oduller, p)
    sol.plot(adimlar[len(adimlar) - len(yum):], yum,
             color="tab:blue", lw=2, label=f"{p} bolumluk ortalama")
    sol.axhline(0, color="black", lw=0.8)
    sol.set_xlabel("egitim adimi"); sol.set_ylabel("bolum odulu")
    sol.set_title("Ogrenme egrisi"); sol.legend(); sol.grid(alpha=0.3)

    sag.plot(adimlar, odunlar, alpha=0.25, color="tab:green")
    yum2 = hareketli_ortalama(odunlar, p)
    sag.plot(adimlar[len(adimlar) - len(yum2):], yum2, color="tab:green", lw=2)
    sag.set_xlabel("egitim adimi"); sag.set_ylabel("bolum basina odun")
    sag.set_title("Toplanan odun"); sag.grid(alpha=0.3)

    fig.tight_layout()
    args.cikti.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.cikti, dpi=140)

    ilk = np.mean(oduller[: max(1, len(oduller) // 5)])
    son = np.mean(oduller[-max(1, len(oduller) // 5):])
    print(f"Grafik -> {args.cikti}")
    print(f"{len(oduller)} bolum, {adimlar[-1]} adim")
    print(f"Ilk %20 ortalama odul: {ilk:+.2f}")
    print(f"Son %20 ortalama odul: {son:+.2f}")
    print(f"Degisim: {son - ilk:+.2f}")


if __name__ == "__main__":
    main()
