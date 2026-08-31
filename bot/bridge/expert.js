'use strict'

/**
 * UZMAN POLİTİKALAR (expert policies)
 *
 * Milestone 3'ün temeli. Her adımda "bu gözlemde uzman ne yapardı?"
 * sorusuna cevap veriyor; bu (gözlem, aksiyon) çiftleri taklit ederek
 * öğrenmenin eğitim verisi oluyor.
 *
 * TASARIM: UZMAN TEPKİSELDİR, PLANLAMAZ.
 *
 * Bu dosya bir kez A* yol planlayıcısına çevrildi ve geri alındı. Sebep
 * ölçüldü: taklit doğruluğu %88'den %52'ye düştü, eğitim ve doğrulama
 * kaybı BİRLİKTE platoya oturdu. Bu ezberleme imzası değil,
 * ÖĞRENİLEMEZLİK imzası.
 *
 * Kural şu: uzman, öğrencinin GÖREMEDİĞİ bilgiye dayanamaz. Ajan 19
 * sayılık bir gözlem görüyor; planlayıcı uzman ise bütün haritayı
 * biliyordu. Aynı gözleme bazen "sol" bazen "sağ" etiketi düşüyordu ve
 * ağ ikisinin ortalamasını öğreniyordu.
 *
 * Bu yüzden buradaki her karar, ajanın da gördüğü şeylerden türetiliyor:
 * hedefin yönü, önüm/solum/sağım kapalı mı, menzilimde ne var.
 *
 * İKİ GÖREV, İKİ UZMAN. `odunUzmani` ve `madenUzmani` aynı yardımcıları
 * paylaşıyor; ayrıldıkları yer sadece öncelik listesi.
 */

// Bu açıdan fazla sapma varsa önce dönmek gerekir.
// environment.js'teki DONUS_ACISI (22.5°) ile uyumlu olmalı: dönüş adımı
// toleransın iki katından büyükse hedef hiç tutturulamaz, bot salınır.
const YAW_TOLERANS = 0.22

// Aynı düşmüş eşyanın peşinde en fazla kaç adım koşulur.
//
// ÖLÇÜM: maden görevinde adımların %79'u "yakındaki cevheri alıyorum"du —
// kırıyor, yürüyor, dönüyor, ama eşya envantere hiç girmiyordu. Yerde
// duran ama ULAŞILAMAYAN bir eşya (kırdığı deliğin içine düşmüş, duvarın
// ardında kalmış) uzmanı bölümün tamamı boyunca meşgul ediyordu.
//
// Ağaçlarda aynı sorunu kara listeyle çözmüştük; burada sabır sayacı
// daha basit, çünkü eşyalar hareket eden varlıklar — konumlarını
// kara listeye almak işe yaramaz.
const ESYA_SABRI = 25

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
/**
 * MADEN UZMANI
 *
 * Odun uzmanıyla aynı iskelet, iki yerde ayrılıyor:
 *
 *  - Odunda "hedef yoksa bekle" doğru cevaptı: ormanda ağaç göremiyorsan
 *    dönüp bakman gerekir, kazacak bir şey yok. Madende TERSİ — cevher
 *    zaten taşın içinde saklı, göremiyor olman normal. Doğru cevap
 *    beklemek değil TÜNEL AÇMAK.
 *  - Odunda taş kırmak yasaktı, madende görevin kendisi.
 *
 * Ajan yine aynı 19 sayılık gözleme bakıp aynı 5 aksiyondan birini
 * seçiyor. Değişen tek şey taklit ettiği örnekler.
 */
