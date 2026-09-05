# MinecrAI kurulumu

MinecrAI bir **companion app / external bot**: Minecraft Java sunucusuna oyuncu
olarak bağlanır. Fabric/Forge modu değildir; `mods/` klasörüne atılmaz.
Node botu, WebSocket bridge ve Python/Gymnasium RL mimarisi korunur.

## Normal kullanıcı — Windows

1. Node.js **22 veya üzerini** kurun (Mineflayer gereksinimi). Terminali yeniden açın.
2. GitHub'dan kaynak kodu indirin ve çıkarın veya repoyu klonlayın. PowerShell'i
   MinecrAI klasöründe açın. Yalnızca bot için Python gerekmez.
3. `npm run setup -- --bot-only` çalıştırın. Bu komut `npm ci` ile Node paketlerini
   indirir, eksikse `.env.example` dosyasından `.env` oluşturur ve çıktı klasörlerini
   hazırlar. Mevcut `.env`, modeller ve kayıtlar korunur.
4. `.env` dosyasındaki sunucu adresini ve sürümü düzenleyin.
5. Kendi Minecraft Java sunucunuzu başlatın; ardından `npm start` çalıştırın.
   Oyunda `komut` yazarak komutları görün. Durdurmak için Ctrl+C.

Alternatif: `scripts/start-minecrai.cmd` dosyasına çift tıklayın. PowerShell:

```powershell
.\scripts\start-minecrai.ps1 -Mode bot -CheckServer
```

PowerShell betik politikası engelliyorsa `.cmd` veya `npm start` kullanın.
Yönetici yetkisi gerekmez. Başlatıcı repo klasörünü kendi bulur.
`npm start -- bot --check-server` açılıştan önce isteğe bağlı TCP kontrolü yapar.

## Minecraft sunucusu ve hesap

Varsayılan ve mevcut deneylerin sürümü **Java Edition 1.20.4**. Sunucu ayrı
çalışır; launcher sunucu indirmez, EULA kabul etmez veya oyun başlatmaz.
Minecraft'ın resmi dağıtımından sunucuyu ayrıca edinin; sürümünün gerektirdiği
Java'yı kurun. 1.20.4 için Java 17 kullanılır. Sunucu EULA'sını okuyup kabul
ediyorsanız sunucu yönergelerine göre yapılandırın. Modlu sunucuların özel
blokları/protokolleri için uyumluluk garanti edilmez.

| `.env` ayarı | Anlamı |
|---|---|
| `MC_HOST=localhost` | Sunucunun adresi |
| `MC_PORT=25565` | Sunucu portu; LAN dünyası farklı port açabilir |
| `MC_VERSION=1.20.4` | Sunucuyla eşleşen Minecraft sürümü |
| `MC_USERNAME=MinecrAI` | Offline bot adı; Microsoft girişinde hesap kimliği |
| `MC_AUTH=offline` | Yalnızca güvendiğiniz yerel, `online-mode=false` sunucu |
| `MC_AUTH=microsoft` | Premium/online sunucu için Minecraft Java erişimli Microsoft hesabı |
| `BRIDGE_PORT=8765` | Node WebSocket portu |
| `MINECRAI_PROFILE=vanilla-survival` | Yalnızca doctor tarafından doğrulanan profil |

Microsoft girişindeki cihaz kodu yönergelerini izleyin; aynı hesabı oyuncu ve bot
için eşzamanlı kullanmayın. Oturum önbelleklerini paylaşmayın. Offline sunucuyu
internete açık kullanmayın; burada hesap kimliği doğrulanmaz. Sunucu sahibinin bot
kullanımına izin verdiğinden emin olun.

Bridge mevcut haliyle kimlik doğrulamasız bir WebSocket sunucusudur ve tüm ağ
arayüzlerinde dinler. 8765 portunu internete açmayın; yerel kullanımda firewall
ile dış erişimi engelleyin. Python aynı bilgisayarda `ws://localhost:8765` kullanır.

## RL kullanıcıları ve geliştiriciler

Python **3.10+** kurun; mevcut bağımlılıklarla başlangıç için 3.11/3.12 kullanın.
Repo kökünde:

