# Köprü Protokolü (Node <-> Python)

Node tarafı bir WebSocket **sunucusu** açar (varsayılan port 8765).
Python tarafı ona **istemci** olarak bağlanır. Mesajlar JSON.

## Python -> Node

```json
{ "cmd": "reset" }
{ "cmd": "step", "action": 3 }
{ "cmd": "close" }
```

## Node -> Python

```json
{
  "obs":        [ ...sayılar... ],
  "reward":     0.0,
  "terminated": false,
  "truncated":  false,
  "info":       { "odun": 0, "adim": 12 }
}
```

## Aksiyon uzayı (Discrete(6))

| No | Anlamı |
|----|--------|
| 0  | İleri yürü (0.5 sn) |
| 1  | Sağa dön (45°) |
| 2  | Sola dön (45°) |
| 3  | Baktığı bloğu kır |
| 4  | En yakın kütüğe doğru bir adım at (pathfinder) |
| 5  | Bekle (no-op) |

## Gözlem uzayı (Box, 12 boyut)

| # | Değer |
|---|-------|
| 0-2 | En yakın kütüğe göreli yön (dx, dy, dz) — normalize |
| 3   | En yakın kütüğe mesafe / 64 |
| 4-5 | yaw / π, pitch / π |
| 6   | Envanterdeki odun / 16 |
| 7   | Can / 20 |
| 8   | Açlık / 20 |
| 9   | Baktığı blok kütük mü (0/1) |
| 10  | Ayakları yerde mi (0/1) |
| 11  | Adım sayısı / maxAdim |

## Ödül fonksiyonu

```
reward = 1.0  * (yeni toplanan odun)
       + 0.05 * (en yakın kütüğe yaklaşma miktarı, blok cinsinden)
       + 0.20 * (kırılan kütük)
       - 0.01 * (her adım için zaman cezası)
```

Bölüm biter: 5 odun toplandığında (terminated) veya 500 adımda (truncated).
