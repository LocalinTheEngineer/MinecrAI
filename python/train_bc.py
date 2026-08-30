"""Milestone 3, adim 2: taklit ederek ogrenme (behaviour cloning).

collect_demos.py ile toplanan (gozlem, aksiyon) ciftlerini kullanarak bir
sinir agini uzmani taklit etmesi icin egitir. Burada Minecraft'a hic
baglanmiyoruz — bu asama tamamen cevrimdisi.

Kullanim:
    python train_bc.py --epoch 60
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from minecrai.yollar import yollar
from minecrai.policy import PolitikaAgi, kaydet
from minecrai.env import AKSIYONLAR
from minecrai import zenginlestir

KOK = Path(__file__).parent.parent
VARSAYILAN_VERI = KOK / "data" / "demonstrations" / "demos.npz"
VARSAYILAN_MODEL = KOK / "models" / "bc_policy.pt"
VARSAYILAN_GRAFIK = KOK / "models" / "bc_egitim.png"


def veriyi_bol(X, y, dogrulama_orani=0.2, tohum=0):
    rng = np.random.default_rng(tohum)
    sira = rng.permutation(len(X))
    kesme = int(len(X) * (1 - dogrulama_orani))
    egitim, dogrulama = sira[:kesme], sira[kesme:]
    return X[egitim], y[egitim], X[dogrulama], y[dogrulama]


def sinif_agirliklari(y: np.ndarray) -> torch.Tensor:
    """Uzman cogu adimda ayni seyi yapiyorsa model o aksiyona saplanir.

    Az goruleni daha agir tartarak dengeliyoruz.
    """
    sayim = np.bincount(y, minlength=len(AKSIYONLAR)).astype(np.float32)
    sayim[sayim == 0] = 1.0
    agirlik = sayim.sum() / (len(AKSIYONLAR) * sayim)
    return torch.as_tensor(agirlik, dtype=torch.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gorev", default="odun", choices=["odun", "maden"])
    ap.add_argument("--veri", type=Path, default=None)
    ap.add_argument("--model", type=Path, default=None)
    ap.add_argument("--grafik", type=Path, default=None)
    ap.add_argument("--epoch", type=int, default=60)
    ap.add_argument("--yigin", type=int, default=256)
    ap.add_argument("--ogrenme-orani", type=float, default=1e-3)
    args = ap.parse_args()

    # Yollar göreve göre. Odun mevcut adları korur (geriye dönük uyum),
    # maden '_maden' ekiyle ayrılır — biri diğerinin modelini ezmesin.
    y = yollar(args.gorev)
    if args.veri is None:
        args.veri = y["veri"]
    if args.model is None:
        args.model = y["bc_model"]
    if args.grafik is None:
        args.grafik = y["bc_grafik"]

    if not args.veri.exists():
        raise SystemExit(
            f"Veri bulunamadi: {args.veri}\n"
            "Once demo topla:  python collect_demos.py --bolum 30"
        )

    d = np.load(args.veri)
    # Kayitli veri HAM gozlem iceriyor; agin gordugu bicime cevir.
    # Turetilmis ozellikler ham veriden hesaplanabildigi icin eski kayitlar
    # yeniden toplanmadan kullanilabiliyor.
    X, y = zenginlestir(d["gozlemler"]), d["aksiyonlar"]
    print(f"{len(X)} ornek yuklendi, gozlem boyutu {X.shape[1]}")

    Xe, ye, Xd, yd = veriyi_bol(X, y)
    Xe_t = torch.as_tensor(Xe); ye_t = torch.as_tensor(ye)
    Xd_t = torch.as_tensor(Xd); yd_t = torch.as_tensor(yd)

    model = PolitikaAgi()
    iyilestirici = torch.optim.Adam(model.parameters(), lr=args.ogrenme_orani)
    kayip_fn = nn.CrossEntropyLoss(weight=sinif_agirliklari(ye))

    gecmis = {"egitim_kayip": [], "dogrulama_kayip": [], "dogrulama_basari": []}

    for epoch in range(1, args.epoch + 1):
        model.train()
        sira = torch.randperm(len(Xe_t))
        toplam = 0.0

        for i in range(0, len(sira), args.yigin):
            idx = sira[i : i + args.yigin]
            iyilestirici.zero_grad()
            kayip = kayip_fn(model(Xe_t[idx]), ye_t[idx])
            kayip.backward()
            iyilestirici.step()
            toplam += kayip.item() * len(idx)

        model.eval()
        with torch.no_grad():
            skor = model(Xd_t)
            dogrulama_kayip = kayip_fn(skor, yd_t).item()
            basari = (skor.argmax(1) == yd_t).float().mean().item()

        gecmis["egitim_kayip"].append(toplam / len(sira))
        gecmis["dogrulama_kayip"].append(dogrulama_kayip)
        gecmis["dogrulama_basari"].append(basari)

        if epoch % 10 == 0 or epoch == 1:
            print(
                f"epoch {epoch:3d}  egitim={gecmis['egitim_kayip'][-1]:.4f}  "
                f"dogrulama={dogrulama_kayip:.4f}  basari={basari * 100:.1f}%"
            )

    kaydet(model, args.model)
    print(f"\nModel kaydedildi -> {args.model}")
    print(f"Son dogrulama basarisi: {gecmis['dogrulama_basari'][-1] * 100:.1f}%")

    _grafik_ciz(gecmis, args.grafik)


def _grafik_ciz(gecmis, yol: Path) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib yok, grafik atlandi.")
        return

    yol.parent.mkdir(parents=True, exist_ok=True)
    fig, (sol, sag) = plt.subplots(1, 2, figsize=(11, 4))

    sol.plot(gecmis["egitim_kayip"], label="egitim")
    sol.plot(gecmis["dogrulama_kayip"], label="dogrulama")
    sol.set_xlabel("epoch"); sol.set_ylabel("kayip")
    sol.set_title("Kayip"); sol.legend(); sol.grid(alpha=0.3)

    sag.plot([b * 100 for b in gecmis["dogrulama_basari"]], color="tab:green")
    sag.set_xlabel("epoch"); sag.set_ylabel("dogruluk (%)")
    sag.set_title("Uzmanla ayni aksiyonu secme orani"); sag.grid(alpha=0.3)

    fig.tight_layout()
    fig.savefig(yol, dpi=130)
    print(f"Grafik kaydedildi -> {yol}")


if __name__ == "__main__":
    main()
