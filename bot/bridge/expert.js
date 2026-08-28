'use strict'

/**
 * UZMAN POLİTİKA (expert policy)
 *
 * Milestone 3'ün temeli. Her adımda "bu gözlemde uzman ne yapardı?" sorusuna
 * cevap veriyor; bu (gözlem, aksiyon) çiftleri taklit ederek öğrenmenin
 * eğitim verisi oluyor.
 *
 * TASARIM: uzman PATHFINDER KULLANIR, ajan kullanmaz.
 *
 * Bu ayrım kritik. Aksiyon uzayından "pathfinder ile ağaca git" aksiyonunu
 * bilerek kaldırdık: ajana tek tuşla navigasyon vermek öğrenmeyi anlamsız
 * kılıyordu. Ama UZMANIN akıllı olması gerekir — o öğretmen. Taklitle
 * öğrenmede uzmanın bir planlayıcı olması standarttır.
 *
 * Ajan hâlâ 13 sayılık gözleme bakıp 5 aksiyondan birini seçmeyi öğreniyor.
 * Sadece taklit ettiği örnekler artık daha iyi.
 *
 * Bundan önce uzman tamamen tepkiseldi ("ağaç şu tarafta, o tarafa yürü") ve
 * arazi hakkında hiçbir şey bilmiyordu. Duvara toslayınca zıplama, kaçınma,
 * kara liste gibi yamalarla kurtarmaya çalıştık; hepsi tek tek sorunları
 * çözdü ama bot hâlâ saçma yerlerde takılıyordu. Asıl eksik yol planlamaydı.
 */


// Bu açıdan fazla sapma varsa önce dönmek gerekir.
// environment.js'teki DONUS_ACISI (22.5°) ile uyumlu olmalı: dönüş adımı
// toleransın iki katından büyükse hedef hiç tutturulamaz, bot salınır.
const YAW_TOLERANS = 0.22

// Yol kaç ms sonra yeniden hesaplansın (A* pahalı, her adımda çalıştırılmaz)
const YOL_TAZELEME_MS = 1500

// A* için düşünme süresi. Her adım zaten ~400ms sürüyor, bu kabul edilebilir.
const PLAN_SURESI_MS = 250

/** Bir hedefe bakmak için gereken yaw (Minecraft konvansiyonu) */
function hedefYaw (botPos, hedefPos) {
  const dx = hedefPos.x + 0.5 - botPos.x
  const dz = hedefPos.z + 0.5 - botPos.z
  return Math.atan2(-dx, -dz)
}

/** İki açı arasındaki en kısa farkı -π..π aralığına indirger */
function aciFarki (a, b) {
  let fark = a - b
  while (fark > Math.PI) fark -= 2 * Math.PI
  while (fark < -Math.PI) fark += 2 * Math.PI
  return fark
}

/** Bir noktaya doğru tek adım: hizalı değilsek dön, hizalıysak yürü */
function yonel (bot, hedefPos, donSebebi, yuruSebebi) {
  const istenen = hedefYaw(bot.entity.position, hedefPos)
  const fark = aciFarki(istenen, bot.entity.yaw)

  if (Math.abs(fark) > YAW_TOLERANS) {
    // mineflayer'da yaw ARTARSA sola dönülür (aksiyon 2)
    return fark > 0
      ? { action: 2, sebep: donSebebi + '_sola' }
      : { action: 1, sebep: donSebebi + '_saga' }
  }
  return { action: 0, sebep: yuruSebebi }
}

/**
 * Mevcut duruma bakıp uzmanın seçeceği aksiyonu döndürür.
 *
 * Öncelik sırası — demo verisinin kalitesini bu belirliyor:
 *   1. Menzilimde kütük varsa kır (en yüksek getirili anlık iş)
 *   2. Yerde odun varsa üstüne git (ödülün asıl kaynağı: 1.0/odun)
 *   3. Ağaca giden YOLU planla, bir sonraki ara noktaya yönel
 *   4. Yol yoksa tepkisel olarak hedefe dön (son çare)
 *
 * @returns {{action: number, sebep: string}}
 */