function madenUzmani (bot, env) {
  // 1) Yerdeki cevher/külçe — ödülün asıl kaynağı (1.0), kırmak 0.2
  const yakinEsya = env.yakinEsya(5)
  if (yakinEsya && env.esyaKovalama < ESYA_SABRI) {
    env.esyaKovalama++
    return hedefeYonel(bot, env, yakinEsya.position, 'yakin_cevheri_aliyorum')
  }

  // 2) Menzilimde cevher varsa kır
  if (env.onundekiKutuk()) {
    return { action: 3, sebep: 'onumde_cevher_var' }
  }

  // 3) Görünürde cevher var ama uzakta: ona dön/yürü
  const hedef = env.enYakinKutuk()
  if (hedef) {
    // DİKEY HEDEFTE YAW ANLAMSIZDIR.
    //
    // `hedefYaw` sadece dx ve dz'ye bakıyor — yükseklik farkı hesaba
    // girmiyor, çünkü ajanın yukarı-aşağı bakma aksiyonu yok. Cevher
    // neredeyse tam tepemizdeyse dx ve dz sıfıra yakın: bir blokluk
    // kıpırdanma açıyı 180 derece çeviriyor. Bot hedefe "dönmeye"
    // çalışırken sonsuza kadar dönüyor.
    //
    // Ölçüm bunu söyledi: adımların %76'sı dönüş, %10'u yürüme, ve
    // bölümlerin 13/15'i sıfır kaynakla bitti. Madende bu durum
    // ormandan çok daha sık, çünkü cevher damarları her yönde —
    // tavanda ve tabanda da.
    //
    // Dikey hedefte doğru davranış dönmek değil: menzildeyse kır
    // (kırma zaten 3 boyutlu bakıyor), değilse ilerleyip açıyı aç.
    const yatay = Math.hypot(
      hedef.position.x + 0.5 - bot.entity.position.x,
      hedef.position.z + 0.5 - bot.entity.position.z
    )
    if (yatay < 2) {
      // Menzilimizdeyse kır (kırma zaten 3 boyutlu bakıyor)
      if (env.onumuKapatan()) {
        return { action: 3, sebep: 'dikey_hedef_kiriyorum' }
      }

      // KIRAMIYORSAK HEDEFİ BIRAK.
      //
      // Buraya ilk yazdığım şey "ilerle, açıyı aç"tı ve YENİ BİR DÖNGÜ
      // açtı: bot uzaklaşıyor, yatay mesafe 2'yi geçiyor, hedefe geri
      // dönüyor, tekrar yaklaşıyor, tekrar uzaklaşıyor. Net yer
      // değiştirme sıfır. Ölçümde bölümlerin 13/15'i TAM 60 adımda,
      // TAM -0.60 ödülle bitti — yerinde sayma kesme eşiği.
      //
      // Doğru davranış dolanmak değil VAZGEÇMEK: aksiyon uzayımızda
      // yukarı gitmek yok, bu hedef bize göre değil. Kara listeye yaz,
      // bir sonrakine bak.
      env.hedefiBirak()
      const yeni = env.enYakinKutuk()
      if (yeni) return hedefeYonel(bot, env, yeni.position, 'cevhere')
      if (env.onumuKapatan()) return { action: 3, sebep: 'tunel_aciyorum' }
      return { action: 0, sebep: 'tunelde_ilerliyorum' }
    }
    return hedefeYonel(bot, env, hedef.position, 'cevhere')
  }

  // 4) Biraz uzaktaki düşmüş eşyalar
  const esya = env.yakinEsya()
  if (esya) {
    return hedefeYonel(bot, env, esya.position, 'uzak_cevheri_aliyorum')
  }

  // 5) Cevher göremiyorum — TÜNEL AÇ.
  //
  // Odun uzmanı burada 'bekle' diyordu ve madende bu ölümcül olurdu:
  // ajan hiç ödül görmeden 500 adım bekler, taklit verisinin tamamı
  // "bekle" olurdu. Cevher taşın ardında; önünü kır ve ilerle.
  if (env.onumuKapatan()) {
    return { action: 3, sebep: 'tunel_aciyorum' }
  }
  return { action: 0, sebep: 'tunelde_ilerliyorum' }
}

