"""Bir gorev CALISIYOR MU? Rakam degil, evet/hayir cevabi.

NEDEN VAR: `npm run bridge` calistirip ekranda akan sayilara bakmak
"bu ise yariyor mu?" sorusuna cevap vermiyor. Bu script uzman politikayi
birkac bolum kosturup net bir hukum veriyor.

    python gorev_kontrol.py --gorev maden
    python gorev_kontrol.py --gorev odun

Ogrenme YOK: elle yazilmis uzman kullaniliyor. Uzman toplayamiyorsa ajan
hic toplayamaz -- once ortamin saglam oldugunu bilmek gerekiyor.
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

    # HUKUM. Esik keyfi degil: bolum hedefi 5 kaynak. Uzman ortalama
    # 1'in altinda kaliyorsa ortamda bir sey bozuk demektir -- ajani
    # egitmenin anlami yok.
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

    # Tek bir sebep her seyi kapliyorsa bu bir arizadir: uzman tek bir
    # duruma sikismis demektir.
    if sebepler:
        en_cok, adet = sebepler.most_common(1)[0]
        if adet > 0.8 * sum(sebepler.values()):
            print(f"\n  !! Uzman zamanin %80'inden fazlasini '{en_cok}' yaparak")
            print("     gecirdi. Tek bir duruma sikismis olabilir.")
    print("=" * 56 + "\n")


if __name__ == "__main__":
    main()
