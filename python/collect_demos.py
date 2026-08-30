"""Milestone 3, adim 1: uzmandan demo verisi topla.

Uzman politika (bot/bridge/expert.js) gorevi zaten dogru yapiyor. Onu
calistirip her adimda iki seyi kaydediyoruz:

    gozlem (12 sayi)  ->  uzmanin sectigi aksiyon (0-4)

Ortaya cikan veri seti artik bir RL problemi degil, duz bir siniflandirma
problemi: "bu duruma bak, uzman ne yapardi?"

Kullanim:
    1) Minecraft sunucusunu baslat
    2) npm run bridge
    3) python collect_demos.py --bolum 30
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np

from minecrai import MinecraftEnv
from minecrai.env import AKSIYONLAR

VARSAYILAN_CIKTI = Path(__file__).parent.parent / "data" / "demonstrations" / "demos.npz"


def _kaydet(cikti: Path, gozlemler, aksiyonlar, oduller, odunlar) -> None:
    cikti.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cikti,
        gozlemler=np.asarray(gozlemler, dtype=np.float32),
        aksiyonlar=np.asarray(aksiyonlar, dtype=np.int64),
        bolum_odulleri=np.asarray(oduller, dtype=np.float32),
        bolum_odunlari=np.asarray(odunlar, dtype=np.int32),
    )


def topla(
    env: MinecraftEnv,
    bolum_sayisi: int,
    maks_adim: int,
    cikti: Path,
    gurultu: float = 0.0,
    tohum: int = 0,
):
    """Uzmani calistirip (gozlem, uzman_aksiyonu) ciftlerini kaydeder.

    gurultu > 0 ise bazen uzmanin dedigi yerine RASTGELE bir aksiyon uygulanir
    ama etiket olarak yine UZMANIN aksiyonu kaydedilir.

    Bu kasitli: uzman hicbir zaman hata yapmadigi icin demolar hep "her sey
    yolunda" durumlarindan olusuyor. Ajan calisirken kacinilmaz olarak
    uzmanin hic gormedigi durumlara dusuyor ve ne yapacagini bilemiyor
    (covariate shift). Gurultu, "isler ters gittiginde uzman ne yapardi"
    orneklerini uretir.
    """
    rng = np.random.default_rng(tohum)
    gozlemler: list[np.ndarray] = []
    aksiyonlar: list[int] = []
    bolum_odulleri: list[float] = []
    bolum_odunlari: list[int] = []

    for bolum in range(bolum_sayisi):
        obs, _ = env.reset()
        toplam_odul = 0.0
        adim = 0

        for adim in range(1, maks_adim + 1):
            aksiyon = env.uzman_aksiyonu()

            # ONEMLI: gozlem, aksiyonun UYGULANMASINDAN ONCEKI durum olmali.
            gozlemler.append(obs.copy())
            aksiyonlar.append(aksiyon)

            # Uygulanan aksiyon bazen rastgele — ama YUKARIDA kaydedilen
            # etiket her zaman uzmanin aksiyonu.
            uygulanan = aksiyon
            if gurultu > 0 and rng.random() < gurultu:
                uygulanan = int(rng.integers(env.action_space.n))

            obs, odul, bitti, kesildi, info = env.step(uygulanan)
            toplam_odul += odul
            if bitti or kesildi:
                break

        odun = int(info.get("odun", 0))
        bolum_odulleri.append(toplam_odul)
        bolum_odunlari.append(odun)

        # HER BOLUM SONUNDA kaydet. Toplama uzun surer ve yarida kesilirse
        # (Ctrl+C, zaman asimi, sunucu kopmasi) o ana kadarki veri durur.
        _kaydet(cikti, gozlemler, aksiyonlar, bolum_odulleri, bolum_odunlari)

        print(
            f"bolum {bolum + 1:3d}/{bolum_sayisi}  "
            f"adim={adim:4d}  odun={odun:2d}  odul={toplam_odul:+7.2f}  "
            f"toplam ornek={len(gozlemler)}"
        )

    return (
        np.asarray(gozlemler, dtype=np.float32),
        np.asarray(aksiyonlar, dtype=np.int64),
        np.asarray(bolum_odulleri, dtype=np.float32),
        np.asarray(bolum_odunlari, dtype=np.int32),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bolum", type=int, default=30, help="kac bolum toplanacak")
    ap.add_argument("--maks-adim", type=int, default=300, help="bolum basina adim siniri")
    ap.add_argument("--url", default="ws://localhost:8765")
    ap.add_argument("--cikti", type=Path, default=VARSAYILAN_CIKTI)
    ap.add_argument("--gurultu", type=float, default=0.25,
                    help="bu olasilikla rastgele aksiyon uygula (etiket yine uzmanin)")
    ap.add_argument("--tohum", type=int, default=0)
    ap.add_argument("--gorev", default="odun", choices=["odun", "maden"],
                    help="hangi gorevin demolari toplanacak")
    args = ap.parse_args()

    # Demoları göreve göre AYRI dosyalara yaz. Karıştırmak, iki farklı
    # görevin (gözlem, aksiyon) çiftlerini tek bir ağa aynı etiketmiş gibi
    # göstermek olurdu — "önümde taş var" durumunda odun görevi dolaşmayı,
    # maden görevi kırmayı öğretiyor. Aynı girdi, zıt etiket.
    if args.gorev != "odun" and args.cikti == VARSAYILAN_CIKTI:
        args.cikti = args.cikti.with_name(f"demolar_{args.gorev}.npz")

    env = MinecraftEnv(url=args.url, gorev=args.gorev)
    baslangic = time.time()

    try:
        X, y, odul, odun = topla(
            env, args.bolum, args.maks_adim, args.cikti,
            gurultu=args.gurultu, tohum=args.tohum,
        )
    except KeyboardInterrupt:
        print("\nKesildi — o ana kadarki veri kaydedilmisti.")
        return
    finally:
        env.close()

    print(f"\n{len(X)} ornek kaydedildi -> {args.cikti}")
    print(f"Sure: {time.time() - baslangic:.0f} sn")
    print(f"Bolum basina ortalama odul: {odul.mean():+.2f}")
    print(f"Bolum basina ortalama odun: {odun.mean():.1f}")
    print("\nAksiyon dagilimi:")
    for i, ad in enumerate(AKSIYONLAR):
        adet = int((y == i).sum())
        oran = adet / max(len(y), 1) * 100
        print(f"  {ad:<12} {adet:6d}  ({oran:5.1f}%)")

    if len(set(y.tolist())) < 2:
        print("\nUYARI: veride tek tur aksiyon var — model ogrenecek bir sey bulamaz.")


if __name__ == "__main__":
    main()
