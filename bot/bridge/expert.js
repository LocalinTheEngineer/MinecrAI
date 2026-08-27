'use strict'

/**
 * UZMAN POLİTİKA (expert policy)
 *
 * Milestone 3'ün temeli. Milestone 1'deki `chopTree` görevi doğru yapıyor ama
 * pathfinder kullanıyor — yani ajanın aksiyon uzayında ifade edilemiyor.
 *
 * Bu dosya aynı işi SADECE ajanın kullanabildiği 5 aksiyonla yapar:
 *   0 ileri yürü | 1 sağa dön | 2 sola dön | 3 kır | 4 bekle
 *
 * Böylece her adımda "bu gözlemde uzman ne yapardı?" sorusunun cevabını
 * üretebiliyoruz. Topladığımız (gözlem, aksiyon) çiftleri, taklit ederek
 * öğrenme (behaviour cloning) için eğitim verisi oluyor.
 *
 * Bu bir sinir ağı değil, elle yazılmış bir kural seti — amacı öğrenmek değil,
 * öğrenilecek örneği üretmek.
 */


// Bu açıdan fazla sapma varsa önce dönmek gerekir.
//
// Bu sayı environment.js'teki DONUS_ACISI'na bağlı: dönüş 22.5°'lik adımlarla
// yapıldığı için ulaşılabilecek en iyi hata 11.25°. Tolerans bundan küçük
// olursa uzman hedefi hiçbir zaman tutturamaz ve sağa-sola salınır.
const YAW_TOLERANS = 0.22  // ~12.6°, 11.25°'den güvenli miktarda büyük

// Bu mesafeden yakınsa kırmayı dene, uzaksa yürü
const KIRMA_MESAFESI = 4.0

/**
 * Bir hedefe bakmak için gereken yaw açısı (Minecraft konvansiyonu).
 * mineflayer'da yaw, -Z yönü 0 olacak şekilde ölçülür.
 */
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

/**
 * Bir hedefe doğru tek adım: hizalı değilsek dön, hizalıysak yürü.
 */
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
 * Öncelik sırası önemli — demo verisinin kalitesini bu belirliyor:
 *   1. Önümde kütük varsa kır (en yüksek getirili anlık iş)
 *   2. Yerde odun varsa üstüne git (ödülün asıl kaynağı: 1.0/odun)
 *   3. Ağaç varsa ona yönel
 *   4. Yapacak bir şey yoksa bekle
 *
 * @returns {{action: number, sebep: string}}
 */
function uzmanAksiyonu (bot, env) {
  // 1) Önümüzde kırılabilir kütük varsa: kır. Her şeyden önce gelir.
  //    env.onundekiKutuk() ile AYNI yordamı kullanıyoruz — uzman, ajanın
  //    göremediği bir bilgiye dayanmamalı.
  if (env.onundekiKutuk()) {
    return { action: 3, sebep: 'onumde_kutuk_var' }
  }

  // 1b) Yolumu kapatan bir şey varsa (genelde yaprak) onu kır.
  //     Bu olmadan bot ağaca yaklaşırken yaprak duvarında takılıp kalıyordu.
  if (env.onumuKapatan()) {
    return { action: 3, sebep: 'yolumu_aciyorum' }
  }

  // 2) Yerde odun varsa üstüne git — ödülün asıl kaynağı burası.
  //    mineflayer ~1 blok mesafede eşyayı otomatik alır.
  const esya = env.yakinEsya()
  if (esya) {
    return yonel(bot, esya.position, 'esyaya_donuyorum', 'esyaya_gidiyorum')
  }

  // 3) Ağaç varsa ona yönel
  const hedef = env.enYakinKutuk()
  if (!hedef) {
    return { action: 4, sebep: 'yapacak_is_yok' }
  }

  return yonel(bot, hedef.position, 'agaca_donuyorum', 'agaca_yaklasiyorum')
}

module.exports = { uzmanAksiyonu, yonel, hedefYaw, aciFarki }
