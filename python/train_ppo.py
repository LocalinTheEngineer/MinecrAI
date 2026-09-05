"""Milestone 4, step 2: reinforcement learning with PPO.

At this stage the agent no longer imitates the expert, it learns from its own
experience: it looks at how much reward it collected each episode and adjusts
its behaviour itself.

Timing: every step in Minecraft takes ~0.4 seconds, so 20,000 steps is ~2
hours. The script was written stop-and-resume from the start:
  - a checkpoint is saved every N steps
  - every episode goes to CSV (the curve can be plotted from a half-finished run)
  - Ctrl+C shuts down cleanly and the run can be resumed

Usage:
    python train_ppo.py --baslangic models/ppo_pretrained.zip --adim 20000
    python train_ppo.py --devam                 # resume from last checkpoint
"""

from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.utils import get_schedule_fn

from minecrai.yollar import yollar
from minecrai import MinecraftEnv, ortam_kur

KOK = Path(__file__).parent.parent
# How many empty episodes in a row before training stops itself.
# 25 episodes ~ 25 minutes: long enough to ride out genuine bad luck (edge of
# the forest), short enough not to burn hours on a broken environment.
BOS_BOLUM_SINIRI = 25

MODEL_KLASORU = KOK / "models"
KAYIT = MODEL_KLASORU / "ppo_gecmis.csv"
SON_MODEL = MODEL_KLASORU / "ppo_son.zip"
KONTROL_NOKTASI = MODEL_KLASORU / "ppo_kontrol.zip"

import torch.nn as nn

AG_MIMARISI = dict(pi=[128, 128], vf=[128, 128])

# Entropy coefficient, the most critical setting on this task.
#
# SB3 defaults to 0.0, so nothing keeps the policy varied. Left that way the
# policy locked onto a single action and the agent spun in place. Measured: 85
# episodes in a row ended at exactly 60 steps, 0 wood, -0.60 reward. ~47 ms
# per step -- the only action that finishes that fast is turning (bot.look is
# almost instant; walking is 560 ms, waiting 200 ms).
#
# This is entropy collapse: exploration stops and the policy never gets out
# again. A small entropy bonus keeps the policy varied.
VARSAYILAN_ENTROPI = 0.01

# Learning rate: 3e-4 (the SB3 default) was unstable on this task -- training
# went well, collapsed, recovered briefly, collapsed again.
VARSAYILAN_OGRENME_ORANI = 1e-4

# Clip range: smaller value = more cautious update
VARSAYILAN_KLIP = 0.15


class EntropiAzaltici(BaseCallback):
    """Lowers the entropy coefficient gradually over training.

    Entropy drives exploration. It is needed at the start -- the policy has
    not tried anything yet. Towards the end it turns around: the agent knows
    what to do and the randomness is only noise, costing reward.

    On a 20k-step run this made no difference (a fixed 0.01 was enough). On
    80k it does: whatever the agent learns in the first 20k has to be
    sharpened over the remaining 60k. Linear decay is the simplest and most
    readable option, and since SB3 re-reads `ent_coef` on every update,
    setting it from outside is enough.
    """

    def __init__(self, bas: float, son: float, toplam_adim: int):
        super().__init__()
        self.bas = bas
        self.son = son
        self.toplam_adim = max(1, toplam_adim)
        self.son_yazilan = None

    def _on_step(self) -> bool:
        oran = min(1.0, self.num_timesteps / self.toplam_adim)
        yeni = self.bas + (self.son - self.bas) * oran
        self.model.ent_coef = yeni

        # report every 10k steps, not every step
        kilometre = self.num_timesteps // 10000
        if kilometre != self.son_yazilan:
            self.son_yazilan = kilometre
            print(f"  [entropi {yeni:.4f}]")
        return True