function uzmanAksiyonu (bot, env) {
  // 1) YAKINDA DÜŞMÜŞ ODUN VARSA ÖNCE ONU AL.
  //
  // Bu sıra bilerek en başta. Önceden "menzilde kütük varsa kır" kuralı
  // birinciydi; sık bir ormanda bir kütüğü kırınca hemen menzile bir
  // başkası giriyor, sıra hiç toplamaya gelmiyordu. Bot kırıp kırıp
  // yürüyor, odunlar yerde birikiyordu.
  //
  // Ödül zaten bunu söylüyordu: odun toplamak 1.0, kütük kırmak 0.2.
  // Toplamak beş kat değerli, o yüzden önce gelmeli.
  const yakinEsya = env.yakinEsya(5)
  if (yakinEsya) {
    return hedefeYonel(bot, env, yakinEsya.position, 'yakin_odunu_aliyorum')
  }

  // 2) Menzilimde kırılabilir kütük varsa kır
  if (env.onundekiKutuk()) {
    return { action: 3, sebep: 'onumde_kutuk_var' }
  }

  // 2b) Yolumu kapatan yaprak vb. varsa aç
  if (env.onumuKapatan()) {
    return { action: 3, sebep: 'yolumu_aciyorum' }
  }

  // 3) Biraz uzaktaki düşmüş odunlar
  const esya = env.yakinEsya()
  if (esya) {
    return hedefeYonel(bot, env, esya.position, 'uzak_odunu_aliyorum')
  }

  // 4) Ağaç yoksa yapacak bir şey de yok
  const hedef = env.enYakinKutuk()
  if (!hedef) {
    return { action: 4, sebep: 'AGAC_BULAMIYORUM' }
  }

  return hedefeYonel(bot, env, hedef.position, 'agaca')
}

/**
 * Hedefe yönel; önüm kapalıysa AÇIK OLAN tarafa dön.
 *
 * Kaçınma yönü eskiden rastgele seçiliyordu. Rastgele bir karar tanımı
 * gereği hiçbir gözlemden öğrenilemez — ağ aynı girdiye bazen "sol" bazen
 * "sağ" etiketi görüp ikisinin ortalamasını öğreniyordu. Doğrulama başarısı
 * %88'den %52'ye bu yüzden düştü.
 *
 * Artık yön, ajanın da gördüğü bilgiden türetiliyor: solum/sağım kapalı mı.
 */
function hedefeYonel (bot, env, hedefPos, etiket) {
  const istenen = hedefYaw(bot.entity.position, hedefPos)
  const fark = aciFarki(istenen, bot.entity.yaw)
  const hizali = Math.abs(fark) <= YAW_TOLERANS

  // Hizalıyız ve önümüz açıksa: yürü
  if (hizali && !env.onumdeEngelVar()) {
    return { action: 0, sebep: etiket + '_yuruyorum' }
  }

  // Hizalı ama önümüz kapalı: açık olan tarafa dön
  if (hizali) {
    const sol = env.solumKapali()
    const sag = env.sagimKapali()

    if (sol && !sag) return { action: 1, sebep: etiket + '_engel_sagdan_dolasiyorum' }
    if (sag && !sol) return { action: 2, sebep: etiket + '_engel_soldan_dolasiyorum' }

    // İkisi de açık ya da ikisi de kapalı: hedefe daha yakın olan yöne dön.
    // Deterministik — aynı gözlem hep aynı cevabı verir.
    return fark >= 0
      ? { action: 2, sebep: etiket + '_engel_soldan_dolasiyorum' }
      : { action: 1, sebep: etiket + '_engel_sagdan_dolasiyorum' }
  }

  // Hizalı değiliz: hedefe dön
  return fark > 0
    ? { action: 2, sebep: etiket + '_donuyorum_sola' }
    : { action: 1, sebep: etiket + '_donuyorum_saga' }
}

module.exports = { uzmanAksiyonu, hedefeYonel, yonel, hedefYaw, aciFarki }
