"""MinecrAI'nin Gymnasium environment'i.

Standart bir Gym arayuzu sundugu icin stable-baselines3 gibi hazir RL
kutuphaneleri bu environment'i dogrudan egitebilir.

Kullanim:
    from minecrai import MinecraftEnv
    env = MinecraftEnv()
    obs, info = env.reset()
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .bridge import BridgeClient

# Node tarafindan gelen HAM gozlem boyutu — environment.js ile AYNI olmali.
#
# GOREVE GORE DEGISIYOR ve bu bilincli bir karar.
#
# Maden gorevi 4 sayi daha aliyor (dusmus esyanin egosentrik yonu/mesafesi
# ve "onumu kapatan blogu kirabiliyor muyum"). Sebep olculdu: bu bilgiler
# olmadan taklit dogrulugu %25.5 — dort aksiyonda kor tahmin %25, yani ag
# hicbir sey ogrenemiyordu. Uzman adimlarinin %39'unu yere dusmus cevheri
# toplamaya harciyor ve gozlemde esya hakkinda hicbir sey yoktu.
# Ayrinti: bot/bridge/gorevler.js `ekGozlem`.
#
# Odun gorevi 16'da BIRAKILDI: Milestone 4'un egitilmis modelleri
# (bc_policy.pt, ppo_son.zip) 19 boyutlu girdi bekliyor. Gozlemi orada da
# buyutmek calisan, olculmus ve yayinlanmis modelleri yuklenemez hale
# getirirdi — yeni bir gorevi duzeltmek icin odenecek bedel degil.
ORTAK = 16          # her gorevde gonderilen temel sayilar
EK = 4              # gorevler.js EK_GOZLEM: dusmus esya + kirilabilir engel
TURETILEN = 3       # `zenginlestir`: egosentrik hedef acisi

HAM_BOYUTLARI = {"odun": ORTAK, "maden": ORTAK + EK}

# COK GOREVLI (Milestone 6): iki gorev TEK agi paylasiyor.
#
# Iki sart var:
#   1) Gozlem genisligi ortak olmali -> odun da genis gozlem gonderiyor
#      (`genisGozlem: true`), yani ikisi de ORTAK + EK.
#   2) Ag hangi gorevde oldugunu BILMELI. Ayni gozlemde odun gorevi
#      "tasi kirma" derken maden gorevi "kir" diyor; gorev bilgisi olmadan
#      bu iki etiket celisir ve ag ikisinin ortalamasini ogrenir --
#      Milestone 5b'de donmus gozlem yuzunden yasadigimiz seyin aynisi,
#      sadece sebebi farkli.
#
# Ham kayitta gorev, SON SUTUNDA bir indis olarak duruyor (0=odun, 1=maden);
# aga verilirken one-hot'a cevriliyor. Indis olarak saklamak demolari
# okunur tutuyor ve gorev listesi buyurse eski kayitlar hala gecerli.
COKLU_GOREVLER = ["odun", "maden"]
HAM_BOYUTLARI["hepsi"] = ORTAK + EK + 1

GOZLEM_BOYUTLARI = {ad: n + TURETILEN for ad, n in HAM_BOYUTLARI.items()}
# one-hot, ham'daki tek indis sutununun yerini aliyor: +len-1
GOZLEM_BOYUTLARI["hepsi"] = ORTAK + EK + TURETILEN + len(COKLU_GOREVLER)


def ham_boyutu(gorev: str = "odun") -> int:
    return HAM_BOYUTLARI[gorev]


def gozlem_boyutu(gorev: str = "odun") -> int:
    return GOZLEM_BOYUTLARI[gorev]


def genis_gozlem_mi(gorev: str) -> bool:
    """Node'dan EK sayilari da isteyecek miyiz?

    Odun gorevi varsayilan olarak DAR (16): Milestone 4'un egitilmis
    modelleri 19 boyutlu girdi bekliyor ve onlari bozmuyoruz. Cok gorevli
    egitim ise genisligin ortak olmasini zorunlu kildigi icin aciyor.
    """
    return gorev != "odun"


def zenginlestir_coklu(ham: np.ndarray) -> np.ndarray:
    """Cok gorevli ham gozlemi aga verilecek bicime cevirir.

    Girdi : [ORTAK+EK sayi] + [gorev indisi]      (= 21)
    Cikti : [ORTAK+EK sayi] + [turetilmis 3] + [gorev one-hot 2]  (= 25)
    """
    ham = np.asarray(ham, dtype=np.float32)
    gozlem = zenginlestir(ham[..., :-1])
    indis = ham[..., -1].astype(np.int64)
    tek = np.eye(len(COKLU_GOREVLER), dtype=np.float32)[indis]
    return np.concatenate([gozlem, tek], axis=-1)


def zenginlestirici(gorev: str):
    """Goreve uygun zenginlestirme fonksiyonu."""
    return zenginlestir_coklu if gorev == "hepsi" else zenginlestir


# Geriye donuk isimler: odun gorevinin boyutlari. Eski kod bunlari
# dogrudan iceri aliyor (policy.py, pretrain_ppo.py).
HAM_BOYUTU = HAM_BOYUTLARI["odun"]
GOZLEM_BOYUTU = GOZLEM_BOYUTLARI["odun"]


def zenginlestir(ham: np.ndarray) -> np.ndarray:
    """Ham gozleme EGOSENTRIK hedef acisi ekler.

    Ham gozlem hedefin yonunu DUNYA koordinatlarinda veriyor (dx, dy, dz) ve
    botun bakis acisini (yaw) ayri bir sayi olarak. "Hedef sagimda mi solumda
    mi?" sorusunun cevabi bu ikisini birlestirip atan2 hesaplamayi gerektiriyor
    — kucuk bir MLP icin zor bir dogrusal olmayan islem.

    Uzmanin donme karari DOGRUDAN bu aciya bagli. Aciyi hazir verince karar
    tek bir sayinin isaretinden okunabilir hale geliyor. Olctuk: taklit
    dogrulugu belirgin sekilde artiyor.

    Bu bilgi ham gozlemin icinde zaten var; yeni bir sey olcmuyoruz, sadece
    agin kolay kullanabilecegi bicime ceviriyoruz. Bu yuzden eski kayitli
    veriye de geriye donuk uygulanabiliyor.

    Eklenen 3 sayi:
      - aci / pi        : isaretli fark, -1..1 (sol pozitif)
      - sin(aci)        : acinin surekli gosterimi (±pi sinirinda sicrama yok)
      - cos(aci)        : 1 = tam onumde, -1 = tam arkamda
    """
    ham = np.asarray(ham, dtype=np.float32)
    dx, dz = ham[..., 0], ham[..., 2]
    yaw = ham[..., 4] * np.pi

    hedef_yaw = np.arctan2(-dx, -dz)
    fark = hedef_yaw - yaw
    fark = (fark + np.pi) % (2 * np.pi) - np.pi  # -pi..pi araligina indirge

    ek = np.stack([fark / np.pi, np.sin(fark), np.cos(fark)], axis=-1)
    return np.concatenate([ham, ek.astype(np.float32)], axis=-1)

# Aksiyonlar — bot/bridge/protocol.md ile ayni sirada.
#
# NOT: Eskiden bir "agaca_yaklas" aksiyonu vardi; pathfinder'i cagirip
# navigasyonun tamamini tek adimda yapiyordu. Ajan bunu kesfettigi anda
# yurumeyi ogrenmeyi birakip hep ona basacagi icin kaldirildi. Ayrintili
# gerekce: docs/architecture.md
AKSIYONLAR = [
    "ileri_yuru",
    "saga_don",
    "sola_don",
    "blogu_kir",
    "bekle",
]


class MinecraftEnv(gym.Env):
    """Mineflayer botunu bir RL environment'i gibi gosterir."""

    metadata = {"render_modes": ["human"], "render_fps": 2}

    def __init__(
        self,
        url: str = "ws://localhost:8765",
        gorev: str = "odun",
        genis_gozlem: bool | None = None,
    ) -> None:
        self.gorev = gorev
        super().__init__()

        # Node'dan EK sayilari da isteyecek miyiz? None = gorevin varsayilani.
        # Cok gorevli sarmalayici (coklu.py) bunu acikca True yapiyor.
        self.genis_gozlem = (
            genis_gozlem_mi(gorev) if genis_gozlem is None else genis_gozlem
        )

        self.ham_boyutu = ORTAK + (EK if self.genis_gozlem else 0)
        self.gozlem_boyutu = self.ham_boyutu + TURETILEN

        self.action_space = spaces.Discrete(len(AKSIYONLAR))
        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(self.gozlem_boyutu,), dtype=np.float32
        )

        self.bridge = BridgeClient(url)
        self._son_info: Dict[str, Any] = {}

        # HAM gozlem (Node'un gonderdigi 16 sayi), zenginlestirilmeden once.
        #
        # Demo kaydinda ham hali saklamak gerekiyor: `zenginlestir` ham
        # gozlemin saf bir fonksiyonu, yani ilerde turetilmis alanlari
        # degistirirsek eski demolardan yeniden hesaplayabiliyoruz.
        # Zenginlestirilmis hali saklarsak o esneklik kayboluyor -- ve
        # bir kez kaybolmakla kalmadi, egitim tarafi ikinci kez
        # zenginlestirip 19+3=22 boyutlu bir girdi uretti ve ag coktu.
        self.son_ham_gozlem: np.ndarray | None = None
        self.son_uzman_sebep = "?"
        self.son_uzman_tani: Dict[str, Any] = {}

    # ------------------------------------------------------------ Gym API

    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        super().reset(seed=seed)
        # Gorevi HER reset'te bildiriyoruz. Node tarafi degismediyse
        # hicbir sey yapmiyor; degistiyse gecis bolum basinda oluyor.
        # Cok gorevli egitimde bolumden bolume gorev degistirmek boylece
        # ek bir protokol gerektirmiyor.
        cevap = self.bridge.reset(self.gorev, self.genis_gozlem)
        self._son_info = cevap.get("info", {})
        self.son_ham_gozlem = np.asarray(cevap["obs"], dtype=np.float32)
        return self._obs(cevap["obs"]), self._son_info

    def uzman_aksiyonu(self) -> int:
        """Uzman politikanin bu durumda sececeği aksiyon (Milestone 3).

        Ogrenme yok — elle yazilmis kurallar. Amaci taklit edilecek ornegi
        uretmek. Bkz. bot/bridge/expert.js
        """
        cevap = self.bridge.expert()
        self.son_uzman_sebep = cevap.get("sebep", "?")
        self.son_uzman_tani = cevap.get("tani", {})
        return int(cevap["action"])

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        cevap = self.bridge.step(int(action))
        self._son_info = cevap.get("info", {})

        # HAM GOZLEMI BURADA DA GUNCELLE.
        #
        # Bu satir bir sure eksikti ve iki demo toplama turunu (toplam
        # ~45 dakika) cope attirdi. `son_ham_gozlem` sadece `reset()`te
        # yaziliyordu, yani BOLUM BOYUNCA reset anindaki degerde
        # donuyordu. `collect_demos.py` her adimda onu kaydettigi icin
        # bir bolumun butun ornekleri AYNI gozleme, farkli aksiyonlara
        # sahip oluyordu.
        #
        # Olcum: 4498 ornekte sadece 30 benzersiz gozlem satiri vardi --
        # tam olarak bolum sayisi kadar. Orneklerin %100'u celiskiliydi.
        # Boyle bir veriyle ulasilabilecek en iyi dogruluk cogunluk
        # sinifi (%33.2); taklit egitimi %30.7 aliyordu ve kayip tam
        # ln(4)=1.386'da duruyordu -- yani ag dort aksiyona esit
        # olasilik dagitmayi ogrenmisti, baska bir sey degil.
        #
        # Ders: "ag ogrenemiyor" dendiginde once VERIYE bakilir. Ozellik
        # eklemek makul bir hipotezdi ama olculmemisti ve bir tur daha
        # veri toplamaya mal oldu. Veriyi acmak iki dakika surdu.
        self.son_ham_gozlem = np.asarray(cevap["obs"], dtype=np.float32)

        return (
            self._obs(cevap["obs"]),
            float(cevap["reward"]),
            bool(cevap["terminated"]),
            bool(cevap["truncated"]),
            self._son_info,
        )

    def render(self) -> None:
        odun = self._son_info.get("odun", 0)
        adim = self._son_info.get("adim", 0)
        print(f"adim={adim:4d}  odun={odun}")

    def close(self) -> None:
        self.bridge.close()

    # ------------------------------------------------------------ yardimci

    def _obs(self, ham) -> np.ndarray:
        dizi = np.asarray(ham, dtype=np.float32)
        if dizi.shape != (self.ham_boyutu,):
            raise ValueError(
                f"Ham gozlem boyutu {dizi.shape}, '{self.gorev}' gorevi icin "
                f"beklenen ({self.ham_boyutu},). environment.js ile env.py "
                "uyusmuyor olabilir."
            )
        return np.clip(zenginlestir(dizi), -1.0, 1.0)
