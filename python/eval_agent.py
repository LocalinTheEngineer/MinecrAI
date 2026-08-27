"""Milestone 3, adim 3: politikalari karsilastir.

Uc politikayi ayni kosullarda calistirip karsilastirir:
  - rastgele : hicbir sey ogrenmemis taban cizgisi
  - bc       : uzmani taklit etmeyi ogrenmis ag
  - uzman    : elle yazilmis kural seti (tavan degeri)

README'ye koyacagimiz "before/after" grafigi buradan cikiyor.

Kullanim:
    python eval_agent.py --bolum 10
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from minecrai import MinecraftEnv

KOK = Path(__file__).parent.parent
VARSAYILAN_MODEL = KOK / "models" / "bc_policy.pt"
VARSAYILAN_GRAFIK = KOK / "models" / "karsilastirma.png"


def bolum_calistir(env: MinecraftEnv, politika, maks_adim: int):
    obs, _ = env.reset()
    toplam = 0.0
    info = {}
    for adim in range(1, maks_adim + 1):
        obs, odul, bitti, kesildi, info = env.step(politika(obs, env))
        toplam += odul
        if bitti or kesildi:
            break
    return toplam, int(info.get("odun", 0)), adim


def degerlendir(env, ad, politika, bolum, maks_adim):
    oduller, odunlar, adimlar = [], [], []
    for i in range(bolum):
        o, w, a = bolum_calistir(env, politika, maks_adim)
        oduller.append(o); odunlar.append(w); adimlar.append(a)
        print(f"  {ad:<9} bolum {i + 1:2d}/{bolum}  odul={o:+7.2f}  odun={w:2d}  adim={a}")
    return {
        "ad": ad,
        "oduller": np.array(oduller),
        "odunlar": np.array(odunlar),
        "adimlar": np.array(adimlar),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bolum", type=int, default=10)
    ap.add_argument("--maks-adim", type=int, default=300)
    ap.add_argument("--model", type=Path, default=VARSAYILAN_MODEL)
    ap.add_argument("--grafik", type=Path, default=VARSAYILAN_GRAFIK)
    ap.add_argument("--url", default="ws://localhost:8765")
    args = ap.parse_args()

    env = MinecraftEnv(url=args.url)
    rng = np.random.default_rng(0)

    politikalar = [
        ("rastgele", lambda obs, e: int(rng.integers(e.action_space.n))),
    ]

    if args.model.exists():
        from minecrai.policy import yukle
        model = yukle(args.model)
        politikalar.append(("bc", lambda obs, e: model.aksiyon_sec(obs)))
    else:
        print(f"UYARI: {args.model} yok — bc atlaniyor. Once train_bc.py calistir.")

    politikalar.append(("uzman", lambda obs, e: e.uzman_aksiyonu()))

    sonuclar = []
    try:
        for ad, fn in politikalar:
            print(f"\n--- {ad} ---")
            sonuclar.append(degerlendir(env, ad, fn, args.bolum, args.maks_adim))
    finally:
        env.close()

    print("\n" + "=" * 58)
    print(f"{'politika':<10} {'ortalama odul':>15} {'ortalama odun':>15} {'adim':>8}")
    print("-" * 58)
    for s in sonuclar:
        print(
            f"{s['ad']:<10} {s['oduller'].mean():>+15.2f} "
            f"{s['odunlar'].mean():>15.1f} {s['adimlar'].mean():>8.0f}"
        )
    print("=" * 58)

    _grafik_ciz(sonuclar, args.grafik)


def _grafik_ciz(sonuclar, yol: Path) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib yok, grafik atlandi.")
        return

    yol.parent.mkdir(parents=True, exist_ok=True)
    adlar = [s["ad"] for s in sonuclar]
    fig, (sol, sag) = plt.subplots(1, 2, figsize=(11, 4))

    ortalama = [s["oduller"].mean() for s in sonuclar]
    hata = [s["oduller"].std() for s in sonuclar]
    sol.bar(adlar, ortalama, yerr=hata, capsize=5,
            color=["tab:gray", "tab:blue", "tab:green"][: len(adlar)])
    sol.set_ylabel("bolum odulu"); sol.set_title("Ortalama bolum odulu")
    sol.axhline(0, color="black", lw=0.8); sol.grid(axis="y", alpha=0.3)

    sag.bar(adlar, [s["odunlar"].mean() for s in sonuclar],
            color=["tab:gray", "tab:blue", "tab:green"][: len(adlar)])
    sag.set_ylabel("odun"); sag.set_title("Bolum basina toplanan odun")
    sag.grid(axis="y", alpha=0.3)

    fig.tight_layout()
    fig.savefig(yol, dpi=130)
    print(f"Grafik kaydedildi -> {yol}")


if __name__ == "__main__":
    main()
