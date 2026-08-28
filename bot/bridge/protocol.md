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

## Gözlem uzayı

Node **16 sayı** gönderir. Python tarafı bunlara 3 türetilmiş sayı ekleyip
ağa **19 boyut** verir (`minecrai/env.py` → `zenginlestir`):

| # | Türetilmiş |
|---|---|
| 16 | Hedefin egosentrik açısı / π (işaretli: sol pozitif) |
| 17 | sin(açı) |
| 18 | cos(açı) — 1 = tam önümde |

Neden: ham gözlem hedefin yönünü *dünya* koordinatlarında, bakış açısını ayrı
veriyor. "Sağımda mı solumda mı" sorusu bu ikisinden `atan2` ile hesaplanıyor —
küçük bir ağ için zor. Açıyı hazır verince dönüş kararı tek sayının işaretinden
okunuyor. Bu bilgi ham gözlemde zaten var, o yüzden eski kayıtlara da geriye
dönük uygulanabiliyor.

## Ham gözlem (Node → Python, 16 boyut)

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
| 12  | Önüm kapalı mı (0/1) |
| 13  | Solum kapalı mı (0/1) |
| 14  | Sağım kapalı mı (0/1) |
| 15  | Önümde zıplanabilir basamak var mı (0/1) |

13-15 numaralı sayılar uzmanın kararlarını **açıklanabilir** kılmak için var.
Uzman tıkandığında bir yöne dönmek zorunda; o yön rastgele seçilirse karar
hiçbir gözlemden öğrenilemez. Ölçtük: doğrulama başarısı %88'den %52'ye
düşüyor. Yön "açık olan taraf" diye tanımlanınca gözlemden türetilebilir
hale geliyor.

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
