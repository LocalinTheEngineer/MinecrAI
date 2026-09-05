"""Milestone 3, step 3: compare the policies.

Runs three policies under the same conditions and compares them:
  - rastgele : baseline that learned nothing
  - bc       : net that learned to imitate the expert
  - uzman    : hand-written rule set (the ceiling)

The "before/after" plot for the README comes from here.

Usage:
    python eval_agent.py --bolum 10
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

from minecrai.yollar import yollar
from minecrai import MinecraftEnv, ortam_kur

KOK = Path(__file__).parent.parent
VARSAYILAN_MODEL = KOK / "models" / "bc_policy.pt"
VARSAYILAN_PPO = KOK / "models" / "ppo_son.zip"
VARSAYILAN_GRAFIK = KOK / "models" / "karsilastirma.png"


sebepler: dict[str, int] = {}


def bolum_calistir(env: MinecraftEnv, politika, maks_adim: int, gorev=None):
    obs, _ = env.reset(options={"gorev": gorev} if gorev else None)
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
    """Runs the policies alternating, not one block at a time.

    The world changes during evaluation: trees get cut, wood ends up on the
    ground. Run policy by policy and the first one sees the freshest forest,
    the last one a stripped patch. Measured: the random agent "collects" 4.6
    wood when it goes first -- not from skill, but from walking over the piles
    the earlier ones dropped.

    Alternating (A,B,C, A,B,C, ...) lets the depletion hit all of them equally.
    """
    sonuc = {ad: {"oduller": [], "odunlar": [], "adimlar": []} for ad, _ in politikalar}

    # Write the raw result to disk at the end of every round.
    #
    # This was missing, and evaluation takes 40+ minutes. Interrupted halfway
    # (Ctrl+C, power, socket drop) nothing was saved -- only what had already
    # been printed. No long job should vanish completely when it is cut short;
    # demo collection already saves every episode, and evaluation now does too.
    ham_yol = KOK / "models" / "eval_ham.csv"
    ham_yol.parent.mkdir(parents=True, exist_ok=True)
    with open(ham_yol, "w", encoding="utf-8", newline="") as f:
        yazici = csv.writer(f)
        yazici.writerow(["tur", "gorev", "politika", "odul", "odun", "adim"])

        # Pick the round's task explicitly (multi-task environment).
        #
        # Every policy in a round has to play the same task. See
        # minecrai/coklu.py -- leaving this to the environment only worked
        # when the policy count was odd, a silent measurement error.
        tur_gorevleri = getattr(env, "gorevler", None)

        for tur in range(bolum):
            tur_gorevi = (
                tur_gorevleri[tur % len(tur_gorevleri)] if tur_gorevleri else None
            )
            if tur_gorevi:
                print(f"  --- tur {tur + 1}: {tur_gorevi} ---")
            for ad, fn in politikalar:
                o, w, a = bolum_calistir(env, fn, maks_adim, tur_gorevi)
                sonuc[ad]["oduller"].append(o)
                sonuc[ad]["odunlar"].append(w)
                sonuc[ad]["adimlar"].append(a)
                yazici.writerow([tur + 1, tur_gorevi or "", ad, f"{o:.4f}", w, a])
                f.flush()  # so it is on disk if this gets interrupted
                print(f"  tur {tur + 1}/{bolum}  {ad:<9} odul={o:+7.2f}  odun={w:2d}  adim={a}")
            print()

    return [
        {"ad": ad, **{k: np.array(v) for k, v in d.items()}}
        for ad, d in sonuc.items()
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gorev", default="odun", choices=["odun", "maden", "hepsi"])
    ap.add_argument("--bolum", type=int, default=10)
    ap.add_argument("--maks-adim", type=int, default=300)
    ap.add_argument("--model", type=Path, default=None)
    ap.add_argument("--ppo-on", type=Path, default=None,
                    help="taklitle on-egitilmis PPO (RL egitimi GORMEMIS). "
                         "Bunu 'ppo' ile karsilastirmak, RL'in taklidin "
                         "USTUNE ne kattigini dogrudan olcer.")
    ap.add_argument("--ppo", type=Path, default=VARSAYILAN_PPO,
                    help="egitilmis PPO modeli (train_ppo.py ciktisi)")
    ap.add_argument("--grafik", type=Path, default=None)
    ap.add_argument("--url", default="ws://localhost:8765")
    ap.add_argument("--argmax", action="store_true",
                    help="bc politikasini orneklemeden, en yuksek skorla calistir")
    args = ap.parse_args()

    y = yollar(args.gorev)
    if args.model is None:
        args.model = y["bc_model"]
    if args.grafik is None:
        args.grafik = y["karsilastirma"]
    if args.ppo == VARSAYILAN_PPO:
        args.ppo = y["ppo_son"]

    env = ortam_kur(args.url, args.gorev)
    rng = np.random.default_rng(0)

    politikalar = [
        ("rastgele", lambda obs, e: int(rng.integers(e.action_space.n))),
    ]

    if args.model.exists():
        from minecrai.policy import yukle
        model = yukle(args.model)
        # Sample, do not take the argmax.
        #
        # argmax is deterministic: once the policy gets stuck in a state it
        # repeats the same action forever and locks itself up. Measured: 3 of
        # 5 episodes ended at exactly 60 steps on the stall limit. Sampling by
        # probability breaks the lock, and PPO behaves this way during
        # training anyway.
        politikalar.append(
            ("bc", lambda obs, e: model.aksiyon_sec(obs, orneklem=not args.argmax))
        )
    else:
        print(f"UYARI: {args.model} yok — bc atlaniyor. Once train_bc.py calistir.")

    def ppo_ekle(ad: str, yol: Path) -> None:
        """Adds a PPO-based policy to the comparison."""
        if not yol.exists():
            print(f"UYARI: {yol} yok — {ad} atlaniyor.")
            return
        from stable_baselines3 import PPO
        m = PPO.load(yol, device="cpu")

        def politika(obs, e, _m=m):
            # deterministic=False: PPO samples during training too, and
            # running it with argmax can lock the agent up (exactly what
            # happened with the bc policy)
            aksiyon, _ = _m.predict(obs, deterministic=False)
            return int(aksiyon)

        politikalar.append((ad, politika))

    # Measure what RL contributes, directly.
    #
    # The comparison used to be "ppo vs bc", which is the wrong question: the
    # two are different architectures, different training procedures,
    # different sampling behaviour. There is no telling how much of the gap
    # comes from RL. Milestone 4 got stuck on exactly this -- the difference
    # came out insignificant and there was no way to say why.
    #
    # 'ppo_on' and 'ppo' are the same net and the same architecture; the only
    # difference between them is RL training. Running them in the same rounds,
    # alternating, reads off the answer to "what did reinforcement learning add
    # on top of imitation". Being a paired comparison, it also removes most of
    # the between-episode variance (how sparse the ore veins happen to be).
    if args.ppo_on is not None:
        ppo_ekle("ppo_on", args.ppo_on)
    ppo_ekle("ppo", args.ppo)

    politikalar.append(("uzman", lambda obs, e: e.uzman_aksiyonu()))

    # Count the expert's reasons -- when it does nothing, read why instead of
    # guessing
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
        # Standard error of the mean: sd / sqrt(n)
        hata = o.std(ddof=1) / np.sqrt(len(o)) if len(o) > 1 else 0.0
        print(
            f"{r['ad']:<10} {o.mean():>+12.2f} ± {hata:>5.2f} (sd {o.std(ddof=1):>4.1f})"
            f" {w.mean():>8.1f} ± {w.std(ddof=1) / np.sqrt(len(w)):>4.1f}"
            f" {r['adimlar'].mean():>8.0f}"
        )
    print("=" * 72)

    # Is the difference inside the noise?
    #
    # Between-episode variance is very high on this task: the same policy can
    # score +8 in one episode and -2 in the next. Ranking means on a small
    # sample claims a result that is not there.
    #
    # Test: is the gap between two policies larger than the sum of their
    # standard errors? (crude but readable significance check)
    #
    # Comparing only the top two reports an incomplete result. "ppo vs bc" may
    # be in the noise while "ppo vs rastgele" is significant -- and that is the
    # result worth reporting. So every pair is checked.
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

        # How many episodes would it take? Compute it from the observed sd
        # instead of inventing a fixed number. For two means to separate,
        # roughly: n >= 2*(sd/diff)^2
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
