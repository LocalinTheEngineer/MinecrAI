"""HIZLI KONTROL — Python tarafi. Minecraft gerekmez, ~20 saniye surer.

NEDEN VAR: `test/smoke.js` Node tarafini koruyor ama Python tarafinda
hicbir ag yoktu. Iki kez ayni sinif hata kullaniciya kaldi:

  - `komut.startsWith('uret ')` (Node) -- kod calisiyordu ama dal hic
    tetiklenmiyordu
  - `NameError: name 'a' is not defined` (Python) -- `train_bc.py` 40
    dakikalik veri toplamanin HEMEN ARDINDAN coktu

Ikisi de `python -m py_compile` ile yakalanmiyor: sozdizimi dogru, hata
calisma aninda. Tek guvenilir yol kodu gercekten CALISTIRMAK.

Bu dosya sentetik veriyle butun egitim scriptlerini bastan sona kosuyor.
Kod degistirdikten sonra:  python test/smoke.py
"""

from __future__ import annotations

import runpy
import sys
import tempfile
from pathlib import Path

import numpy as np

KOK = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KOK / "python"))

hata = 0


def dene(ad, fn):
    global hata
    try:
        fn()
        print(f"  PASS  {ad}")
    except Exception as err:  # noqa: BLE001 - test kosucusu
        print(f"  FAIL  {ad} -> {type(err).__name__}: {err}")
        hata += 1


def sahte_veri(yol: Path, ham_boyut: int, n: int = 400) -> None:
    """Gercekci sekilli sentetik demo dosyasi."""
    rng = np.random.default_rng(0)
    gozlemler = rng.uniform(-1, 1, size=(n, ham_boyut)).astype(np.float32)
    if ham_boyut == 21:  # cok gorevli: son sutun GOREV INDISI, rastgele ondalik degil
        gozlemler[:, -1] = rng.integers(0, 2, n)
    # Her aksiyon en az bir kez gecsin: sinif agirliklari bos sinifta patlar
    aksiyonlar = np.concatenate([
        np.arange(5, dtype=np.int64),
        rng.integers(0, 5, size=n - 5, dtype=np.int64),
    ])
    np.savez(yol, gozlemler=gozlemler, aksiyonlar=aksiyonlar)


def script_kos(ad: str, argv: list[str]) -> None:
    """Bir CLI scriptini gercekten calistir (__main__ olarak)."""
    eski = sys.argv
    sys.argv = [ad] + argv
    try:
        runpy.run_path(str(KOK / "python" / ad), run_name="__main__")
    finally:
        sys.argv = eski


