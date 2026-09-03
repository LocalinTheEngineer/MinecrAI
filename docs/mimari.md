# Mimari — Bu Sistem Nasıl Çalışıyor?

Bu dosya "neden böyle yaptık"ı anlatır. Kod okumadan önce burayı oku.

---

## 1. Temel problem

RL (pekiştirmeli öğrenme) algoritmaları çok basit bir döngü ister:

```
gözlem al → aksiyon seç → aksiyonu uygula → ödül ve yeni gözlem al → tekrarla
```

Minecraft ise bu döngüye hiç uymuyor:

- **Sürekli akıyor.** Sen düşünürken oyun durmuyor. RL ise "sıra sende, sıra bende"
  şeklinde adım adım ilerler.
- **Aksiyonlar zaman alıyor.** "İleri yürü" bir anda olmaz, saniyeler sürer.
- **Gözlem devasa.** Bütün dünyayı bir vektöre sığdıramazsın.

Projenin asıl işi, botu yazmak değil — **Minecraft'ı RL'in anlayacağı şekle
sokmak.** Kodun mimarisi tamamen bunun etrafında kurulu.

---

## 2. Neden iki dil?

| | Node.js | Python |
|---|---|---|
| Minecraft'a bağlanma | **Mineflayer** — bu iş için tek olgun kütüphane | zayıf/bakımsız |
| RL | neredeyse yok | **Gymnasium, PyTorch, Stable-Baselines3** |

İkisini de tek dilde yapmaya çalışmak, iyi olan tarafı kaybetmek demek.
Bu yüzden her iki tarafı da kendi dilinde bırakıp aralarına **dar bir sözleşme**
koyuyoruz: WebSocket üzerinden JSON.

Sözleşme tek dosyada tanımlı: [`bot/bridge/protocol.md`](../bot/bridge/protocol.md).
Bir taraf değişse bile diğeri, sözleşme bozulmadıkça çalışmaya devam eder.
Bu, mülakatta "sistem tasarımı" diye anlatacağın şeyin ta kendisi.

---

## 3. Katmanlar

```
python/minecrai/env.py        ← RL algoritması sadece burayı görür (gym.Env)
        │  reset() / step(action)
        ▼
python/minecrai/bridge.py     ← WebSocket istemcisi, sadece JSON gönderir
        │  {"cmd":"step","action":3}
        ▼  ~~~~~~~~ ağ sınırı ~~~~~~~~
bot/bridge/server.js          ← WebSocket sunucusu, mesajları karşılar
        │
        ▼
bot/bridge/environment.js     ← ASIL BEYİN: gözlem, ödül, bölüm mantığı
        │
        ▼
bot/skills/*.js               ← yeniden kullanılabilir davranışlar (chopTree, gel)
        │
        ▼
mineflayer                    ← Minecraft protokolü
```

Her katman sadece bir altındakini tanır. `env.py` Minecraft'ın ne olduğunu
bilmez; `chopTree.js` RL'in ne olduğunu bilmez. Bu ayrım sayesinde
Milestone 3'te algoritmayı değiştirdiğinde bot koduna hiç dokunmayacaksın.

---

## 4. Gözlem tasarımı (neden birkaç sayı?)

Ham piksel veya bütün dünya haritası yerine **elle seçilmiş 12 sayı** kullanıyoruz.

Sebep: 3. sınıf öğrencisinin dizüstünde piksel tabanlı RL eğitmek günler sürer.
Elle seçilmiş küçük bir gözlem vektörü ile aynı algoritma dakikalar içinde
öğrenmeye başlar. Bu bir eksiklik değil, bilinçli bir mühendislik kararı —
README'de de böyle yazıyoruz.

Vektörün içindekiler (`bot/bridge/environment.js` → `gozlem()`):

- **0-2:** en yakın kütüğe göreli yön (birim vektör) → "ağaç ne tarafta?"
- **3:** o kütüğe mesafe (0-1 arası) → "ne kadar uzakta?"
- **4-5:** botun bakış açısı (yaw, pitch) → "ben ne tarafa bakıyorum?"
- **6:** envanterdeki odun → "ne kadar ilerledim?"
- **7-8:** can ve açlık → "hayatta mıyım?"
- **9:** baktığım blok kütük mü → "kırsam işe yarar mı?"
- **10:** ayaklarım yerde mi → "düşüyor muyum?"
- **11:** bölümün ne kadarı geçti → zaman baskısı

Bütün değerler -1..1 arasına sıkıştırılmış. Sinir ağları farklı ölçeklerdeki
girdilerle iyi çalışmaz; normalizasyon şart.

---

## 5. Ödül tasarımı (reward shaping)

En kritik ve en çok hata yapılan yer burası.

```
ödül = 1.00 × (yeni toplanan odun)
     + 0.20 × (kırılan kütük)
     + 0.05 × (en yakın ağaca yaklaşma, blok cinsinden)
     - 0.01 × (her adım için zaman cezası)
```

**Neden sadece "odun topla → +1" demiyoruz?**
Çünkü rastgele davranan bir ajan asla kazara odun toplayamaz. Ödül hiç gelmezse
öğrenecek bir şey de olmaz — buna *sparse reward* problemi denir.

Bu yüzden hedefe giden yolu parçalara böldük:

- ağaca **yaklaşmak** küçük ödül verir → ajan önce yürümeyi öğrenir
- kütük **kırmak** orta ödül verir → sonra kırmayı öğrenir
- odun **toplamak** büyük ödül verir → en son asıl hedefi öğrenir

**Zaman cezası neden var?** Olmazsa ajan "hiçbir şey yapmama" ile de aynı toplam
ödülü alır. Küçük bir eksi ceza, ajanı acele etmeye zorlar.

**Dikkat edilecek tuzak (reward hacking):** "Yaklaşma" ödülünü çok büyük
verirsen ajan ağacın etrafında ileri-geri gidip ödül toplamayı öğrenebilir —
ağaç kesmeyi hiç öğrenmez. Katsayıyı (0.05) bilerek küçük tuttuk.

---

## 6. Bölüm (episode) mantığı

- **terminated** (görev başarıyla bitti): 5 odun toplandı
- **truncated** (süre doldu): 500 adım geçti

Gymnasium bu ikisini ayırmayı ister, çünkü "başardı" ile "vakit doldu" farklı
şeylerdir ve algoritma bunları farklı işler.

---

## 7. Taklitle öğrenme ve öğrettikleri

**Milestone 3 — Imitation Learning: TAMAMLANDI**

`chopTree` görevi doğru yapıyor ama pathfinder çağırdığı için ajanın aksiyon
uzayında ifade edilemiyordu — yani demo olarak kullanılamazdı.
`bot/bridge/expert.js` aynı davranışı **sadece ajanın sahip olduğu 5 aksiyonla**
yeniden yazıyor. Her adımda "burada uzman ne yapardı?" sorusuna cevap veriyor,
bu (gözlem, aksiyon) çiftleri de eğitim verisi oluyor. Bu noktadan sonra iş RL
değil, düz sınıflandırma.

Üç hata çıktı ve üçü de öğreticiydi:

1. **Uzman fazla iyi.** Bölümler ağaca yakın başladığı için kayıtların %80'i
   "kır" aksiyonu oldu, "sola dön" hiç geçmedi. Ağ "hep kır"ı öğrendi, önünde
   ağaç olmayınca çakıldı. Çözüm: bölüm başlangıç yönünü rastgeleleştirmek ve
   toplama sırasında gürültü eklemek — bazen rastgele aksiyon uygula, ama
   etiket olarak yine uzmanın aksiyonunu kaydet. Böylece "işler ters gittiğinde
   ne yapmalı" örnekleri oluşuyor.

2. **Bölüm bazlı sayım.** Bitiş koşulu envanterin toplamına bakıyordu. Envanter
   bölümler arasında sıfırlanmadığı için ilk başarılı bölümden sonra her yeni
   bölüm 1 adımda bitiyor, eğitim verisinin %90'ı sessizce kayboluyordu.

3. **Hedef titremesi.** `findBlock` en yakını garanti etmiyor ve hedef her adım
   yeniden seçilince gözlemdeki "ağaç yönü" iki ağaç arasında zıplıyordu. Her
   adım değişen bir girdiyle ne uzman ne ajan tutarlı davranabilir; hedef artık
   kilitleniyor.

Bunların hiçbiri egzotik değil — bir oyunu RL ortamına çevirirken karşılaşılan
sıradan hatalar. İşin büyük kısmı da zaten bunları bulmak.

---

## 8. Tek ortam, birden çok görev

Madencilik, ortama dokunmadan **ikinci bir RL görevi** olarak eklendi. Zaten
sınamak istediğimiz şey buydu: ikinci görev ikinci bir ortam gerektiriyorsa,
birincisi kendi görevine fazla uydurulmuş demektir.

Sabit kalanlar öğrenme algoritmasının gördüğü şeyler: beş aksiyon, ödül şekli,
bölüm mantığı, eğitim scriptleri, değerlendirme. Görevden göreve değişen şey
küçük bir **soru kümesi** ve hepsi tek dosyada (`bot/bridge/gorevler.js`):

| soru | odun | maden |
|---|---|---|
| hedef nedir? | kütük | cevher |
| bu hedef meşru mu? | oyuncunun evi değil | **kazmam buna yetiyor mu?** |
| ilerlemeyi nasıl sayarım? | envanterdeki odun | cevher + külçe |
| yolu açmak için ne kırabilirim? | yaprak, bitki | taş da — kazmamız var |
| hedefleri nasıl sıralarım? | kuş uçuşu mesafe | dikey fark 3 kat pahalı |
| ne kadar uzağa bakarım? | 64 blok | **16 blok** |
| bölüm başında hedefe yürüteyim mi? | evet | **hayır** |

Son iki satır ayrı paragrafı hak ediyor, çünkü ikisi de önce hata olarak çıktı.

**Arama yarıçapı.** `findBlocks` duvarın ardını görüyor. y=15'te 64 blok içinde
her zaman bir cevher vardır — genelde taşın kırk blok gerisinde. Ortam bölgeyi
hiç "tükendi" saymadı, botu hiç ışınlamadı, ve her bölüm ulaşılamayan bir şeye
tünel kazmakla geçti: 1. bölüm 5 cevher topladı, 2-18 arası hiç. 16 blok, bir
ajanın bir bölümde kazabileceği mesafe — ve onunla birlikte ortamın değişmez
kuralı geri geliyor: *bölüm başında ulaşılabilir bir hedef vardır.*

**Bölüm başında hedefe yürütme.** Ormanda zararsız bir kurulum adımı: açık
arazide yürümek görevin kendisi değil. Yer altında ise **tam da görevin
kendisi**, üstelik pathfinder kazarak gidiyor. Ortam, ajan adına tüneli kazıp
sonra ona ödülü verecekti. Aksiyon uzayında "pathfinder ile ağaca git"
aksiyonunun olmamasıyla aynı sebep — aynı kestirme, bu sefer kurulum kodundan
sızıyordu.

Görev başına dosya yolları (`python/minecrai/yollar.py`) her görevin verisini ve
modelini ayrı tutuyor. Olmasaydı bir gün biri diğerinin modelini ezerdi ve
belirtisi — sessizce yanlış model yüklenmesi — saatler alırdı.

---

## 9. Tek ajan, birden çok görev

Doğal sonraki soru: **tek bir ağ**, sadece hangi görevde olduğu söylenerek ikisini
birden yapabilir mi? Yukarıdaki her şey paylaşıldığı için eklenenler küçük.

**Ortak gözlem genişliği.** Odun 16 sayı gönderiyor, maden 20. Tek ağın tek girdi
boyutu olur, o yüzden çok görevli mod ikisi için de geniş gözlem istiyor. Odun,
çok görevli mod dışında dar varsayılanını koruyor — böylece daha önce eğitilmiş
modeller hâlâ yükleniyor. Yayınlanmış sonuçları yeni bir görevi kolaylaştırmak
için bozmak kötü bir takas.

**Görev kimliği gözlemde olmalı.** Aynı gözlemde — *önümde taş var* — odun
görevinin doğru cevabı "dolaş", maden görevininki "kır". Gerçek demolarda
ölçtük: odun uzmanı adımların %19'unda kırıyor, maden uzmanı %32'sinde. Görev
sinyali olmazsa bu iki etiket aynı girdiye düşer ve ağ ikisinin ortalamasını
öğrenir — yani hiçbirini.

Bu, projede **üçüncü kez** karşımıza çıkan aynı kural: *uzman, öğrencinin
göremediği bilgiye dayanamaz.* Önce A* planı olarak geldi, sonra yere düşmüş
eşya olarak, şimdi görev kimliği olarak. Bir kez sağlayıp geçilecek bir madde
değil.

**Dönüşümlü sıra, rastgele değil.** Kısa koşularda rastgele seçim dengesiz
dağılım üretiyor — 30 bölümde 19/11 sıradan bir sonuç — ve görev başına yapılan
her karşılaştırmayı sessizce bozar.

Ölçümün gösterdiği, tasarımın öngörmediği bir şey: **iki görev botu fiziksel
olarak farklı yerlerde istiyor.** Odun yüzeyde, maden y=15'te geçiyor ve ortam
her reset'te en fazla on iki basamak iniyor. Görevler dönüşümlü olunca her maden
bölümü yeniden aşağı inmekle başlıyor. Ölçtük: çok görevli toplamada maden
bölümleri ortalama 131 adım sürdü, tek başına ~87'ye karşı, ve 20 bölümün 8'i
boş bitti. Bu, bedenlenmiş bir ortamda çok görevli öğrenmenin gerçek bir maliyeti
ve algoritma tarafından hiç görünmüyor.

---

## 10. Buradan sonrası

Hiçbiri karara bağlanmadı. Mevcut işin üstüne inşa edecek yönler:

- **Speedrun çerçevesi.** Ödül şu an bölüm beş kaynakta bittiği için tavanlı;
  iyileşme ancak *hız* olarak görünebiliyor — Milestone 4'te ölçtüğümüz tam da
  buydu (ödül düz, bölüm uzunluğu %19 kısaldı). Zamanı yan etki değil hedefin
  kendisi yapmak, hâlihazırda çarptığımız bir ölçüm sorununu çözer. Üstelik
  büyük kısmı hazır: `uret <esya>` tarif ağacını zaten çalışma anında çözüyor;
  kronometre ve sabit seed eklemek tekrarlanabilir bir ölçüt veriyor.
- **Hiyerarşik kontrol.** Ajan şu an yürümeyi ve dönmeyi öğreniyor. Aksiyonları
  mevcut *beceriler* olan bir ajan bunun yerine sıralamayı öğrenir — "şimdi daha
  çok odun mu, yoksa madene mi?" — ve mevcut sistemin her parçasını kullanır.
- **Ölçüm varyansını düşürmek.** Lapis ve redstone blok başına 4-9 parça
  düşürüyor, yani tek şanslı bir blok bölümü bitirebiliyor. Bütün politikalara
  aynı uygulandığı için karşılaştırmayı taraflı yapmıyor, ama varyansı şişiriyor
  — ve iki politikayı ayırmamızı defalarca engelleyen şey varyanstı.

**Neden bu sıra?** Her aşama tek başına sunulabilir bir sonuç üretir.
Proje yarım kalsa bile elinde gösterilecek bir şey olur.
