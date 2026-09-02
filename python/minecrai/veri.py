"""Demo verisini aga verilecek bicime cevirme.

NEDEN AYRI DOSYA: bu fonksiyonun BIRBIRININ KOPYASI iki halde
`train_bc.py` ve `pretrain_ppo.py` icinde duruyordu. Ayni duzeltmeyi iki
kez yapmak zorunda kaldik ve ikincisinde biri unutulsa hata sessiz
olurdu: iki script ayni veriyi farkli yorumlar, sonuclari karsilastirilamaz
hale gelir -- ustelik ikisi de calisir gorunur.

Cok gorevli egitim (Milestone 6) zenginlestirmeyi goreve bagimli yaptigi
icin kopyalari surdurmenin maliyeti daha da artti.
"""

from __future__ import annotations

import numpy as np

from .env import gozlem_boyutu, ham_boyutu, zenginlestirici


def gozlemleri_hazirla(ham, gorev: str = "odun") -> np.ndarray:
    """Kayitli demo gozlemlerini agin gordugu bicime cevirir.

    NEDEN GENISLIGE BAKIP KARAR VERIYOR: `collect_demos` bir donem HAM
    yerine ZENGINLESTIRILMIS gozlem kaydetti. Egitim tarafi ustune bir kez
    daha zenginlestirince girdi 16 -> 19 -> 22 oldu ve ag
    "mat1 and mat2 shapes cannot be multiplied (256x22 and 19x128)" diye
    coktu. Hata mesaji anlasilir degildi ve veriyi yeniden toplamak yarim
    saat aliyordu. Boyuta bakmak hem eski hem yeni dosyalari calistiriyor.
    """
    ham = np.asarray(ham, dtype=np.float32)
    genislik = ham.shape[1]
    HAM = ham_boyutu(gorev)
    GOZLEM = gozlem_boyutu(gorev)

    if genislik == HAM:
        return zenginlestirici(gorev)(ham)
    if genislik == GOZLEM:
        print(f"  (veri zaten zenginlestirilmis: {genislik} boyut, tekrar edilmiyor)")
        return ham

    # SESSIZ BOZULMAYA IZIN YOK.
    #
    # 20 sayilik maden verisini odun gorevi diye yuklemek, ya anlasilmaz bir
    # boyut hatasi ya da -- daha kotusu -- sessizce yanlis egitim demek.
    raise SystemExit(
        f"Gozlem boyutu {genislik}, '{gorev}' gorevi icin taninmiyor. "
        f"Beklenen {HAM} (ham) veya {GOZLEM} (zenginlestirilmis). "
        "Yanlis --gorev ile mi cagirdin, yoksa veri baska bir gorevden mi?"
    )
