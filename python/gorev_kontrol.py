"""Does a task work at all? A yes/no answer, not numbers.

Running `npm run bridge` and watching numbers scroll past does not answer
"is this working?". This script runs the expert policy for a few episodes
and gives a verdict.

    python gorev_kontrol.py --gorev maden
    python gorev_kontrol.py --gorev odun

No learning: it uses the hand-written expert. If the expert cannot collect
anything, the agent never will — the environment has to be sound first.
"""

from __future__ import annotations

import argparse
from collections import Counter

from minecrai import MinecraftEnv, ortam_kur


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gorev", default="odun", choices=["odun", "maden", "hepsi"])
    ap.add_argument("--bolum", type=int, default=3)
    ap.add_argument("--maks-adim", type=int, default=300)
    ap.add_argument("--url", default="ws://localhost:8765")
    args = ap.parse_args()

    print(f"\n{args.gorev.upper()} gorevi kontrol ediliyor ({args.bolum} bolum)...")
    print("Uzman politika oynuyor - ogrenme yok.\n")

    env = ortam_kur(args.url, args.gorev)
    toplam_kaynak = 0
    toplam_adim = 0
    sebepler: Counter[str] = Counter()

    try:
        for bolum in range(1, args.bolum + 1):
            env.reset()
            kaynak = adim = 0

            while adim < args.maks_adim:
                aksiyon = env.uzman_aksiyonu()
                sebepler[env.son_uzman_sebep] += 1
                _, _, bitti, kesildi, bilgi = env.step(aksiyon)
                adim += 1
                kaynak = int(bilgi.get("odun", kaynak))
                if bitti or kesildi:
                    break

            toplam_kaynak += kaynak
            toplam_adim += adim
            print(f"  bolum {bolum}: {kaynak} kaynak, {adim} adim")
    finally:
        env.close()

    print("\n" + "=" * 56)
    ortalama = toplam_kaynak / args.bolum

    # Verdict. The threshold is not arbitrary: an episode targets 5 resources.
    # If the expert averages under 1, something in the environment is broken
    # and training an agent is pointless.
    if ortalama >= 3:
        print(f"  CALISIYOR. Uzman bolum basina {ortalama:.1f} kaynak topladi.")
        print("  Ortam saglam; veri toplayip egitime gecebilirsin.")
    elif ortalama >= 1:
        print(f"  ZAYIF. Uzman bolum basina sadece {ortalama:.1f} kaynak topladi.")
        print("  Calisiyor ama verimsiz. Bot dogru yerde mi? (orman / maden)")
    else:
        print(f"  CALISMIYOR. Uzman hic kaynak toplayamadi ({ortalama:.1f}).")
        print("  Ajani egitmenin anlami yok - once bunu duzeltmek gerek.")

    print("\n  Uzman en cok ne yapti:")
    for sebep, adet in sebepler.most_common(5):
        pay = 100 * adet / max(1, sum(sebepler.values()))
        print(f"    {sebep:<34} {adet:5d}  (%{pay:.0f})")

    # One reason covering almost everything is a fault: the expert is stuck in
    # a single state.
    if sebepler:
        en_cok, adet = sebepler.most_common(1)[0]
        if adet > 0.8 * sum(sebepler.values()):
            print(f"\n  !! Uzman zamanin %80'inden fazlasini '{en_cok}' yaparak")
            print("     gecirdi. Tek bir duruma sikismis olabilir.")
    print("=" * 56 + "\n")


if __name__ == "__main__":
    main()
