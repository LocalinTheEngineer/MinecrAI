"""Milestone 4, adim 2: PPO ile pekistirmeli ogrenme.

Bu asamada ajan artik uzmani taklit etmiyor — kendi deneyiminden ogreniyor.
Her bolumde ne kadar odul topladigina bakip davranisini kendisi ayarliyor.

SURE UYARISI: Minecraft'ta her adim ~0.4 saniye. 20.000 adim ~2 saat demek.
Bu yuzden script bastan "durdur-devam et" mantigiyla yazildi:
  - her N adimda kontrol noktasi kaydedilir
  - her bolum CSV'ye yazilir (egitim yarim kalsa bile grafik cizilebilir)
  - Ctrl+C temiz kapanir, kaldigin yerden devam edebilirsin

Kullanim:
    python train_ppo.py --baslangic models/ppo_pretrained.zip --adim 20000
    python train_ppo.py --devam                 # son kontrol noktasindan devam
"""

from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback

from minecrai import MinecraftEnv

KOK = Path(__file__).parent.parent
MODEL_KLASORU = KOK / "models"
KAYIT = MODEL_KLASORU / "ppo_gecmis.csv"
SON_MODEL = MODEL_KLASORU / "ppo_son.zip"
KONTROL_NOKTASI = MODEL_KLASORU / "ppo_kontrol.zip"

AG_MIMARISI = dict(pi=[128, 128], vf=[128, 128])


class BolumKaydedici(BaseCallback):
    """Her bolum bittiginde sonucu CSV'ye yazar ve ekrana basar.

    Neden CSV: egitim saatler suruyor ve yarida kesilebiliyor. Sonuclari
    sadece bellekte tutsaydik yarim kalan her kosu bosa giderdi.
    """

    def __init__(self, kayit_yolu: Path, kontrol_yolu: Path, kontrol_araligi: int):
        super().__init__()
        self.kayit_yolu = kayit_yolu
        self.kontrol_yolu = kontrol_yolu
        self.kontrol_araligi = kontrol_araligi
        self.bolum = 0
        self.bolum_odul = 0.0
        self.bolum_adim = 0
        self.baslangic = time.time()
        self.son_kontrol = 0

    def _on_training_start(self) -> None:
        self.kayit_yolu.parent.mkdir(parents=True, exist_ok=True)
        if not self.kayit_yolu.exists():
            with open(self.kayit_yolu, "w", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow(
                    ["bolum", "toplam_adim", "odul", "adim", "odun", "gecen_sn"]
                )

    def _on_step(self) -> bool:
        self.bolum_odul += float(self.locals["rewards"][0])
        self.bolum_adim += 1

        if self.locals["dones"][0]:
            self.bolum += 1
            info = self.locals["infos"][0]
            odun = int(info.get("odun", 0))
            gecen = time.time() - self.baslangic

            with open(self.kayit_yolu, "a", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow([
                    self.bolum, self.num_timesteps,
                    round(self.bolum_odul, 3), self.bolum_adim, odun, round(gecen)
                ])

            print(
                f"bolum {self.bolum:4d} | toplam adim {self.num_timesteps:6d} | "
                f"odul {self.bolum_odul:+7.2f} | adim {self.bolum_adim:4d} | "
                f"odun {odun:2d} | {gecen / 60:.0f} dk"
            )
            self.bolum_odul = 0.0
            self.bolum_adim = 0

        if self.num_timesteps - self.son_kontrol >= self.kontrol_araligi:
            self.son_kontrol = self.num_timesteps
            self.model.save(self.kontrol_yolu)
            print(f"  [kontrol noktasi kaydedildi: {self.num_timesteps} adim]")

        return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adim", type=int, default=20000, help="toplam egitim adimi")
    ap.add_argument("--baslangic", type=Path, default=None,
                    help="on-egitilmis model (pretrain_ppo.py ciktisi)")
    ap.add_argument("--devam", action="store_true",
                    help="son kontrol noktasindan devam et")
    ap.add_argument("--kontrol-araligi", type=int, default=1000)
    ap.add_argument("--url", default="ws://localhost:8765")
    args = ap.parse_args()

    env = MinecraftEnv(url=args.url)

    if args.devam and KONTROL_NOKTASI.exists():
        print(f"Kontrol noktasindan devam: {KONTROL_NOKTASI}")
        model = PPO.load(KONTROL_NOKTASI, env=env, device="cpu")
    elif args.baslangic and args.baslangic.exists():
        print(f"On-egitilmis modelden basliyor: {args.baslangic}")
        model = PPO.load(args.baslangic, env=env, device="cpu")
    else:
        print("SIFIRDAN basliyor — uzun surer. pretrain_ppo.py onerilir.")
        model = PPO(
            "MlpPolicy", env,
            policy_kwargs=dict(net_arch=AG_MIMARISI),
            n_steps=512, batch_size=64, learning_rate=3e-4,
            verbose=0, device="cpu",
        )

    kaydedici = BolumKaydedici(KAYIT, KONTROL_NOKTASI, args.kontrol_araligi)

    print(f"\nEgitim basliyor: {args.adim} adim")
    print(f"Kayit: {KAYIT}")
    print("Ctrl+C ile guvenle durdurabilirsin, ilerleme kaybolmaz.\n")

    try:
        model.learn(total_timesteps=args.adim, callback=kaydedici,
                    reset_num_timesteps=not args.devam)
    except KeyboardInterrupt:
        print("\nDurduruldu — model kaydediliyor...")
    finally:
        MODEL_KLASORU.mkdir(parents=True, exist_ok=True)
        model.save(SON_MODEL)
        env.close()
        print(f"Model kaydedildi -> {SON_MODEL}")
        print(f"Grafik icin:  python plot_ogrenme.py")


if __name__ == "__main__":
    main()
