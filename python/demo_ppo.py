"""Egitilmis PPO politikasini calistir - sadece onu, baska hicbir seyi.

`eval_agent.py` dort politikayi donusumlu calistirir (rastgele, bc, ppo,
uzman). Olcum icin dogru olan bu, ama DEMO icin degil: kaydin yarisinda
rastgele ajan sallanip duruyor.

Bu script tek isi yapar: modeli yukle, N bolum oynat, sonucu yaz.

    python demo_ppo.py --bolum 3
"""

from __future__ import annotations

import argparse
from pathlib import Path

from minecrai import MinecraftEnv

KOK = Path(__file__).resolve().parent.parent
VARSAYILAN_MODEL = KOK / "models" / "ppo_son.zip"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bolum", type=int, default=3)
    ap.add_argument("--maks-adim", type=int, default=300)
    ap.add_argument("--model", type=Path, default=VARSAYILAN_MODEL)
    ap.add_argument("--url", default="ws://localhost:8765")
    ap.add_argument("--argmax", action="store_true",
                    help="orneklemek yerine en olasi aksiyonu sec "
                         "(kilitlenme riski var, demo icin onerilmez)")
    args = ap.parse_args()

    if not args.model.exists():
        print(f"Model yok: {args.model}")
        print("Once egitim yapilmali (train_ppo.py) veya dosya adini kontrol et.")
        return

    from stable_baselines3 import PPO

    print(f"Model yukleniyor: {args.model}")
    model = PPO.load(str(args.model))

    env = MinecraftEnv(url=args.url)
    try:
        for bolum in range(1, args.bolum + 1):
            obs, _ = env.reset()
            toplam = 0.0
            adim = 0
            odun = 0

            while adim < args.maks_adim:
                aksiyon, _ = model.predict(obs, deterministic=args.argmax)
                obs, odul, bitti, kesildi, bilgi = env.step(int(aksiyon))
                toplam += float(odul)
                adim += 1
                odun = int(bilgi.get("odun", odun))
                if bitti or kesildi:
                    break

            print(f"bolum {bolum} | odul {toplam:+6.2f} | adim {adim:4d} | odun {odun}")
    finally:
        env.close()


if __name__ == "__main__":
    main()
