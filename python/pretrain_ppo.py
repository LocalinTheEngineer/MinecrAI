"""Milestone 4, adim 1: BC agirliklarini PPO'ya devret (warm start).

Neden gerekli: PPO sifirdan baslarsa rastgele davranir ve Minecraft'ta her adim
~0.4 saniye surdugu icin ilk anlamli davranisi gormek saatler alir. Elimizde
zaten uzmani taklit etmeyi ogrenmis bir politika var — PPO'yu oradan
baslatirsak ogrenme cok daha erken ise yarar hale gelir.

Teknik nokta: train_bc.py kendi kucuk agini egitiyor, ama Stable-Baselines3
kendi politika nesnesini kullaniyor. Agirliklari elle kopyalamak kirilgan.
Bunun yerine BURADA dogrudan SB3'un politikasini denetimli (supervised)
egitiyoruz. Cikan .zip dosyasi PPO'nun anlayacagi formatta.

Kullanim (Minecraft'a baglanmaya GEREK YOK):
    python pretrain_ppo.py --epoch 80
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3 import PPO

from minecrai.env import GOZLEM_BOYUTU, AKSIYONLAR
from minecrai import zenginlestir

KOK = Path(__file__).parent.parent
VARSAYILAN_VERI = KOK / "data" / "demonstrations" / "demos.npz"
VARSAYILAN_CIKTI = KOK / "models" / "ppo_pretrained.zip"

# PPO ile BC ayni mimariyi kullanmali ki agirliklar anlamli olsun.
# SB3'un varsayilan aktivasyonu Tanh; train_bc.py ReLU kullaniyor —
# karsilastirmalarin anlamli olmasi icin ikisini esitliyoruz.
AG_MIMARISI = dict(pi=[128, 128], vf=[128, 128])


class SahteEnv(gym.Env):
    """Sadece PPO nesnesini olusturmak icin gereken bos environment.

    PPO bir env ister ama on-egitim asamasinda hicbir adim atmiyoruz;
    Minecraft'a baglanmaya gerek kalmasin diye sahte bir env veriyoruz.
    """

    def __init__(self) -> None:
        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(GOZLEM_BOYUTU,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(len(AKSIYONLAR))

    def reset(self, *, seed=None, options=None):
        return np.zeros(GOZLEM_BOYUTU, dtype=np.float32), {}

    def step(self, action):
        return np.zeros(GOZLEM_BOYUTU, dtype=np.float32), 0.0, False, False, {}


def sinif_agirliklari(y: np.ndarray) -> torch.Tensor:
    sayim = np.bincount(y, minlength=len(AKSIYONLAR)).astype(np.float32)
    sayim[sayim == 0] = 1.0
    return torch.as_tensor(sayim.sum() / (len(AKSIYONLAR) * sayim), dtype=torch.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--veri", type=Path, default=VARSAYILAN_VERI)
    ap.add_argument("--cikti", type=Path, default=VARSAYILAN_CIKTI)
    ap.add_argument("--epoch", type=int, default=80)
    ap.add_argument("--yigin", type=int, default=256)
    ap.add_argument("--ogrenme-orani", type=float, default=1e-3)
    args = ap.parse_args()

    if not args.veri.exists():
        raise SystemExit(
            f"Veri yok: {args.veri}\nOnce demo topla: python collect_demos.py --bolum 40"
        )

    d = np.load(args.veri)
    # Kayitli veri HAM gozlem iceriyor; agin gordugu bicime cevir
    X = torch.as_tensor(zenginlestir(d["gozlemler"]), dtype=torch.float32)
    y = torch.as_tensor(d["aksiyonlar"], dtype=torch.long)
    print(f"{len(X)} ornek yuklendi")

    model = PPO(
        "MlpPolicy",
        SahteEnv(),
        policy_kwargs=dict(net_arch=AG_MIMARISI, activation_fn=nn.ReLU),
        verbose=0,
        device="cpu",
    )

    politika = model.policy
    iyilestirici = torch.optim.Adam(politika.parameters(), lr=args.ogrenme_orani)
    kayip_fn = nn.CrossEntropyLoss(weight=sinif_agirliklari(d["aksiyonlar"]))

    # KARISTIRARAK bol.
    #
    # Onceden ilk %80 egitim, son %20 dogrulama aliniyordu — sirayi bozmadan.
    # Veri bolum bolum kaydedildigi icin son %20 tamamen farkli turlardan
    # olusuyor ve o turlar ormanin tukenmis kisminda gecmis olabiliyor.
    # Ag bir dagilimda egitilip baska bir dagilimda sinaniyordu: ayni veriyle
    # train_bc.py %61 alirken burasi %33 aliyordu.
    olcut = torch.Generator().manual_seed(0)
    sira = torch.randperm(len(X), generator=olcut)
    X, y = X[sira], y[sira]

    kesme = int(len(X) * 0.8)
    Xe, ye, Xd, yd = X[:kesme], y[:kesme], X[kesme:], y[kesme:]

    # EN IYI agirliklari sakla.
    # Dogrulama basarisi 20-40. epoch'ta tepe yapip sonra dusuyor (ezberleme).
    # Son epoch'un agirliklarini almak, en iyi noktayi kacirmak demek.
    import copy
    en_iyi_basari = -1.0
    en_iyi_agirlik = None

    for epoch in range(1, args.epoch + 1):
        politika.set_training_mode(True)
        sira = torch.randperm(len(Xe))

        for i in range(0, len(sira), args.yigin):
            idx = sira[i : i + args.yigin]
            iyilestirici.zero_grad()
            # SB3 politikasindan ham aksiyon skorlarini al
            ozellik = politika.extract_features(Xe[idx])
            gizli, _ = politika.mlp_extractor(ozellik)
            skor = politika.action_net(gizli)
            kayip = kayip_fn(skor, ye[idx])
            kayip.backward()
            iyilestirici.step()

        # Her epoch'ta olc — en iyiyi kacirmamak icin
        politika.set_training_mode(False)
        with torch.no_grad():
            ozellik = politika.extract_features(Xd)
            gizli, _ = politika.mlp_extractor(ozellik)
            skor = politika.action_net(gizli)
            basari = (skor.argmax(1) == yd).float().mean().item()

        # Isinma: ilk epoch'lar kucuk dogrulama kumesinde sansa yuksek skor
        # alabiliyor ama ag henuz egitilmemis oluyor. En iyiyi ancak makul
        # bir egitimden sonra aramaya basla.
        isinma = max(10, args.epoch // 5)
        if epoch >= isinma and basari > en_iyi_basari:
            en_iyi_basari = basari
            en_iyi_agirlik = copy.deepcopy(politika.state_dict())
            en_iyi_epoch = epoch

        if epoch % 20 == 0 or epoch == 1:
            print(f"epoch {epoch:3d}  dogrulama basarisi {basari * 100:.1f}%")

    if en_iyi_agirlik is not None:
        politika.load_state_dict(en_iyi_agirlik)
        print(f"\nEn iyi agirliklar geri yuklendi "
              f"(epoch {en_iyi_epoch}, %{en_iyi_basari * 100:.1f})")

    args.cikti.parent.mkdir(parents=True, exist_ok=True)
    model.save(args.cikti)
    print(f"On-egitilmis PPO modeli kaydedildi -> {args.cikti}")
    print("Simdi:  python train_ppo.py --baslangic models/ppo_pretrained.zip")


if __name__ == "__main__":
    main()
