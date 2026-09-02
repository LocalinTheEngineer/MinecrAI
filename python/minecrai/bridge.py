"""Node tarafindaki Mineflayer botuna baglanan WebSocket istemcisi.

Bu dosya Minecraft hakkinda hicbir sey bilmez; sadece JSON gonderir/alir.
Protokol: bot/bridge/protocol.md
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict

from websocket import WebSocket, create_connection


class BridgeConnectionError(RuntimeError):
    """Kopruye baglanilamadiginda atilir."""


class BridgeClient:
    """Node koprusuyle konusan ince bir istemci."""

    def __init__(
        self,
        url: str = "ws://localhost:8765",
        # Maden gorevinde reset merdiven kaziyor: tek cagri dakikalara
        # cikabiliyor. 60 sn yetmedi ve egitim soket zaman asimiyla dustu.
        timeout: float = 180.0,
        retries: int = 20,
        retry_delay: float = 1.5,
    ) -> None:
        self.url = url
        self.timeout = timeout
        self._ws: WebSocket | None = None
        self._connect(retries, retry_delay)

    def _connect(self, retries: int, delay: float) -> None:
        son_hata: Exception | None = None
        for deneme in range(retries):
            try:
                self._ws = create_connection(self.url, timeout=self.timeout)
                return
            except Exception as exc:  # noqa: BLE001
                son_hata = exc
                if deneme == 0:
                    print(f"[bridge] {self.url} bekleniyor... (Node koprusu acik mi?)")
                time.sleep(delay)
        raise BridgeConnectionError(
            f"{self.url} adresine {retries} denemede baglanilamadi. "
            f"Once 'npm run bridge' calistir. Son hata: {son_hata}"
        )

    def _cagir(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if self._ws is None:
            raise BridgeConnectionError("Baglanti kapali.")
        self._ws.send(json.dumps(payload))
        cevap = json.loads(self._ws.recv())
        if "error" in cevap:
            raise RuntimeError(f"Node tarafi hata verdi: {cevap['error']}")
        return cevap

    # ------------------------------------------------------------------ API

    def reset(
        self, gorev: str | None = None, genis_gozlem: bool | None = None
    ) -> Dict[str, Any]:
        istek: Dict[str, Any] = {"cmd": "reset"}
        if gorev:
            istek["gorev"] = gorev
        # Gozlem genisligini HER reset'te bildiriyoruz. Cok gorevli egitimde
        # gorev bolumden bolume degisiyor ve genislik sabit kalmak zorunda;
        # tek sefer soylemek, arada baglanti kopunca sessizce kayardi.
        if genis_gozlem is not None:
            istek["genisGozlem"] = bool(genis_gozlem)
        return self._cagir(istek)

    def step(self, action: int) -> Dict[str, Any]:
        return self._cagir({"cmd": "step", "action": int(action)})

    def expert(self) -> Dict[str, Any]:
        return self._cagir({"cmd": "expert"})

    def close(self) -> None:
        if self._ws is None:
            return
        try:
            self._cagir({"cmd": "close"})
        except Exception:  # noqa: BLE001
            pass
        finally:
            self._ws.close()
            self._ws = None
