"""Quick check, Python side. No Minecraft needed, takes ~20 seconds.

`test/smoke.js` covers the Node side, but the Python side had no net at all.
The same class of bug reached the user twice:

  - `komut.startsWith('uret ')` (Node) -- the code ran but the branch never
    fired
  - `NameError: name 'a' is not defined` (Python) -- `train_bc.py` crashed
    right after 40 minutes of data collection

Neither is caught by `python -m py_compile`: the syntax is fine, the error is
at runtime. The only reliable way is to actually run the code.

This file runs every training script end to end on synthetic data.
After changing code:  python test/smoke.py
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
    except Exception as err:  # noqa: BLE001 - test runner
        print(f"  FAIL  {ad} -> {type(err).__name__}: {err}")
        hata += 1


def sahte_veri(yol: Path, ham_boyut: int, n: int = 400) -> None:
    """Synthetic demo file with realistic shapes."""
    rng = np.random.default_rng(0)
    gozlemler = rng.uniform(-1, 1, size=(n, ham_boyut)).astype(np.float32)
    if ham_boyut == 21:  # multi-task: last column is the task index, not a random float
        gozlemler[:, -1] = rng.integers(0, 2, n)
    # Every action has to appear at least once: class weights blow up on an empty class
    aksiyonlar = np.concatenate([
        np.arange(5, dtype=np.int64),
        rng.integers(0, 5, size=n - 5, dtype=np.int64),
    ])
    np.savez(yol, gozlemler=gozlemler, aksiyonlar=aksiyonlar)


def script_kos(ad: str, argv: list[str]) -> None:
    """Actually run a CLI script (as __main__)."""
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
        # odun/maden: raw + 3 derived
        assert gozlem_boyutu("odun") == 19
        assert gozlem_boyutu("maden") == 23
        # hepsi: the task index (1 number) expands into a one-hot (2 numbers)
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
        """A multi-task observation has to carry which task it is in.

        Without it the same input gets contradictory labels: in "stone in
        front of me" the odun task says "walk around it", the maden task says
        "break it". The net learns the average of the two, which is neither.
        Milestone 5b hit another form of this (frozen observation) and the
        loss stuck at exactly ln(4).
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
        # The observations of the two tasks have to be distinguishable
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
        # `yukle` has to read the observation size from the file; asking the
        # caller for it would be a silent source of bugs (wrong number ->
        # baffling shape error).
        from minecrai.policy import PolitikaAgi, kaydet, yukle
        with tempfile.TemporaryDirectory() as gecici:
            yol = Path(gecici) / "m.pt"
            kaydet(PolitikaAgi(gozlem_boyutu=23), yol)
            assert yukle(yol).katmanlar[0].in_features == 23
    dene("yukle() boyutu dosyadan cikariyor", yukle_cikarimi)

    print("\nDemo kaydi (celiskili veri uretmiyor mu)")

    def gozlem_her_adimda_degisiyor():
        """The test that catches the most expensive bug so far.

        `son_ham_gozlem` was only updated in `reset()`, not in `step()`. Since
        `collect_demos.py` records it on every step, all the samples of an
        episode had the same observation with different actions -- 30 unique
        rows in 4498 samples. Two collection runs (~45 minutes) were wasted.

        Uses a fake bridge: no Minecraft, no Node.
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
                g[0] = self.sayac / 100.0  # different on every call
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

        # Swap the real bridge for the fake one: no Minecraft, no Node.
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
        # Healthy data: every row different
        iyi = rng.uniform(-1, 1, size=(200, 20)).astype(np.float32)
        assert veri_sagligi(iyi, rng.integers(0, 4, 200)), "saglikli veriyi bozuk saydi"
        # Broken data: 5 unique rows, 200 samples (the shape of the real bug)
        bozuk = np.repeat(iyi[:5], 40, axis=0)
        assert not veri_sagligi(bozuk, rng.integers(0, 4, 200)), \
            "tekrar eden gozlemleri fark etmedi"
    dene("veri_sagligi() celiskili veriyi yakaliyor", saglik_kontrolu_celiskiyi_yakaliyor)

    print("\nCok gorevli ortam (Milestone 6)")

    def coklu_ortam():
        """One agent, two tasks. Fake bridge: no Minecraft, no Node.

        Three things have to hold at once or multi-task training is pointless:
          1) observation width is the same in every episode (one net, one
             input size)
          2) the tasks alternate (random choice gives an uneven split on short
             runs and ruins the "better at which task" comparison)
          3) the wide observation is requested from Node (odun defaults to the
             narrow one; without asking, the width changes from task to task
             and the net collapses)
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

        # Milestone 5b's most expensive bug must not happen here either
        benzersiz = len(np.unique(np.stack(gozlemler), axis=0))
        if benzersiz != len(gozlemler):
            raise AssertionError(
                f"{len(gozlemler)} adimda {benzersiz} benzersiz gozlem")

        # Raw form for demo recording: task index in the last column
        if env.son_ham_gozlem.shape != (ORTAK + EK + 1,):
            raise AssertionError(f"ham gozlem sekli {env.son_ham_gozlem.shape}")
    dene("CokluGorevEnv donusumlu, sabit genislikte, gorev bilgili", coklu_ortam)

    def gorev_dayatilabiliyor():
        """Behaviour evaluation needs in order to measure the right thing.

        Silent measurement error: `eval_agent` runs the policies in order and
        every episode advances the task by one. With an odd policy count
        (currently 5) each policy changes task from round to round and it
        comes out balanced -- but only by accident. With an even count (drop
        to 4 when the bc model is missing) every policy would always get the
        same task: the random agent always odun, PPO always maden. The
        comparison would be meaningless and show no symptom at all.

        Fix: evaluation states the round's task explicitly.
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

        # The same task has to be forceable repeatedly (rotation overridden)
        for _ in range(3):
            _, info = env.reset(options={"gorev": "maden"})
            if info["gorev"] != "maden":
                raise AssertionError(f"gorev dayatilamadi: {info['gorev']}")

        # Without an override the rotation has to carry on
        ilk = env.reset()[1]["gorev"]
        ikinci = env.reset()[1]["gorev"]
        if ilk == ikinci:
            raise AssertionError("dayatma yokken donusumlu sira calismiyor")

        # An unknown task must not be accepted silently
        try:
            env.reset(options={"gorev": "yok_boyle"})
        except ValueError:
            pass
        else:
            raise AssertionError("bilinmeyen gorev sessizce kabul edildi")
    dene("cok gorevli ortamda GOREV dayatilabiliyor", gorev_dayatilabiliyor)

    def ortam_kur_secimi():
        """'hepsi' has to build the multi-task env, the others a single one.

        The choice belongs in one place (`ortam_kur`): with a separate if in
        every script one of them gets forgotten and that script silently
        builds the wrong environment.
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
        # This is the test that catches `NameError: name 'a'`.
        # The script really does run all the way into its `main()`.
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
        # Silent corruption is the most expensive kind of bug: loading
        # 20-number maden data as the odun task has to give a clear error.
        from minecrai.veri import gozlemleri_hazirla
        # loading 20-number maden data as the odun task: has to be a clear error
        try:
            gozlemleri_hazirla(np.zeros((5, 20), np.float32), "odun")
        except SystemExit:
            pass
        else:
            raise AssertionError("yanlis boyut sessizce kabul edildi")
        # train_bc.py still has to export the same name (old imports)
        from train_bc import gozlemleri_hazirla as ikinci
        assert ikinci is gozlemleri_hazirla, "kopya fonksiyon geri gelmis"
    dene("yanlis gozlem boyutu SESSIZ gecmiyor", yanlis_boyut_yakalaniyor)

    print("\n=== HEPSI GECTI ===" if hata == 0 else f"\n=== {hata} HATA ===")
    raise SystemExit(0 if hata == 0 else 1)


if __name__ == "__main__":
    main()