def main() -> None:
    print("Modul yukleme")
    for mod in ["minecrai.env", "minecrai.policy", "minecrai.yollar",
                "minecrai.bridge", "minecrai"]:
        dene(mod, lambda m=mod: __import__(m))

    print("\nGozlem boyutlari")

    def boyutlar():
        from minecrai.env import HAM_BOYUTLARI, ham_boyutu, gozlem_boyutu
        beklenen = {"odun": 16, "maden": 20, "hepsi": 21}
        assert HAM_BOYUTLARI == beklenen, HAM_BOYUTLARI
        for gorev, ham in HAM_BOYUTLARI.items():
            assert ham_boyutu(gorev) == ham
        # odun/maden: ham + 3 turetilmis
        assert gozlem_boyutu("odun") == 19
        assert gozlem_boyutu("maden") == 23
        # hepsi: gorev indisi (1 sayi) one-hot'a (2 sayi) aciliyor
        assert gozlem_boyutu("hepsi") == 25, gozlem_boyutu("hepsi")
    dene("odun 16->19, maden 20->23, hepsi 21->25", boyutlar)

    def zengin_sekli():
        from minecrai.env import ham_boyutu, gozlem_boyutu, zenginlestirici
        for gorev in ("odun", "maden", "hepsi"):
            ham = np.zeros((7, ham_boyutu(gorev)), dtype=np.float32)
            cikti = zenginlestirici(gorev)(ham)
            assert cikti.shape == (7, gozlem_boyutu(gorev)), (gorev, cikti.shape)
    dene("zenginlestirici() her gorevde dogru sekli veriyor", zengin_sekli)

    def gorev_bayragi():
        """Cok gorevli gozlem HANGI GOREVDE oldugunu tasimali.

        Tasimazsa ayni girdiye celiskili etiket dusuyor: "onumde tas var"
        durumunda odun gorevi "dolas", maden gorevi "kir" diyor. Ag ikisinin
        ortalamasini ogrenir, yani hicbirini. Milestone 5b'de bunun baska bir
        bicimini yasadik (donmus gozlem) ve kayip tam ln(4)'te takilmisti.
        """
        from minecrai.env import COKLU_GOREVLER, ham_boyutu, zenginlestir_coklu
        n = ham_boyutu("hepsi")
        cikti = []
        for indis in range(len(COKLU_GOREVLER)):
            ham = np.zeros(n, dtype=np.float32)
            ham[-1] = indis
            g = zenginlestir_coklu(ham)
            cikti.append(g)
            tek = g[-len(COKLU_GOREVLER):]
            assert tek[indis] == 1 and tek.sum() == 1, (indis, tek)
        # Iki gorevin gozlemi BIRBIRINDEN AYIRT EDILEBILIR olmali
        assert not np.array_equal(cikti[0], cikti[1]), "gorevler ayirt edilemiyor"
    dene("cok gorevli gozlem GOREV bilgisini tasiyor", gorev_bayragi)

    print("\nPolitika agi")

    def ag_boyutu():
        import torch
        from minecrai.policy import PolitikaAgi
        for boyut in (19, 23):
            m = PolitikaAgi(gozlem_boyutu=boyut)
            assert m(torch.zeros(3, boyut)).shape == (3, 5)
    dene("PolitikaAgi iki boyutta da calisiyor", ag_boyutu)

    def yukle_cikarimi():
        # `yukle` gozlem boyutunu DOSYADAN okumali; cagirandan istemek
        # sessiz bir hata kaynagi olurdu (yanlis sayi -> anlasilmaz
        # boyut hatasi).
        from minecrai.policy import PolitikaAgi, kaydet, yukle
        with tempfile.TemporaryDirectory() as gecici:
            yol = Path(gecici) / "m.pt"
            kaydet(PolitikaAgi(gozlem_boyutu=23), yol)
            assert yukle(yol).katmanlar[0].in_features == 23
    dene("yukle() boyutu dosyadan cikariyor", yukle_cikarimi)

    print("\nDemo kaydi (celiskili veri uretmiyor mu)")

    def gozlem_her_adimda_degisiyor():
        """EN PAHALI HATAYI yakalayan test.

        `son_ham_gozlem` sadece `reset()`te guncelleniyordu; `step()`te
        degil. `collect_demos.py` her adimda onu kaydettigi icin bir
        bolumun butun ornekleri AYNI gozleme, farkli aksiyonlara sahip
        oluyordu -- 4498 ornekte 30 benzersiz satir. Iki toplama turu
        (~45 dakika) cope gitti.

        Sahte bir kopru kullaniyoruz: Minecraft da Node de gerekmiyor.
        """
        import minecrai.env as env_mod
        from minecrai.env import MinecraftEnv, ham_boyutu

        n = ham_boyutu("maden")

        class SahteKopru:
            def __init__(self):
                self.sayac = 0

            def _gozlem(self):
                self.sayac += 1
                g = np.zeros(n, dtype=np.float32)
                g[0] = self.sayac / 100.0  # her cagride FARKLI
                return g.tolist()

            def reset(self, gorev=None, genis_gozlem=None):
                return {"obs": self._gozlem(), "info": {}}

            def step(self, action):
                return {"obs": self._gozlem(), "reward": 0.0,
                        "terminated": False, "truncated": False, "info": {}}

            def expert(self):
                return {"action": 0}

            def close(self):
                pass

        # Gercek kopruyu sahtesiyle degistir: Minecraft da Node de gerekmiyor.
        gercek = env_mod.BridgeClient
        env_mod.BridgeClient = lambda *a, **k: SahteKopru()
        try:
            env = MinecraftEnv(gorev="maden")
        finally:
            env_mod.BridgeClient = gercek

        env.reset()
        goruldu = [env.son_ham_gozlem.copy()]
        for _ in range(4):
            env.step(0)
            goruldu.append(env.son_ham_gozlem.copy())

        benzersiz = len(np.unique(np.stack(goruldu), axis=0))
        if benzersiz != len(goruldu):
            raise AssertionError(
                f"{len(goruldu)} adimda sadece {benzersiz} benzersiz gozlem -- "
                "son_ham_gozlem step() icinde guncellenmiyor")
    dene("son_ham_gozlem her adimda guncelleniyor", gozlem_her_adimda_degisiyor)

    def saglik_kontrolu_celiskiyi_yakaliyor():
        from collect_demos import veri_sagligi
        rng = np.random.default_rng(0)
        # Saglikli veri: her satir farkli
        iyi = rng.uniform(-1, 1, size=(200, 20)).astype(np.float32)
        assert veri_sagligi(iyi, rng.integers(0, 4, 200)), "saglikli veriyi bozuk saydi"
        # Bozuk veri: 5 benzersiz satir, 200 ornek (gercek hatanin sekli)
        bozuk = np.repeat(iyi[:5], 40, axis=0)
        assert not veri_sagligi(bozuk, rng.integers(0, 4, 200)), \
            "tekrar eden gozlemleri fark etmedi"
    dene("veri_sagligi() celiskili veriyi yakaliyor", saglik_kontrolu_celiskiyi_yakaliyor)

    print("\nCok gorevli ortam (Milestone 6)")

    def coklu_ortam():
        """Tek ajan, iki gorev. Sahte kopru: Minecraft da Node de gerekmiyor.

        Uc sey ayni anda dogru olmali, yoksa cok gorevli egitimin anlami yok:
          1) gozlem genisligi HER bolumde ayni (tek ag, tek girdi boyutu)
          2) gorevler DONUSUMLU (rastgele secim kisa kosularda dengesiz
             dagilim uretip "hangi gorevde daha iyi" karsilastirmasini bozar)
          3) Node'dan GENIS gozlem isteniyor (odun varsayilani dar; istenmezse
             genislik gorevden goreve degisir ve ag coker)
        """
        import minecrai.env as env_mod
        from minecrai.coklu import CokluGorevEnv
        from minecrai.env import ORTAK, EK, gozlem_boyutu

        istekler = []

        class SahteKopru:
            def __init__(self):
                self.sayac = 0

            def _gozlem(self):
                self.sayac += 1
                g = np.zeros(ORTAK + EK, dtype=np.float32)
                g[0] = self.sayac / 100.0
                return g.tolist()

            def reset(self, gorev=None, genis_gozlem=None):
                istekler.append((gorev, genis_gozlem))
                return {"obs": self._gozlem(), "info": {}}

            def step(self, action):
                return {"obs": self._gozlem(), "reward": 0.0,
                        "terminated": False, "truncated": False, "info": {}}

            def expert(self):
                return {"action": 0}

            def close(self):
                pass

        gercek = env_mod.BridgeClient
        env_mod.BridgeClient = lambda *a, **k: SahteKopru()
        try:
            env = CokluGorevEnv()
        finally:
            env_mod.BridgeClient = gercek

        boyutlar, gorevler, gozlemler = set(), [], []
        for _ in range(4):
            o, info = env.reset()
            boyutlar.add(o.shape[0])
            gorevler.append(info["gorev"])
            gozlemler.append(o.copy())
            for _ in range(2):
                o, _, _, _, _ = env.step(0)
                boyutlar.add(o.shape[0])
                gozlemler.append(o.copy())

        if boyutlar != {gozlem_boyutu("hepsi")}:
            raise AssertionError(f"gozlem genisligi degisken: {boyutlar}")
        if gorevler != ["odun", "maden", "odun", "maden"]:
            raise AssertionError(f"gorevler donusumlu degil: {gorevler}")
        if not all(g is True for _, g in istekler):
            raise AssertionError(f"Node'dan genis gozlem istenmedi: {istekler}")

        # Milestone 5b'nin en pahali hatasi burada da olmamali
        benzersiz = len(np.unique(np.stack(gozlemler), axis=0))
        if benzersiz != len(gozlemler):
            raise AssertionError(
                f"{len(gozlemler)} adimda {benzersiz} benzersiz gozlem")

        # Demo kaydi icin ham hal: gorev indisi son sutunda
        if env.son_ham_gozlem.shape != (ORTAK + EK + 1,):
            raise AssertionError(f"ham gozlem sekli {env.son_ham_gozlem.shape}")
    dene("CokluGorevEnv donusumlu, sabit genislikte, gorev bilgili", coklu_ortam)

    def gorev_dayatilabiliyor():
        """Degerlendirmenin dogru olcmesi icin sart olan davranis.

        SESSIZ OLCUM HATASI: `eval_agent` politikalari sirayla kosturuyor
        ve her bolum gorevi bir ilerletiyor. Politika sayisi TEK ise (su an
        5) her politika turdan tura gorev degistiriyor ve dengeli cikiyor --
        ama bu KAZARA. Cift olsaydi (bc modeli bulunamayip 4'e duserse) her
        politika HEP AYNI gorevi alirdi: rastgele ajan hep odun, PPO hep
        maden. Karsilastirma anlamsiz olur ve hicbir belirti vermez.

        Cozum: degerlendirme turun gorevini acikca soyluyor.
        """
        import minecrai.env as env_mod
        from minecrai.coklu import CokluGorevEnv
        from minecrai.env import ORTAK, EK

        class SahteKopru:
            def __init__(self):
                self.sayac = 0

            def _gozlem(self):
                self.sayac += 1
                g = np.zeros(ORTAK + EK, dtype=np.float32)
                g[0] = self.sayac / 100.0
                return g.tolist()

            def reset(self, gorev=None, genis_gozlem=None):
                return {"obs": self._gozlem(), "info": {}}

            def step(self, action):
                return {"obs": self._gozlem(), "reward": 0.0,
                        "terminated": False, "truncated": False, "info": {}}

            def expert(self):
                return {"action": 0}

            def close(self):
                pass

        gercek = env_mod.BridgeClient
        env_mod.BridgeClient = lambda *a, **k: SahteKopru()
        try:
            env = CokluGorevEnv()
        finally:
            env_mod.BridgeClient = gercek

        # Ayni gorev ust uste dayatilabilmeli (donusumlu sira EZILMELI)
        for _ in range(3):
            _, info = env.reset(options={"gorev": "maden"})
            if info["gorev"] != "maden":
                raise AssertionError(f"gorev dayatilamadi: {info['gorev']}")

        # Dayatma olmayinca donusumlu sira surmeli
        ilk = env.reset()[1]["gorev"]
        ikinci = env.reset()[1]["gorev"]
        if ilk == ikinci:
            raise AssertionError("dayatma yokken donusumlu sira calismiyor")

        # Bilinmeyen gorev SESSIZCE kabul edilmemeli
        try:
            env.reset(options={"gorev": "yok_boyle"})
        except ValueError:
            pass
        else:
            raise AssertionError("bilinmeyen gorev sessizce kabul edildi")
    dene("cok gorevli ortamda GOREV dayatilabiliyor", gorev_dayatilabiliyor)

    def ortam_kur_secimi():
        """'hepsi' cok gorevli ortam kurmali, digerleri tekil.

        Bu secim tek yerde (`ortam_kur`) durmali: her scriptte ayri bir if
        olsaydi biri unutulur ve o script sessizce yanlis ortami kurardi.
        """
        import minecrai.env as env_mod
        from minecrai.coklu import CokluGorevEnv, ortam_kur
        from minecrai.env import MinecraftEnv

        class Bos:
            def reset(self, gorev=None, genis_gozlem=None):
                return {"obs": [], "info": {}}

            def close(self):
                pass

        gercek = env_mod.BridgeClient
        env_mod.BridgeClient = lambda *a, **k: Bos()
        try:
            assert isinstance(ortam_kur("ws://x", "hepsi"), CokluGorevEnv)
            for g in ("odun", "maden"):
                e = ortam_kur("ws://x", g)
                assert isinstance(e, MinecraftEnv) and not isinstance(e, CokluGorevEnv)
        finally:
            env_mod.BridgeClient = gercek
    dene("ortam_kur() 'hepsi' icin cok gorevli ortam veriyor", ortam_kur_secimi)

    print("\nEgitim scriptleri (sentetik veriyle, bastan sona)")

    def bc_kos(gorev, ham):
        # ISTE BU, `NameError: name 'a'` hatasini yakalayan test.
        # Script gercekten `main()`ine kadar calisiyor.
        with tempfile.TemporaryDirectory() as gecici:
            g = Path(gecici)
            sahte_veri(g / "d.npz", ham)
            script_kos("train_bc.py", [
                "--gorev", gorev, "--veri", str(g / "d.npz"),
                "--model", str(g / "m.pt"), "--grafik", str(g / "g.png"),
                "--epoch", "2",
            ])
            assert (g / "m.pt").exists(), "model kaydedilmedi"
    dene("train_bc.py --gorev odun", lambda: bc_kos("odun", 16))
    dene("train_bc.py --gorev maden", lambda: bc_kos("maden", 20))
    dene("train_bc.py --gorev hepsi", lambda: bc_kos("hepsi", 21))

    def on_egitim_kos(gorev, ham):
        with tempfile.TemporaryDirectory() as gecici:
            g = Path(gecici)
            sahte_veri(g / "d.npz", ham)
            script_kos("pretrain_ppo.py", [
                "--gorev", gorev, "--veri", str(g / "d.npz"),
                "--cikti", str(g / "p.zip"), "--epoch", "2",
            ])
            assert (g / "p.zip").exists(), "model kaydedilmedi"
    dene("pretrain_ppo.py --gorev odun", lambda: on_egitim_kos("odun", 16))
    dene("pretrain_ppo.py --gorev maden", lambda: on_egitim_kos("maden", 20))
    dene("pretrain_ppo.py --gorev hepsi", lambda: on_egitim_kos("hepsi", 21))

    def yanlis_boyut_yakalaniyor():
        # Sessiz bozulma en pahali hata turu: 20 sayilik maden verisini
        # odun gorevi diye yuklersek net bir hata gormeliyiz.
        from minecrai.veri import gozlemleri_hazirla
        # 20 sayilik maden verisini odun gorevi diye yuklemek: net hata olmali
        try:
            gozlemleri_hazirla(np.zeros((5, 20), np.float32), "odun")
        except SystemExit:
            pass
        else:
            raise AssertionError("yanlis boyut sessizce kabul edildi")
        # train_bc.py hala ayni ismi disa vermeli (eski ice aktarmalar)
        from train_bc import gozlemleri_hazirla as ikinci
        assert ikinci is gozlemleri_hazirla, "kopya fonksiyon geri gelmis"
    dene("yanlis gozlem boyutu SESSIZ gecmiyor", yanlis_boyut_yakalaniyor)

    print("\n=== HEPSI GECTI ===" if hata == 0 else f"\n=== {hata} HATA ===")
    raise SystemExit(0 if hata == 0 else 1)


if __name__ == "__main__":
    main()
