"""Milestone 4, step 1: hand the BC weights over to PPO (warm start).

Why: PPO from scratch behaves randomly, and since every step in Minecraft
takes ~0.4 seconds it takes hours to see the first meaningful behaviour. A
policy that already imitates the expert exists, so starting PPO from there
makes learning useful much sooner.

Technical point: train_bc.py trains its own small net while Stable-Baselines3
uses its own policy object, and copying weights across by hand is fragile.
Instead SB3's policy is trained supervised right here. The .zip that comes out
is in the format PPO understands.

Usage (no Minecraft connection needed):
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

from minecrai.yollar import yollar
from minecrai.env import GOZLEM_BOYUTU, AKSIYONLAR
from minecrai import zenginlestir

KOK = Path(__file__).parent.parent
VARSAYILAN_VERI = KOK / "data" / "demonstrations" / "demos.npz"
VARSAYILAN_CIKTI = KOK / "models" / "ppo_pretrained.zip"

# PPO and BC have to use the same architecture for the weights to mean
# anything. SB3 defaults to Tanh activation and train_bc.py uses ReLU, so the
# two are matched here.
AG_MIMARISI = dict(pi=[128, 128], vf=[128, 128])


class SahteEnv(gym.Env):
    """Empty environment, needed only to construct the PPO object.

    PPO wants an env, but pre-training never takes a step; the fake one saves
    having to connect to Minecraft.
    """

    def __init__(self, boyut: int = GOZLEM_BOYUTU) -> None:
        self.boyut = boyut
        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(boyut,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(len(AKSIYONLAR))

    def reset(self, *, seed=None, options=None):
        return np.zeros(self.boyut, dtype=np.float32), {}

    def step(self, action):
        return np.zeros(self.boyut, dtype=np.float32), 0.0, False, False, {}


def sinif_agirliklari(y: np.ndarray) -> torch.Tensor:
    sayim = np.bincount(y, minlength=len(AKSIYONLAR)).astype(np.float32)
    sayim[sayim == 0] = 1.0
    return torch.as_tensor(sayim.sum() / (len(AKSIYONLAR) * sayim), dtype=torch.float32)


from minecrai.veri import gozlemleri_hazirla  # see minecrai/veri.py


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gorev", default="odun", choices=["odun", "maden", "hepsi"])
    ap.add_argument("--veri", type=Path, default=None)
    ap.add_argument("--cikti", type=Path, default=None)
    ap.add_argument("--epoch", type=int, default=80)
    ap.add_argument("--yigin", type=int, default=256)
    ap.add_argument("--ogrenme-orani", type=float, default=1e-3)
    args = ap.parse_args()

    y = yollar(args.gorev)
    if args.veri is None:
        args.veri = y["veri"]
    if args.cikti is None:
        args.cikti = y["ppo_on"]

    if not args.veri.exists():
        raise SystemExit(
            f"Veri yok: {args.veri}\nOnce demo topla: python collect_demos.py --bolum 40"
        )

    d = np.load(args.veri)
    # Saved data holds raw observations; convert to the form the net sees
    from minecrai.env import gozlem_boyutu
    GOZLEM = gozlem_boyutu(args.gorev)
    X = torch.as_tensor(
        gozlemleri_hazirla(d["gozlemler"], args.gorev), dtype=torch.float32
    )
    y = torch.as_tensor(d["aksiyonlar"], dtype=torch.long)
    print(f"{len(X)} ornek yuklendi")

    model = PPO(
        "MlpPolicy",
        SahteEnv(GOZLEM),
        policy_kwargs=dict(net_arch=AG_MIMARISI, activation_fn=nn.ReLU),
        verbose=0,
        device="cpu",
    )

    politika = model.policy
    iyilestirici = torch.optim.Adam(politika.parameters(), lr=args.ogrenme_orani)
    kayip_fn = nn.CrossEntropyLoss(weight=sinif_agirliklari(d["aksiyonlar"]))

    # Shuffle before splitting.
    #
    # It used to take the first 80% as training and the last 20% as
    # validation, in order. Data is saved episode by episode, so the last 20%
    # comes from entirely different runs, which may have happened in a part of
    # the forest that was already used up. The net was trained on one
    # distribution and tested on another: on the same data train_bc.py scored
    # 61% while this scored 33%.
    olcut = torch.Generator().manual_seed(0)
    sira = torch.randperm(len(X), generator=olcut)
    X, y = X[sira], y[sira]

    kesme = int(len(X) * 0.8)
    Xe, ye, Xd, yd = X[:kesme], y[:kesme], X[kesme:], y[kesme:]

    # Keep the best weights.
    # Validation accuracy peaks around epoch 20-40 and drops after that
    # (overfitting). Taking the last epoch's weights misses the best point.
    import copy
    en_iyi_basari = -1.0
    en_iyi_agirlik = None

    for epoch in range(1, args.epoch + 1):
        politika.set_training_mode(True)
        sira = torch.randperm(len(Xe))

        for i in range(0, len(sira), args.yigin):
            idx = sira[i : i + args.yigin]
            iyilestirici.zero_grad()
            # raw action scores from the SB3 policy
            ozellik = politika.extract_features(Xe[idx])
            gizli, _ = politika.mlp_extractor(ozellik)
            skor = politika.action_net(gizli)
            kayip = kayip_fn(skor, ye[idx])
            kayip.backward()
            iyilestirici.step()

        # Measure every epoch so the best one is not missed
        politika.set_training_mode(False)
        with torch.no_grad():
            ozellik = politika.extract_features(Xd)
            gizli, _ = politika.mlp_extractor(ozellik)
            skor = politika.action_net(gizli)
            basari = (skor.argmax(1) == yd).float().mean().item()

        # Warm-up: the first epochs can score high on the small validation set
        # by luck while the net is still untrained. Only start looking for the
        # best after a reasonable amount of training.
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
    # Print the command per task. It was hard-coded and pointed at the wrong
    # file for the maden task -- copy-pasting it started maden training with
    # the odun model, which is very hard to spot.
    print("")
    print("Simdi:  python train_ppo.py --gorev " + args.gorev +
          " --baslangic ../models/" + args.cikti.name)


if __name__ == "__main__":
    main()
