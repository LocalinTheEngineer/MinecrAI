# Köprü Protokolü (Node <-> Python)

Node tarafı bir WebSocket **sunucusu** açar (varsayılan port 8765).
Python tarafı ona **istemci** olarak bağlanır. Mesajlar JSON.

## Python -> Node

```json
{ "cmd": "reset" }
{ "cmd": "step", "action": 3 }
{ "cmd": "expert" }        // uzman bu durumda ne yapardi? (Milestone 3)
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

## Aksiyon uzayı (Discrete(5))

| No | Anlamı |
|----|--------|
| 0  | İleri yürü (0.5 sn) |
| 1  | Sağa dön (22.5°) |
| 2  | Sola dön (22.5°) |
| 3  | Önündeki bloğu kır — kütük varsa kütüğü, yoksa yolu kapatan bloğu (yaprak vb.) |
| 4  | Bekle (no-op) |

Eskiden bir "en yakın ağaca pathfinder ile git" aksiyonu vardı; navigasyonun
tamamını tek adımda yaptığı için kaldırıldı (gerekçe: docs/architecture.md).

**Dönüş açısı 22.5°** — bu değer uzmanın yaw toleransıyla uyumlu olmalı.
Dönüş adımı toleransın iki katından büyükse hedef hiçbir zaman tutturulamaz
ve bot sağa-sola salınır.

**Bakış yatayda sabit.** Ajanın yukarı-aşağı bakma aksiyonu yok; "kır"
aksiyonunun dikey nişanı otomatik yapılır, yatay hizalama ajanın işidir.

## Gözlem uzayı (Box, 13 boyut)

| # | Değer |
|---|-------|
| 0-2 | En yakın kütüğe göreli yön (dx, dy, dz) — normalize |
| 3   | En yakın kütüğe mesafe / 64 |
| 4-5 | yaw / π, pitch / π |
| 6   | Bu bölümde toplanan odun / 5 |
| 7   | Can / 20 |
| 8   | Açlık / 20 |
| 9   | Önünde kırılabilir kütük var mı (0/1) |
| 10  | Ayakları yerde mi (0/1) |
| 11  | Adım sayısı / maxAdim |
| 12  | Yolumu kapatan kırılabilir blok var mı (0/1) |

## Ödül fonksiyonu

```
reward = 1.0  * (yeni toplanan odun)
       + 0.05 * (en yakın kütüğe yaklaşma miktarı, blok cinsinden)
       + 0.20 * (kırılan kütük)
       - 0.01 * (her adım için zaman cezası)
```

Bölüm biter: **bu bölümde** 5 odun toplandığında (terminated) veya 500 adımda
(truncated). Envanterin toplamına değil bölüm başlangıcına göre sayılır —
envanter bölümler arasında sıfırlanmadığı için mutlak sayıya bakmak sonraki
bölümleri tek adımda bitiriyordu.
