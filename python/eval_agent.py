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


sebepler: dict[str, int] = {}


def bolum_calistir(env: MinecraftEnv, politika, maks_adim: int):
    obs, _ = env.reset()
    toplam = 0.0
    info = {}
    for adim in range(1, maks_adim + 1):
        aksiyon = politika(obs, env)
        sebep = getattr(env, "son_uzman_sebep", None)
        if sebep and sebep != "?":
            sebepler[sebep] = sebepler.get(sebep, 0) + 1
        obs, odul, bitti, kesildi, info = env.step(aksiyon)
        toplam += odul
        if bitti or kesildi:
            break
    return toplam, int(info.get("odun", 0)), adim


def donusumlu_degerlendir(env, politikalar, bolum, maks_adim):
    """Politikalari SIRAYLA degil DONUSUMLU calistirir.

    Neden onemli: dunya degerlendirme sirasinda degisiyor. Agaclar kesiliyor,
    yere odun dokuluyor. Politikalari blok blok calistirinca ilki en taze
    ormani goruyor, sonuncusu tukenmis alani. Olctuk: rastgele ajan ilk
    sirada 4.6 odun "topluyor" — becerisinden degil, oncekilerin dokttugu
    yiginlarin ustunden gectigi icin.

    Donusumlu sirada (A,B,C, A,B,C, ...) tukenme hepsini esit etkiliyor.
    """
    sonuc = {ad: {"oduller": [], "odunlar": [], "adimlar": []} for ad, _ in politikalar}

    for tur in range(bolum):
        for ad, fn in politikalar:
            o, w, a = bolum_calistir(env, fn, maks_adim)
            sonuc[ad]["oduller"].append(o)
            sonuc[ad]["odunlar"].append(w)
            sonuc[ad]["adimlar"].append(a)
            print(f"  tur {tur + 1}/{bolum}  {ad:<9} odul={o:+7.2f}  odun={w:2d}  adim={a}")
        print()

    return [
        {"ad": ad, **{k: np.array(v) for k, v in d.items()}}
        for ad, d in sonuc.items()
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bolum", type=int, default=10)
    ap.add_argument("--maks-adim", type=int, default=300)
    ap.add_argument("--model", type=Path, default=VARSAYILAN_MODEL)
    ap.add_argument("--grafik", type=Path, default=VARSAYILAN_GRAFIK)
    ap.add_argument("--url", default="ws://localhost:8765")
    ap.add_argument("--argmax", action="store_true",
                    help="bc politikasini orneklemeden, en yuksek skorla calistir")
    args = ap.parse_args()

    env = MinecraftEnv(url=args.url)
    rng = np.random.default_rng(0)

    politikalar = [
        ("rastgele", lambda obs, e: int(rng.integers(e.action_space.n))),
    ]

    if args.model.exists():
        from minecrai.policy import yukle
        model = yukle(args.model)
        # ORNEKLEYEREK sec, argmax ile degil.
        #
        # argmax deterministik: politika bir duruma saplandiginda ayni
        # aksiyonu sonsuza kadar tekrarliyor ve kendini kilitliyor. Olctuk:
        # 5 bolumun 3'u tam 60 adimda durgunluk siniriyla bitti.
        # Olasiliga gore ornekleme bu kilidi kiriyor; PPO da egitim sirasinda
        # zaten boyle davraniyor.
        politikalar.append(
            ("bc", lambda obs, e: model.aksiyon_sec(obs, orneklem=not args.argmax))
        )
    else:
        print(f"UYARI: {args.model} yok — bc atlaniyor. Once train_bc.py calistir.")

    politikalar.append(("uzman", lambda obs, e: e.uzman_aksiyonu()))

    # Uzmanin gerekcelerini say — "hicbir sey yapmiyor" durumunda
    # NEDEN yapmadigini tahmin etmek yerine okuyoruz
    sebepler: dict[str, int] = {}

    print(f"\n{len(politikalar)} politika, {args.bolum} tur, donusumlu sira\n")
    try:
        sonuclar = donusumlu_degerlendir(env, politikalar, args.bolum, args.maks_adim)
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

    if sebepler:
        print("\nUzmanin gerekce dagilimi:")
        for ad, adet in sorted(sebepler.items(), key=lambda x: -x[1]):
            print(f"  {ad:<34} {adet:5d}")
        if sebepler.get("AGAC_BULAMIYORUM", 0) > sum(sebepler.values()) * 0.5:
            print("\n  >> Uzman zamanin yarisindan fazlasinda AGAC GOREMIYOR.")
            print("     Bot ormanda mi? 32 blok icinde dogal agac var mi?")
            tani = getattr(env, "son_uzman_tani", {})
            if tani:
                print(f"     Son tani: {tani}")

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
