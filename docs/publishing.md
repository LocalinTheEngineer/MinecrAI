# Companion app + modpack/server pack yayın planı

MinecrAI gerçek Minecraft modu değildir. Ürün açıklaması: **"Minecraft Java
sunucuları için companion app / external bot ve isteğe bağlı Python RL ortamı"**.
Şimdiki dağıtım kaynak kod ve launcher betikleridir; bağımsız EXE, hazır modpack
veya otomatik sunucu kurucusu henüz yoktur.

## GitHub Releases — ilk dağıtım kanalı

1. Temiz bir checkout'ta `npm run setup`, `npm run test:node`,
   `npm run test:python`, `npm test`, `npm run doctor` çalıştırın. Gerçek bir
   1.20.4 test sunucusunda bot girişi, Ctrl+C ve bridge/Python bağlantısını ayrıca
   deneyin; smoke testleri canlı bağlantıyı kanıtlamaz.
2. Sürüm, desteklenen Node/Python/Minecraft sürümleri, bilinen sınırlamalar ve
   kurulum rehberi bağlantısını sürüm notlarına yazın. Etiket/sürüm numarasını
   package.json ve lockfile ile eşleştirin.
3. Boş bir staging klasörüne yalnızca aşağıdaki izinli dosyaları kopyalayın,
   içeriği inceleyip ZIP oluşturun. Çalışma klasörünü olduğu gibi ZIP'lemeyin.
4. ZIP'i geçici klasöre çıkarıp kurulumu tekrar deneyin. SHA-256 özeti oluşturun;
   incelenmiş ZIP ve özetini release asset olarak yükleyin. Bu çalışma yayın
   yapmaz; yayıncı son kontrolü tamamlayıp release oluşturur.

| Paketlenir | Paketlenmez |
|---|---|
| `package.json`, `package-lock.json`, `LICENSE`, `README.md`, `.env.example`, `.gitignore` | `.env`, `.env.*` (örnek hariç), API anahtarları, Microsoft token/oturum cache dosyaları |
| `bot/` içindeki `.js` ve protokol `.md` dosyaları | `node_modules/`, `.venv/`, `.git/`, kişisel `BASLAT.md`, `_to_delete/` |
| `python/` içindeki `.py`, `requirements.txt` | `__pycache__/`, modeller, checkpoint'ler, `models/`, `runs/`, loglar |
| `scripts/` içindeki `.js`, `.ps1`, `.cmd`; `profiles/` içindeki `.js`, `.json` | `data/` tamamı: demonstrations, yerler, koruma koordinatları ve diğer kişisel veriler |
| `test/` içindeki `.js`, `.py`; `docs/` içindeki `.md` | Minecraft JAR, Mojang assetleri, dünyalar, oyun dosyaları, ham kayıtlar (`docs/ham/`) |
| README'nin kullandığı, hakları kontrol edilmiş `docs/images/` görselleri | Büyük model/video dosyaları ve incelenmemiş üçüncü taraf içerik |

İzinli uzantılar tek başına gizli bilgi denetimi değildir: staging dosyalarını
ve arşiv listesini ayrıca inceleyin. `.gitignore` arşivleme filtresi değildir.
Varsayılan kaydedilmiş koruma bölgelerini bile başka kullanıcılara taşımayın.
Modeller ileride ayrı ve isteğe bağlı indirme olabilir; lisans, boyut, hash,
görev ve gözlem boyutu belirtilmeden paketlemeyin.

## Modrinth

Gerçekten hazırlanıp denenmiş bir Minecraft modpack'i olduğunda Modrinth App
ile `.mrpack` dışa aktarın. Format dosya indirme kayıtları ve overrides kullanır;
sunucuya özel overrides da destekler. Ayrıntılar: [resmi format](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack).

Pack açıklamasında dış botun GitHub'dan ayrıca kurulduğunu, Node/Python
gereksinimlerini ve desteklenen sunucuyu yazın. Node kaynak ZIP'ini `.mrpack`
diye yeniden adlandırmayın. Companion executable'larını overrides içine gizlice
koymayın veya oyun açılışında otomatik çalıştırmayın. Dış uygulama bağlantısının
platforma uygunluğunu yayın öncesi doğrulayın; kabul garantisi yoktur.
Modrinth yayınları moderasyon onayı gerektirir: [paylaşım rehberi](https://support.modrinth.com/en/articles/8797522-sharing-modpacks).

## CurseForge

Gerçek pack'i CurseForge App üzerinden dışa aktarın; uygulamanın oluşturduğu
manifest ve gerekli overrides düzenini koruyun. Mod bağımlılıklarını platformun
dosya referanslarıyla dağıtın; üçüncü taraf dosyaların izinlerini kontrol edin.
[Resmi dışa aktarma rehberi](https://support.curseforge.com/support/solutions/articles/9000197908-exporting-a-modpack-for-curseforge-project-submission).

Proje kategorisi ve açıklaması gerçek içeriği yansıtmalı: bu repo tek başına
Minecraft mod dosyası değildir. Uyumlu pack hazır değilken "mod" projesi gibi
yüklemeyin. Sunucu helper dokümanı ve GitHub companion bağlantısını açıkça
belirtin; harici uygulama dağıtımını önce platformla doğrulayın.
[Moderasyon kuralları](https://support.curseforge.com/support/solutions/articles/9000197279).

## Lisans, bağımlılıklar ve izinler

Repo MIT lisanslıdır; LICENSE ve telif bildirimlerini koruyun. Bu lisansın
Minecraft'a, üçüncü taraf modlara veya bağımlılıklara otomatik olarak hak
verdiğini varsaymayın. Her dağıtılan dosyanın lisansını ayrıca inceleyin.
Minecraft dosyalarını kullanıcı resmi kaynaktan edinir ve EULA'yı kendisi
değerlendirir. Node lockfile korunur; Python requirements henüz tam sabitlenmiş
bir lockfile değildir. Release öncesi desteklenen platformlarda paket sürümlerini
kaydedin ve gelecekte platform bazlı Python kilitlemesini ekleyin.

Bot sunucuda oyuncu yetkileriyle iş yapar; sunucu sahibinin izni gerekir.
Bridge şu anda kimlik doğrulamasızdır; herkese açık bir hizmet olarak
yayınlamayın. Sohbet sağlayıcısı isteğe bağlıdır; kullanılırsa oyun mesajlarının
harici sağlayıcıya iletildiği ve sağlayıcı ücret/koşullarının geçerli olduğu
açıklanmalıdır. Anahtar ve hesap önbelleklerini release'e katmayın.

## Aşamalı yol haritası

1. Kaynak dağıtımı, setup/doctor ve Windows launcher (bu aşama).
2. Temiz makinelerde kurulum matrisi, denetlenmiş arşiv üretimi, sürüm/hash
   doğrulaması ve Python bağımlılık kilitlemesi.
3. Test edilmiş modpack/server pack, sürüm uyumluluk tablosu ve isteğe bağlı
   model indirme; oyun dosyaları kullanıcı tarafından edinilir.
4. Gerekirse Fabric/Forge bridge modunu ayrı bileşen olarak tasarlama: dar ve
   sürümlenmiş protokol, kimlik doğrulama, açık izinler, bağlantı yaşam döngüsü.
   Mevcut Node/Python hattını koruyarak önce küçük bir entegrasyon deneyi yapma.

Platform kaynakları 5 Eylül 2026'da kontrol edildi; yayın anında tekrar inceleyin.
