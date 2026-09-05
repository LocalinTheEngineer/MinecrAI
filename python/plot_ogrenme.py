"""Draws the learning curve — the README showpiece.

train_ppo.py writes every episode to CSV as it goes, so this can run while
training is still in progress; it plots the curve up to that point.

Usage:
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

    adimlar, oduller, odunlar, uzunluklar = [], [], [], []
    with open(args.kayit, encoding="utf-8") as f:
        for satir in csv.DictReader(f):
            adimlar.append(int(satir["toplam_adim"]))
            oduller.append(float(satir["odul"]))
            odunlar.append(int(satir["odun"]))
            uzunluklar.append(int(satir["adim"]))

    if len(oduller) < 2:
        raise SystemExit("Grafik icin en az 2 bolum lazim.")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    p = min(args.pencere, max(2, len(oduller) // 4))
    fig, (sol, orta, sag) = plt.subplots(1, 3, figsize=(16, 4.5))

    sol.plot(adimlar, oduller, alpha=0.25, color="tab:blue", label="bolum odulu")
    yum = hareketli_ortalama(oduller, p)
    sol.plot(adimlar[len(adimlar) - len(yum):], yum,
             color="tab:blue", lw=2, label=f"{p} bolumluk ortalama")
    sol.axhline(0, color="black", lw=0.8)
    sol.set_xlabel("egitim adimi"); sol.set_ylabel("bolum odulu")
    sol.set_title("Ogrenme egrisi"); sol.legend(); sol.grid(alpha=0.3)

    orta.plot(adimlar, odunlar, alpha=0.25, color="tab:green")
    yum2 = hareketli_ortalama(odunlar, p)
    orta.plot(adimlar[len(adimlar) - len(yum2):], yum2, color="tab:green", lw=2)
    orta.set_xlabel("egitim adimi"); orta.set_ylabel("bolum basina odun")
    orta.set_title("Toplanan odun"); orta.grid(alpha=0.3)

    # Episode length goes up when the environment gets harder (forest running
    # out). If reward drops and episodes get longer at the same time, suspect
    # the environment before blaming the policy.
    sag.plot(adimlar, uzunluklar, alpha=0.25, color="tab:orange")
    yum3 = hareketli_ortalama(uzunluklar, p)
    sag.plot(adimlar[len(adimlar) - len(yum3):], yum3, color="tab:orange", lw=2)
    sag.set_xlabel("egitim adimi"); sag.set_ylabel("bolum uzunlugu (adim)")
    sag.set_title("Bolum uzunlugu — yukseliyorsa ortam zorlasiyor")
    sag.grid(alpha=0.3)

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

    # Did the environment get harder? If episode length grew a lot, the reward
    # drop may be the forest running out rather than the policy.
    u_ilk = np.mean(uzunluklar[: max(1, len(uzunluklar) // 5)])
    u_son = np.mean(uzunluklar[-max(1, len(uzunluklar) // 5):])
    print(f"\nBolum uzunlugu  ilk %20: {u_ilk:.0f} adim  ->  son %20: {u_son:.0f} adim")
    if u_son > u_ilk * 1.4:
        print("  >> Bolumler belirgin sekilde uzamis: ORTAM ZORLASMIS olabilir")
        print("     (orman tukeniyor). Odul dususunu politikaya yuklemeden once")
        print("     bunu hesaba kat.")


if __name__ == "__main__":
    main()
