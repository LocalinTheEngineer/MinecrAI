# Oyun modu profilleri — ilk aşama

`profiles/loader.js` içindeki `loadProfile(name)` repo içindeki JSON'u okur ve
`validateProfile` ile doğrular. Dış yollar kabul edilmez. `MINECRAI_PROFILE`
verilmezse doctor `vanilla-survival` seçer; `skyblock` yalnızca taslaktır.

Şema sözleşmesi: `name`, `description`, `default_task` boş olmayan metin;
`allowed_tasks`, `protected_blocks`, `valuable_blocks`, `danger_blocks`,
`forbidden_actions`, `reward_hints`, `notes` metin dizisidir.
`default_task`, `allowed_tasks` içinde bulunmalıdır. Blok adları şu aşamada
Minecraft registry'sine karşı doğrulanmaz. Gelecekteki alanlar kabul edilir.

**Bu alanlar çalışma sırasında uygulanmaz.** Profil seçmek görevleri yasaklamaz,
blokları korumaz, ödülü değiştirmez veya varsayılan RL görevini seçmez. Loader
bot/RL modüllerine bağlanmamıştır; yalnızca doctor ve testler kullanır.
Özellikle skyblock'ta ada güvenliği sağlandığı iddia edilmemelidir.

Sonraki adımlar: şema sürümü eklemek, blok adlarını registry ile doğrulamak,
görev seçimini açık bir kullanıcı seçeneğiyle bağlamak ve koruma kurallarını
aksiyon katmanında test etmek. Ödül/gözlem değişirse mevcut modellerle uyumluluk
ayrıca ölçülmeli; mevcut modellerin boyutları sessizce değişmemelidir.
