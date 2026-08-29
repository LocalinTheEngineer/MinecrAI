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
VARSAYILAN_PPO = KOK / "models" / "ppo_son.zip"
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
    ap.add_argument("--ppo", type=Path, default=VARSAYILAN_PPO,
                    help="egitilmis PPO modeli (train_ppo.py ciktisi)")
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

    # PPO — Milestone 4'un urunu. README'deki "before/after" tablosunun
    # "after" sutunu bu.
    if args.ppo.exists():
        from stable_baselines3 import PPO
        ppo_model = PPO.load(args.ppo, device="cpu")

        def ppo_politika(obs, e):
            # deterministic=False: PPO da egitim sirasinda ornekleyerek
            # davraniyor; argmax ile calistirmak ajani kilitleyebiliyor
            # (bc politikasinda tam olarak bu oldu)
            aksiyon, _ = ppo_model.predict(obs, deterministic=False)
            return int(aksiyon)

        politikalar.append(("ppo", ppo_politika))
    else:
        print(f"UYARI: {args.ppo} yok — ppo atlaniyor.")

    politikalar.append(("uzman", lambda obs, e: e.uzman_aksiyonu()))

    # Uzmanin gerekcelerini say — "hicbir sey yapmiyor" durumunda
    # NEDEN yapmadigini tahmin etmek yerine okuyoruz
    sebepler: dict[str, int] = {}

    print(f"\n{len(politikalar)} politika, {args.bolum} tur, donusumlu sira\n")
    try:
        sonuclar = donusumlu_degerlendir(env, politikalar, args.bolum, args.maks_adim)
    finally:
        env.close()

    n = len(sonuclar[0]["oduller"])
    print("\n" + "=" * 72)
    print(f"{'politika':<10} {'odul (ort ± sd)':>22} {'odun':>16} {'adim':>8}   n={n}")
    print("-" * 72)
    for r in sonuclar:
        o, w = r["oduller"], r["odunlar"]
        # Ortalamanin standart hatasi: sd / sqrt(n)
        hata = o.std(ddof=1) / np.sqrt(len(o)) if len(o) > 1 else 0.0
        print(
            f"{r['ad']:<10} {o.mean():>+12.2f} ± {hata:>5.2f} (sd {o.std(ddof=1):>4.1f})"
            f" {w.mean():>8.1f} ± {w.std(ddof=1) / np.sqrt(len(w)):>4.1f}"
            f" {r['adimlar'].mean():>8.0f}"
        )
    print("=" * 72)

    # FARK GURULTUNUN ICINDE MI?
    #
    # Bu gorevde bolumler arasi degiskenlik cok yuksek: ayni politika bir
    # bolumde +8, digerinde -2 alabiliyor. Az orneklem ile ortalamalari
    # siralamak, olmayan bir sonucu iddia etmek olur.
    #
    # Olcut: iki politikanin farki, ikisinin standart hatalarinin
    # toplamindan buyuk mu? (kaba ama okunakli bir anlamlilik testi)
    #
    # ONEMLI: sadece ilk ikiyi karsilastirmak sonucu EKSIK raporlar.
    # "ppo vs bc" gurultude olabilir ama "ppo vs rastgele" anlamli olabilir --
    # ve asil rapor edilecek sonuc odur. O yuzden butun ciftlere bakiyoruz.
    sirali = sorted(sonuclar, key=lambda r: -r["oduller"].mean())
    if len(sirali) >= 2 and n > 1:
        def _hata(r):
            return r["oduller"].std(ddof=1) / np.sqrt(n)

        print("\nIkili karsilastirmalar (fark > hata toplami ise anlamli):")
        anlamli = []
        for i in range(len(sirali)):
            for j in range(i + 1, len(sirali)):
                a, b = sirali[i], sirali[j]
                fark = a["oduller"].mean() - b["oduller"].mean()
                esik = _hata(a) + _hata(b)
                ok = fark > esik
                isaret = "ANLAMLI" if ok else "gurultude"
                print(f"  {a['ad']:<9} > {b['ad']:<9} fark {fark:+5.2f}  esik {esik:4.2f}   {isaret}")
                if ok:
                    anlamli.append((a["ad"], b["ad"], fark))

        if anlamli:
            print("\n  >> Rapor edilebilir sonuclar:")
            for x, y, f in anlamli:
                print(f"     {x} politikasi {y} politikasindan {f:+.2f} odul daha iyi.")
        else:
            print("\n  >> Hicbir cift ayrisMIyor: bu veriyle siralama yapma.")

        # Kac bolum gerekirdi? Gozlenen sd'den hesapla, sabit sayi uydurma.
        # Iki ortalamanin farkinin ayrismasi icin kabaca: n >= 2*(sd/fark)^2
        a, b = sirali[0], sirali[1]
        fark12 = a["oduller"].mean() - b["oduller"].mean()
        sd_ort = (a["oduller"].std(ddof=1) + b["oduller"].std(ddof=1)) / 2
        if fark12 > 0.01:
            gerek = int(np.ceil(2 * (sd_ort / fark12) ** 2))
            if gerek > n:
                print(f"\n  Ilk iki ({a['ad']} vs {b['ad']}) ayrismasi icin kabaca "
                      f"{gerek} bolum gerekir (su an {n}, sd~{sd_ort:.1f}).")

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
    renkler = ["tab:gray", "tab:blue", "tab:red", "tab:green"][: len(adlar)]
    sol.bar(adlar, ortalama, yerr=hata, capsize=5, color=renkler)
    sol.set_ylabel("bolum odulu"); sol.set_title("Ortalama bolum odulu")
    sol.axhline(0, color="black", lw=0.8); sol.grid(axis="y", alpha=0.3)

    sag.bar(adlar, [s["odunlar"].mean() for s in sonuclar], color=renkler)
    sag.set_ylabel("odun"); sag.set_title("Bolum basina toplanan odun")
    sag.grid(axis="y", alpha=0.3)

    fig.tight_layout()
    fig.savefig(yol, dpi=130)
    print(f"Grafik kaydedildi -> {yol}")


if __name__ == "__main__":
    main()
