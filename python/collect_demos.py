"""Milestone 3, step 1: collect demo data from the expert.

The expert policy (bot/bridge/expert.js) already does the task correctly.
Run it and record two things on every step:

    observation (12 numbers)  ->  the action the expert chose (0-4)

The resulting dataset is no longer an RL problem, it is a plain
classification problem: "look at this state, what would the expert do?"

Usage:
    1) start the Minecraft server
    2) npm run bridge
    3) python collect_demos.py --bolum 30
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np

from minecrai import MinecraftEnv, ortam_kur
from minecrai.yollar import yollar
from minecrai.env import AKSIYONLAR

VARSAYILAN_CIKTI = Path(__file__).parent.parent / "data" / "demonstrations" / "demos.npz"


def _kaydet(cikti: Path, gozlemler, aksiyonlar, oduller, odunlar) -> None:
    cikti.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cikti,
        gozlemler=np.asarray(gozlemler, dtype=np.float32),
        aksiyonlar=np.asarray(aksiyonlar, dtype=np.int64),
        bolum_odulleri=np.asarray(oduller, dtype=np.float32),
        bolum_odunlari=np.asarray(odunlar, dtype=np.int32),
    )


def topla(
    env: MinecraftEnv,
    bolum_sayisi: int,
    maks_adim: int,
    cikti: Path,
    gurultu: float = 0.0,
    tohum: int = 0,
):
    """Runs the expert and records (observation, expert_action) pairs.

    With gurultu > 0 a random action is sometimes applied instead of the one
    the expert asked for, but the label recorded is still the expert's action.

    That is deliberate: the expert never makes a mistake, so the demos consist
    entirely of "everything is going fine" states. A running agent inevitably
    ends up in states the expert never saw and has no idea what to do there
    (covariate shift). The noise produces "what would the expert do when
    things go wrong" examples.
    """
    rng = np.random.default_rng(tohum)
    gozlemler: list[np.ndarray] = []
    aksiyonlar: list[int] = []
    bolum_odulleri: list[float] = []
    bolum_odunlari: list[int] = []

    for bolum in range(bolum_sayisi):
        obs, bolum_bilgisi = env.reset()
        toplam_odul = 0.0
        adim = 0

        for adim in range(1, maks_adim + 1):
            aksiyon = env.uzman_aksiyonu()

            # The observation has to be the state before the action is
            # applied, not after.
            #
            # And it has to be the raw observation, not the enriched one:
            # enrichment happens on the training side, so doing it here too
            # applies it twice (16 -> 19 -> 22) and the net collapses. Since
            # `zenginlestir` is a pure function of the raw observation,
            # storing the raw form also keeps things flexible: change the
            # derived fields and old demos are still valid.
            gozlemler.append(env.son_ham_gozlem.copy())
            aksiyonlar.append(aksiyon)

            # The action actually applied is sometimes random -- the label
            # recorded above is always the expert's.
            uygulanan = aksiyon
            if gurultu > 0 and rng.random() < gurultu:
                uygulanan = int(rng.integers(env.action_space.n))

            obs, odul, bitti, kesildi, info = env.step(uygulanan)
            toplam_odul += odul
            if bitti or kesildi:
                break

        odun = int(info.get("odun", 0))
        bolum_odulleri.append(toplam_odul)
        bolum_odunlari.append(odun)

        # Save at the end of every episode. Collection takes a long time, and
        # if it is cut short (Ctrl+C, timeout, server drop) the data up to
        # that point survives.
        _kaydet(cikti, gozlemler, aksiyonlar, bolum_odulleri, bolum_odunlari)

        # Print which task this episode was.
        #
        # In multi-task collection (Milestone 6) nothing on screen shows that
        # the tasks really do alternate; the first run had to be verified by
        # opening the saved file and counting the task column. A failure in
        # something invisible does not get noticed.
        etiket = bolum_bilgisi.get("gorev", "")
        etiket = f"  [{etiket}]" if etiket else ""
        print(
            f"bolum {bolum + 1:3d}/{bolum_sayisi}{etiket}  "
            f"adim={adim:4d}  odun={odun:2d}  odul={toplam_odul:+7.2f}  "
            f"toplam ornek={len(gozlemler)}"
        )

    X = np.asarray(gozlemler, dtype=np.float32)
    veri_sagligi(X, np.asarray(aksiyonlar, dtype=np.int64))

    return (
        X,
        np.asarray(aksiyonlar, dtype=np.int64),
        np.asarray(bolum_odulleri, dtype=np.float32),
        np.asarray(bolum_odunlari, dtype=np.int32),
    )


def veri_sagligi(X: np.ndarray, y: np.ndarray) -> bool:
    """Says whether the collected data is learnable at all.

    Two collection runs (~45 minutes) were thrown away, and the problem only
    showed up when BC training collapsed -- and even then it was misdiagnosed
    first. The cause was `son_ham_gozlem` not being updated inside
    `MinecraftEnv.step()`: every sample of an episode had the same observation
    with different actions. 4498 samples, 30 unique observation rows.

    Data like that is written out silently, the file looks normal, and the
    fault only surfaces hours later as "the net won't learn". A failure that
    can be measured should not stay quiet, so it is reported here as soon as
    collection ends.
    """
    if len(X) < 2:
        return True

    benzersiz = len(np.unique(X, axis=0))
    oran = benzersiz / len(X)
    cogunluk = np.bincount(y).max() / len(y)

    print(f"\nVeri sagligi: {benzersiz} benzersiz gozlem / {len(X)} ornek "
          f"(%{100 * oran:.1f}), cogunluk sinifi %{100 * cogunluk:.1f}")

    if oran < 0.5:
        print(
            "  !! UYARI: gozlemlerin cogu TEKRAR EDIYOR.\n"
            "     Ayni gozleme farkli aksiyonlar dusuyorsa taklit egitimi\n"
            "     cogunluk sinifindan iyisini yapamaz. Gozlem her adimda\n"
            "     guncelleniyor mu? (bkz. MinecraftEnv.step, son_ham_gozlem)"
        )
        return False
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bolum", type=int, default=30, help="kac bolum toplanacak")
    ap.add_argument("--maks-adim", type=int, default=300, help="bolum basina adim siniri")
    ap.add_argument("--url", default="ws://localhost:8765")
    ap.add_argument("--cikti", type=Path, default=VARSAYILAN_CIKTI)
    ap.add_argument("--gurultu", type=float, default=0.25,
                    help="bu olasilikla rastgele aksiyon uygula (etiket yine uzmanin)")
    ap.add_argument("--tohum", type=int, default=0)
    ap.add_argument("--gorev", default="odun", choices=["odun", "maden", "hepsi"],
                    help="hangi gorevin demolari toplanacak")
    args = ap.parse_args()

    # Separate demo file per task. Mixing them would show one net the
    # (observation, action) pairs of two different tasks as if they carried
    # the same label -- in "stone in front of me" the odun task teaches
    # walking around it, the maden task teaches breaking it. Same input,
    # opposite label.
    if args.cikti == VARSAYILAN_CIKTI:
        args.cikti = yollar(args.gorev)["veri"]

    env = ortam_kur(args.url, args.gorev)
    baslangic = time.time()

    try:
        X, y, odul, odun = topla(
            env, args.bolum, args.maks_adim, args.cikti,
            gurultu=args.gurultu, tohum=args.tohum,
        )
    except KeyboardInterrupt:
        print("\nKesildi — o ana kadarki veri kaydedilmisti.")
        return
    finally:
        env.close()

    print(f"\n{len(X)} ornek kaydedildi -> {args.cikti}")
    print(f"Sure: {time.time() - baslangic:.0f} sn")
    print(f"Bolum basina ortalama odul: {odul.mean():+.2f}")
    print(f"Bolum basina ortalama odun: {odun.mean():.1f}")
    print("\nAksiyon dagilimi:")
    for i, ad in enumerate(AKSIYONLAR):
        adet = int((y == i).sum())
        oran = adet / max(len(y), 1) * 100
        print(f"  {ad:<12} {adet:6d}  ({oran:5.1f}%)")

    if len(set(y.tolist())) < 2:
        print("\nUYARI: veride tek tur aksiyon var — model ogrenecek bir sey bulamaz.")


if __name__ == "__main__":
    main()
