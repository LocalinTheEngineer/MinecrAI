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
        assert HAM_BOYUTLARI == {"odun": 16, "maden": 20}, HAM_BOYUTLARI
        for gorev, ham in HAM_BOYUTLARI.items():
            assert ham_boyutu(gorev) == ham
            assert gozlem_boyutu(gorev) == ham + 3
    dene("odun 16->19, maden 20->23", boyutlar)

    def zengin_sekli():
        from minecrai.env import zenginlestir, ham_boyutu, gozlem_boyutu
        for gorev in ("odun", "maden"):
            ham = np.zeros((7, ham_boyutu(gorev)), dtype=np.float32)
            assert zenginlestir(ham).shape == (7, gozlem_boyutu(gorev))
    dene("zenginlestir() her gorevde dogru sekli veriyor", zengin_sekli)

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

            def reset(self, gorev=None):
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

    def yanlis_boyut_yakalaniyor():
        # Sessiz bozulma en pahali hata turu: 20 sayilik maden verisini
        # odun gorevi diye yuklersek net bir hata gormeliyiz.
        from train_bc import gozlemleri_hazirla
        try:
            gozlemleri_hazirla(np.zeros((5, 20), np.float32), 16, 19)
        except SystemExit:
            return
        raise AssertionError("yanlis boyut sessizce kabul edildi")
    dene("yanlis gozlem boyutu SESSIZ gecmiyor", yanlis_boyut_yakalaniyor)

    print("\n=== HEPSI GECTI ===" if hata == 0 else f"\n=== {hata} HATA ===")
    raise SystemExit(0 if hata == 0 else 1)


if __name__ == "__main__":
    main()
