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

module.exports = { GorevKontrol, IptalEdildi, sinirli }