```powershell
npm run setup
npm run test:node
npm run test:python
npm test
npm run doctor
```

Tam setup `.venv` oluşturur ve `python/requirements.txt` paketlerini pip ile kurar.
PyTorch dahil büyük indirmeler yapılır; ilk kurulum internet ve disk alanı ister.
Tekrar çalıştırılabilir; ortamı silmez. Python paketleri alt sürüm sınırlarıyla
tanımlıdır, henüz tam kilitlenmiş bir Python dağıtımı değildir.
Python seçim sırası `.venv`, `python`, `python3`, Windows `py -3`; 3.10'dan eski
veya çalışmayan adaylar atlanır. Bozuk mevcut `.venv` setup sırasında otomatik
silinmez; hata mesajını inceleyerek ortamı kendiniz onarın.

Node ve Python smoke testleri Minecraft istemez. `npm test` iki tarafı da dener
ve herhangi bir hata/eksik Python durumunda sıfırdan farklı çıkış kodu verir.
Doctor PASS/WARN/FAIL üretir; FAIL varsa çıkış kodu 1, yalnızca WARN varsa 0 olur.
Bot-only kurulumda Python için FAIL normaldir; `npm start` Python istemez.
`npm run doctor -- --server` ayrıca sunucu TCP erişimini denetler; sürüm, hesap
girişi veya oyun içi izinleri TCP kontrolü doğrulayamaz.

RL için ilk terminal:

```powershell
npm start -- bridge --check-server
```

İkinci terminal, repo kökünde:

```powershell
.\.venv\Scripts\python.exe python\random_agent.py --url ws://localhost:8765
```

`npm run bridge` ve `npm run bot` eski doğrudan girişler olarak korunur.
**Bot ve bridge alternatiflerdir; aynı hesapla ikisini birlikte çalıştırmayın.**
Bridge zaten kendi botunu oluşturur; chat komutlarını dinlemez. Python'u bridge
"Köprü hazır" dedikten sonra başlatın. Bridge modu Python eğitimini otomatik
başlatmaz. Önce Python'u, sonra bridge'i Ctrl+C ile durdurun.
Portu değiştirirseniz Python `--url` değerini de değiştirin: Python `.env` okumaz.
Linux/macOS'ta aynı npm komutları, Python için `.venv/bin/python` kullanılır.

## Sık hatalar

| Belirti | Çözüm |
|---|---|
| Python bulunamadı | Python 3.10+ kurun, terminali yeniden açıp `npm run setup` çalıştırın. `.venv` varsa test komutları aktivasyon gerektirmez. |
| Python paketleri yüklenemedi | `npm run setup`; hata sürerse pip çıktısındaki Python/platform uyumluluğunu inceleyin. |
| Bridge bağlanamadı | Bridge botunun sunucuya girmesini bekleyin; `--url` ve `BRIDGE_PORT` eşleşsin. |
| Bot op değil | Normal komutlar için genel op şartı yok; renkli liste düz metne düşebilir. Eğitimde sunucu komutları için sunucu sahibi gerektiğinde `op MinecrAI` verebilir. |
| Yanlış Minecraft sürümü | `.env` içindeki `MC_VERSION` ile gerçek sunucu sürümünü eşleştirin. |
| Port kullanımda | Önceki bridge oturumunu kapatın veya bridge ve Python portunu birlikte değiştirin. Doctor'da çalışan bridge için WARN beklenir. |
| API key yok / sohbet kapalı | İsteğe bağlıdır; `kes 3`, `gel`, `komut` çalışır. Doğal dil için `.env.example` içindeki sağlayıcı alanlarından birini doldurun. |
| Bot durmadan atılıyor | Aynı hesapla iki bot/oyuncu açılmadığını, auth ve whitelist ayarlarını kontrol edin. |
| npm PowerShell'de engelleniyor | Aynı komutu `npm.cmd` ile veya Komut İstemi'nde çalıştırın. |

Geliştirici referansları: [mimari](architecture.md), [protokol](../bot/bridge/protocol.md),
[profiller](profiles.md), [yayınlama](publishing.md). Kişisel `BASLAT.md` dosyası
dağıtımın parçası değildir; taşınabilir kurulum kaynağı bu belgedir.