class BolumKaydedici(BaseCallback):
    """Writes every finished episode to CSV and prints it.

    Why CSV: training runs for hours and can be interrupted. Keeping the
    results only in memory would throw away every run that did not finish.
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
        self.son_oduller = []
        self.cokus_uyarildi = False
        self.ust_uste_bos = 0

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
            # Collapse detection: near-identical low rewards in a row mean the
            # policy has locked onto one action (entropy collapse).
            self.son_oduller.append(round(self.bolum_odul, 2))
            if len(self.son_oduller) > 15:
                self.son_oduller.pop(0)
            if (len(self.son_oduller) == 15 and len(set(self.son_oduller)) <= 2
                    and max(self.son_oduller) < 1.0 and not self.cokus_uyarildi):
                self.cokus_uyarildi = True
                print("\n  !! UYARI: son 15 bolum neredeyse ayni ve dusuk odulle bitti.")
                print("     Politika tek bir aksiyona kilitlenmis olabilir (entropi")
                print("     cokusu). Ctrl+C ile durdurup --entropi 0.02 dene.\n")

            # Failsafe: if nothing collects wood for a long stretch the
            # environment is broken (bot fell in water, stuck in a cave,
            # teleported somewhere with no trees). Those episodes actively
            # hurt training: PPO tries to learn from noise.
            #
            # Happened once: the bot drowned, then 50+ episodes in a row ended
            # "0 wood, 60 steps, -0.60" and training carried on for hours.
            # This failsafe is what makes an overnight run safe: worst case
            # training stops early instead of piling up broken data.
            if odun == 0:
                self.ust_uste_bos += 1
            else:
                self.ust_uste_bos = 0

            if self.ust_uste_bos >= BOS_BOLUM_SINIRI:
                print(f"\n{'=' * 60}")
                print(f"  DURDURULDU: {self.ust_uste_bos} bolum ust uste 0 odun.")
                print("  Ortam bozulmus olmali - bot suda, magarada veya")
                print("  agacsiz bir yerde. BOT penceresindeki son satirlara bak.")
                print("  Model kaydedildi; botu ormana isinlayip --devam ile surdur.")
                print(f"{'=' * 60}\n")
                return False  # SB3 stops training here

            self.bolum_odul = 0.0
            self.bolum_adim = 0

        if self.num_timesteps - self.son_kontrol >= self.kontrol_araligi:
            self.son_kontrol = self.num_timesteps
            self.model.save(self.kontrol_yolu)
            print(f"  [kontrol noktasi kaydedildi: {self.num_timesteps} adim]")

        return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gorev", default="odun", choices=["odun", "maden", "hepsi"])
    ap.add_argument("--adim", type=int, default=20000, help="toplam egitim adimi")
    ap.add_argument("--baslangic", type=Path, default=None,
                    help="on-egitilmis model (pretrain_ppo.py ciktisi)")
    ap.add_argument("--devam", action="store_true",
                    help="son kontrol noktasindan devam et")
    ap.add_argument("--kontrol-araligi", type=int, default=1000)
    ap.add_argument("--entropi-son", type=float, default=None,
                    help="entropiyi egitim boyunca bu degere kadar dusur "
                         "(uzun kosularda onerilir, orn. 0.003)")
    ap.add_argument("--entropi", type=float, default=VARSAYILAN_ENTROPI,
                    help="entropi bonusu — 0 verirsen politika cokebilir")
    ap.add_argument("--ogrenme-orani", type=float, default=VARSAYILAN_OGRENME_ORANI)
    ap.add_argument("--klip", type=float, default=VARSAYILAN_KLIP)
    ap.add_argument("--url", default="ws://localhost:8765")
    args = ap.parse_args()

    # Paths per task, so maden training does not overwrite the odun model.
    # The module-level constants are rebound here; the rest of the script goes
    # on using them.
    global KAYIT, SON_MODEL, KONTROL_NOKTASI
    _y = yollar(args.gorev)
    KAYIT = _y["ppo_kayit"]
    SON_MODEL = _y["ppo_son"]
    KONTROL_NOKTASI = _y["ppo_kontrol"]

    env = ortam_kur(args.url, args.gorev)

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
            policy_kwargs=dict(net_arch=AG_MIMARISI, activation_fn=nn.ReLU),
            n_steps=512, batch_size=64,
            learning_rate=args.ogrenme_orani,
            ent_coef=args.entropi,
            clip_range=args.klip,
            verbose=0, device="cpu",
        )

    # Saved models come back with their own hyperparameters; overwrite them.
    # The pre-trained model was built with ent_coef=0.0 -- that is what caused
    # the collapse.
    model.ent_coef = args.entropi
    model.learning_rate = args.ogrenme_orani
    model.lr_schedule = get_schedule_fn(args.ogrenme_orani)
    model.clip_range = get_schedule_fn(args.klip)
    print(f"entropi={args.entropi}  ogrenme_orani={args.ogrenme_orani}  klip={args.klip}")

    kaydedici = BolumKaydedici(KAYIT, KONTROL_NOKTASI, args.kontrol_araligi)
    geri_cagrimlar = [kaydedici]

    if args.entropi_son is not None:
        geri_cagrimlar.append(
            EntropiAzaltici(args.entropi, args.entropi_son, args.adim)
        )
        print(f"entropi {args.entropi} -> {args.entropi_son} (kademeli)")

    print(f"\nEgitim basliyor: {args.adim} adim")
    print(f"Kayit: {KAYIT}")
    print("Ctrl+C ile guvenle durdurabilirsin, ilerleme kaybolmaz.\n")

    try:
        model.learn(total_timesteps=args.adim, callback=geri_cagrimlar,
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
