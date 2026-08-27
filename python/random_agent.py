"""Rastgele ajan — kopru + environment gercekten calisiyor mu diye bakar.

Ogrenme yok: sadece rastgele aksiyon secer. Amac, Python'dan gonderilen
komutlarin Minecraft'ta gercekten bir seyler yaptigini gormek.

Once Minecraft sunucusunu, sonra 'npm run bridge' komutunu calistir,
sonra:  python random_agent.py
"""

import argparse

from minecrai import MinecraftEnv
from minecrai.env import AKSIYONLAR


def main() -> None:
    ayristirici = argparse.ArgumentParser()
    ayristirici.add_argument("--adim", type=int, default=100, help="kac adim atilsin")
    ayristirici.add_argument("--url", default="ws://localhost:8765")
    args = ayristirici.parse_args()

    env = MinecraftEnv(url=args.url)
    obs, info = env.reset()
    print(f"Baglandi. Ilk gozlem: {obs.round(2)}")

    toplam_odul = 0.0
    for adim in range(args.adim):
        aksiyon = env.action_space.sample()
        obs, odul, bitti, kesildi, info = env.step(aksiyon)
        toplam_odul += odul

        print(
            f"{adim:3d}  aksiyon={AKSIYONLAR[aksiyon]:<14} "
            f"odul={odul:+.3f}  toplam={toplam_odul:+.2f}  odun={info.get('odun', 0)}"
        )

        if bitti or kesildi:
            print("Bolum bitti, sifirlaniyor.")
            obs, info = env.reset()

    env.close()
    print(f"\nBitti. Toplam odul: {toplam_odul:+.2f}")


if __name__ == "__main__":
    main()