function odunUzmani (bot, env) {
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
  if (yakinEsya && env.esyaKovalama < ESYA_SABRI) {
    env.esyaKovalama++
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
  // KAÇINMA MODU: dolaşmaya karar verdiysek BİRKAÇ ADIM YÜRÜ.
  //
  // Bu olmadan uzman iki adımlık bir döngüye giriyordu:
  //   hizalan → önüm kapalı → sola dolaş (döndüm, artık hizalı değilim)
  //   → hedefe geri dön → önüm kapalı → sola dolaş → ...
  //
  // Ölçüm bunu net gösterdi: bölümlerin %43'ü "hedefe dönüyorum",
  // %31'i "engelden dolaşıyorum", ve YÜRÜME sadece %3. Bot yerinde
  // dönüp duruyordu ve hiçbir bölümde tek bir kaynak toplayamadı.
  //
  // Dolaşmaya karar vermek, o yöne GİTMEYİ de göze almak demek.
  if (env.kacinmaAdimi > 0) {
    env.kacinmaAdimi--
    if (!env.onumdeEngelVar()) {
      return { action: 0, sebep: etiket + '_kacinirken_yuruyorum' }
    }
  }

  const istenen = hedefYaw(bot.entity.position, hedefPos)
  const fark = aciFarki(istenen, bot.entity.yaw)
  const hizali = Math.abs(fark) <= YAW_TOLERANS

  // Hizalıyız ve önümüz açıksa: yürü
  if (hizali && !env.onumdeEngelVar()) {
    return { action: 0, sebep: etiket + '_yuruyorum' }
  }

  if (hizali) {
    // ÖNCE KIRMAYI DENE, SONRA DOLAŞMAYI.
    //
    // Eskiden bu kontrol yoktu ve sıra hiç kırmaya gelmiyordu: uzmanın
    // öncelik listesinde "yolumu açan bloğu kır" maddesi VAR, ama daha
    // yukarıdaki "yakındaki eşyayı al" maddesi önce eşleşip buraya
    // dallanıyordu. Yani yaprağın ardındaki odunu görüp sonsuza kadar
    // etrafından dolaşmaya çalışıyordu.
    //
    // Madende bu daha da kritik: cevhere giden yol TANIMI GEREĞİ taşın
    // içinden geçiyor. Kırmadan varılamaz.
    if (env.onumuKapatan()) {
      return { action: 3, sebep: etiket + '_engeli_kiriyorum' }
    }

    // Kıramıyoruz (kaya, oyuncunun evi, koruma bölgesi): dolaş.
    // Kaçınma sayacını kur ki dönüp hemen geri dönmeyelim.
    env.kacinmaAdimi = 3

    // ENGELİN ADINI GEREKÇEYE YAZ.
    //
    // Bu dal bir kez maden görevinin tamamını yedi: uzman 4 bölümde hiç
    // kırma yapmadı çünkü `tuff` ve `calcite` "kırılamaz" sayılıyordu.
    // Gerekçe sadece "engel_soldan_dolasiyorum" dediği için sebebi
    // bulmak iki tur sürdü. Artık `gorev_kontrol.py` dağılımında
    // "kiramadigim_tuff" diye görünüyor.
    const engel = env.onumdekiEngel()
    const ad = engel ? `_kiramadigim_${engel.name}` : ''

    const sol = env.solumKapali()
    const sag = env.sagimKapali()
    if (sol && !sag) return { action: 1, sebep: etiket + ad + '_sagdan_dolasiyorum' }
    if (sag && !sol) return { action: 2, sebep: etiket + ad + '_soldan_dolasiyorum' }

    // İkisi de aynıysa hedefe daha yakın olan yöne dön (deterministik)
    return fark >= 0
      ? { action: 2, sebep: etiket + ad + '_soldan_dolasiyorum' }
      : { action: 1, sebep: etiket + ad + '_sagdan_dolasiyorum' }
  }

  // Hizalı değiliz: hedefe dön
  return fark > 0
    ? { action: 2, sebep: etiket + '_donuyorum_sola' }
    : { action: 1, sebep: etiket + '_donuyorum_saga' }
}

/**
 * Uzmanı göreve göre seç.
 *
 * Ortam hangi görevdeyse onun uzmanı konuşuyor. İki uzman aynı yardımcı
 * fonksiyonları (`hedefeYonel`, açı hesapları) paylaşıyor — ayrıldıkları
 * tek yer öncelik listesi.
 */
function uzmanAksiyonu (bot, env) {
  return env.gorev && env.gorev.ad === 'maden'
    ? madenUzmani(bot, env)
    : odunUzmani(bot, env)
}

module.exports = {
  uzmanAksiyonu, odunUzmani, madenUzmani, hedefeYonel, yonel, hedefYaw, aciFarki
}
