"""Converting demo data into the format the network expects.

This lives in its own file because it used to exist as two copies, one in
`train_bc.py` and one in `pretrain_ppo.py`. Every fix had to be made twice, and
missing one was silent: the two scripts read the same data differently, their
results stop being comparable, and both still look like they work.

Multi-task training (Milestone 6) made the enrichment task-dependent, which
raised the cost of keeping copies even further.
"""

from __future__ import annotations

import numpy as np

from .env import gozlem_boyutu, ham_boyutu, zenginlestirici


def gozlemleri_hazirla(ham, gorev: str = "odun") -> np.ndarray:
    """Converts recorded demo observations into what the network sees.

    It dispatches on the width because `collect_demos` went through a phase of
    recording enriched observations instead of raw ones. Enriching them once
    more on the training side turned the input into 16 -> 19 -> 22 and the net
    died with "mat1 and mat2 shapes cannot be multiplied (256x22 and 19x128)".
    The message was unreadable and re-collecting the data took half an hour.
    Checking the width keeps both old and new files usable.
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

    # Fail loudly instead of corrupting silently: loading 20-number mine data
    # as the wood task gives either an unreadable shape error or, worse,
    # training on the wrong thing without any sign of it.
    raise SystemExit(
        f"Gozlem boyutu {genislik}, '{gorev}' gorevi icin taninmiyor. "
        f"Beklenen {HAM} (ham) veya {GOZLEM} (zenginlestirilmis). "
        "Yanlis --gorev ile mi cagirdin, yoksa veri baska bir gorevden mi?"
    )
