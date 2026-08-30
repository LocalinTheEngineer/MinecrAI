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
from stable_baselines3.common.utils import get_schedule_fn

from minecrai.yollar import yollar
from minecrai import MinecraftEnv

KOK = Path(__file__).parent.parent
# Ust uste kac bos bolumden sonra egitim kendini durdurur.
# 25 bolum ~ 25 dakika: gercek bir kotu sansi (ormanin kenari) atlatacak
# kadar uzun, bozuk bir ortamda saatler harcamayacak kadar kisa.
BOS_BOLUM_SINIRI = 25

MODEL_KLASORU = KOK / "models"
KAYIT = MODEL_KLASORU / "ppo_gecmis.csv"
SON_MODEL = MODEL_KLASORU / "ppo_son.zip"
KONTROL_NOKTASI = MODEL_KLASORU / "ppo_kontrol.zip"

import torch.nn as nn

AG_MIMARISI = dict(pi=[128, 128], vf=[128, 128])

# ENTROPI KATSAYISI — bu gorevdeki en kritik ayar.
#
# SB3'un varsayilani 0.0, yani politikayi cesitli tutan hicbir kuvvet yok.
# Boyle birakinca politika tek bir aksiyona kilitlendi: ajan yerinde donup
# durmaya basladi. Olctuk: 85 bolum ust uste TAM 60 adimda, 0 odunla,
# -0.60 odulle bitti. Adim basina ~47 ms — bu kadar hizli tamamlanan tek
# aksiyon donmek (bot.look neredeyse anlik; yurumek 560 ms, beklemek 200 ms).
#
# Buna entropi cokusu deniyor: kesif oluyor ve politika bir daha cikamiyor.
# Kucuk bir entropi bonusu politikayi cesitli tutuyor.
VARSAYILAN_ENTROPI = 0.01

# Ogrenme orani: 3e-4 (SB3 varsayilani) bu gorevde kararsizdi — egitim iyi
# giderken cokuyor, kisa sure toparlayip tekrar cokuyordu.
VARSAYILAN_OGRENME_ORANI = 1e-4

# Klip araligi: kucuk deger = daha temkinli guncelleme
VARSAYILAN_KLIP = 0.15


class EntropiAzaltici(BaseCallback):
    """Entropi katsayisini egitim boyunca kademeli dusurur.

    NEDEN: entropi kesifi tesvik ediyor. Basta lazim -- politika daha
    hicbir seyi denemedi. Ama sonuna dogru tersine doner: ajan artik ne
    yapacagini biliyor, rastgelelik sadece gurultu ekliyor ve odulu
    dusuruyor.

    20 bin adimlik kosuda bu fark etmiyordu (sabit 0.01 yeterliydi).
    80 bin adimda ediyor: ajan 20 binde ogrendigini 60 bin adim boyunca
    keskinlestirebilmeli. Lineer azaltma en basit ve en okunakli cozum;
    SB3'un `ent_coef`i her guncellemede yeniden okundugu icin disaridan
    degistirmek yeterli.
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

        # 10 binde bir bildir, her adimda degil
        kilometre = self.num_timesteps // 10000
        if kilometre != self.son_yazilan:
            self.son_yazilan = kilometre
            print(f"  [entropi {yeni:.4f}]")
        return True


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
            # COKUS TESPITI: ust uste neredeyse ayni dusuk odul, politikanin
            # tek bir aksiyona kilitlendigini gosterir (entropi cokusu).
            self.son_oduller.append(round(self.bolum_odul, 2))
            if len(self.son_oduller) > 15:
                self.son_oduller.pop(0)
            if (len(self.son_oduller) == 15 and len(set(self.son_oduller)) <= 2
                    and max(self.son_oduller) < 1.0 and not self.cokus_uyarildi):
                self.cokus_uyarildi = True
                print("\n  !! UYARI: son 15 bolum neredeyse ayni ve dusuk odulle bitti.")
                print("     Politika tek bir aksiyona kilitlenmis olabilir (entropi")
                print("     cokusu). Ctrl+C ile durdurup --entropi 0.02 dene.\n")

            # SIGORTA: uzun sure hicbir bolum odun toplayamiyorsa ortam
            # bozulmustur (bot suya dustu, magarada kaldi, agacsiz bolgeye
            # isinlandi). Bu bolumler egitime ZARAR veriyor: PPO gurultuden
            # ogrenmeye calisiyor.
            #
            # Bir kez yasandi: bot bogulup oldu, sonra 50+ bolum ust uste
            # "0 odun, 60 adim, -0.60" ile bitti ve egitim saatlerce devam
            # etti. Gece calistirmayi guvenli kilan sey bu sigorta: en kotu
            # ihtimalle egitim erken durur, bozuk veri birikmez.
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
                return False  # SB3 egitimi burada durdurur

            self.bolum_odul = 0.0
            self.bolum_adim = 0

        if self.num_timesteps - self.son_kontrol >= self.kontrol_araligi:
            self.son_kontrol = self.num_timesteps
            self.model.save(self.kontrol_yolu)
            print(f"  [kontrol noktasi kaydedildi: {self.num_timesteps} adim]")

        return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gorev", default="odun", choices=["odun", "maden"])
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

    # Yollar göreve göre — maden eğitimi odun modelini EZMESİN.
    # Modül seviyesindeki sabitleri burada yeniden bağlıyoruz; scriptin
    # geri kalanı onları kullanmaya devam ediyor.
    global KAYIT, SON_MODEL, KONTROL_NOKTASI
    _y = yollar(args.gorev)
    KAYIT = _y["ppo_kayit"]
    SON_MODEL = _y["ppo_son"]
    KONTROL_NOKTASI = _y["ppo_kontrol"]

    env = MinecraftEnv(url=args.url, gorev=args.gorev)

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

    # Kaydedilmis modeller kendi hiperparametreleriyle geliyor; uzerine yaz.
    # On-egitilmis model ent_coef=0.0 ile olusturulmustu — cokusun sebebi bu.
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
