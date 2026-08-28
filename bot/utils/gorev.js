'use strict'

/**
 * Görev iptal mekanizması.
 *
 * Problem: bot ağaç keserken "dur" yazdığımızda, kesme döngüsü kendi hâlinde
 * dönmeye devam ediyordu — kimse ona "bırak" demiyordu.
 *
 * Çözüm: uzun süren her işe bu nesneyi veriyoruz. İş, her adımın başında
 * `kontrol.kontrolEt()` çağırıyor; iptal bayrağı kalkmışsa bu çağrı hata
 * fırlatıp döngüyü kırıyor.
 */

class IptalEdildi extends Error {
  constructor () {
    super('gorev_iptal_edildi')
    this.name = 'IptalEdildi'
  }
}

class GorevKontrol {
  constructor () {
    this.iptalIstendi = false
    this.calisiyor = false
  }

  /** Yeni bir görev başlarken çağrılır */
  baslat () {
    this.iptalIstendi = false
    this.calisiyor = true
  }

  /** Görev bittiğinde çağrılır */
  bitir () {
    this.calisiyor = false
    this.iptalIstendi = false
  }

  /** "dur" komutu bunu çağırır */
  durdur () {
    this.iptalIstendi = true
  }

  /** Uzun işlerin içinden düzenli olarak çağrılır — iptal varsa döngüyü kırar */
  kontrolEt () {
    if (this.iptalIstendi) throw new IptalEdildi()
  }

  /** İptal edilebilir bekleme */
  async bekle (ms, adim = 100) {
    const bitis = Date.now() + ms
    while (Date.now() < bitis) {
      this.kontrolEt()
      await new Promise((r) => setTimeout(r, Math.min(adim, bitis - Date.now())))
    }
  }
}

/** Bir sözü hem zaman aşımıyla hem iptalle sınırla */
async function sinirli (soz, ms, kontrol) {
  return Promise.race([
    soz,
    new Promise((_, red) => setTimeout(() => red(new Error('zaman_asimi')), ms)),
    new Promise((_, red) => {
      const t = setInterval(() => {
        if (kontrol && kontrol.iptalIstendi) {
          clearInterval(t)
          red(new IptalEdildi())
        }
      }, 100)
      soz.finally(() => clearInterval(t)).catch(() => {})
    })
  ])
}

/**
 * pathfinder.stop() GÜVENLİ HÂLİ.
 *
 * mineflayer-pathfinder'da `stop()` yolu hemen kesmiyor, sadece `stopPathing`
 * diye kalıcı bir MANDAL kaldırıyor. Mandal ancak bir sonraki `resetPath`
 * çağrısında tüketiliyor — ve `goto()` işe tam olarak `setGoal -> resetPath`
 * ile başlıyor.
 *
 * Sonuç: bir yerde `stop()` çağırıp mandalı bırakırsan, BİR SONRAKİ `goto()`
 * daha yol hesabına başlamadan "Path was stopped before it could be completed"
 * diye reddediliyor. Hata mesajı sanki arazi sorunuymuş gibi görünüyor ama
 * sebebi tamamen bizim önceki çağrımız.
 *
 * Bu yüzden her `stop()` sonrası `setGoal(null)` ile mandalı tüketiyoruz.
 */
function pathfinderDurdur (bot) {
  try {
    bot.pathfinder.stop()
    bot.pathfinder.setGoal(null) // mandalı tüket, yoksa sonraki goto ölür
  } catch (err) { /* pathfinder yüklü değilse önemsiz */ }
}

/**
 * Yeni bir `goto()` öncesi çağrılır: başka bir yerde bırakılmış mandal varsa
 * temizler. Savunma amaçlı — mandalın kaynağını her zaman bilemiyoruz.
 */
function pathfinderHazirla (bot) {
  try {
    bot.pathfinder.setGoal(null)
  } catch (err) { /* önemsiz */ }
}

module.exports = { GorevKontrol, IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla }
