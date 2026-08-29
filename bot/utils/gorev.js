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

/**
 * Pathfinder ile git — TAKILMA TESPİTİYLE.
 *
 * PROBLEM
 * Bot bir çıkıntının kenarında "koşuyor ama ilerlemiyor" durumuna
 * giriyordu. Pathfinder bir yol bulmuş, tuşlara basıyor, ama bot
 * fiziksel olarak takılı. Sadece süre sınırı koymak yetmiyor: 15
 * saniyelik zaman aşımını beklemek hem uzun, hem de bunu "yol
 * bulunamadı" gibi gösteriyor — oysa yol var, bot sıkışmış.
 *
 * ÇÖZÜM
 * Konumu izle. Belli bir süre boyunca hiç ilerlemiyorsa bu bir
 * takılmadır; beklemeye devam etmenin anlamı yok. Hemen durdur,
 * tuşları bırak, çağıran tarafa "takıldım" de — o da başka bir
 * hedefe geçebilsin.
 *
 * @returns {Promise<{ok:boolean, sebep?:string}>}
 */
async function pathfinderGit (bot, hedef, kontrol, {
  zamanAsimi = 15000,
  durgunlukMs = 4000,
  esik = 0.6,
  kurtarmayiDene = true
} = {}) {
  pathfinderHazirla(bot)

  let sonKonum = bot.entity.position.clone()
  let sonIlerleme = Date.now()
  let saat = null

  const takilmaSozu = new Promise((_resolve, reject) => {
    saat = setInterval(() => {
      try {
        if (bot.entity.position.distanceTo(sonKonum) > esik) {
          sonKonum = bot.entity.position.clone()
          sonIlerleme = Date.now()
        } else if (Date.now() - sonIlerleme > durgunlukMs) {
          reject(new Error('takildim'))
        }
      } catch (err) { /* bot yok olduysa zaman aşımı devralır */ }
    }, 500)
  })

  try {
    await sinirli(
      Promise.race([bot.pathfinder.goto(hedef), takilmaSozu]),
      zamanAsimi,
      kontrol
    )
    return { ok: true }
  } catch (err) {
    pathfinderDurdur(bot)
    try { bot.clearControlStates() } catch (e) {}
    if (err instanceof IptalEdildi) throw err
    if (saat) { clearInterval(saat); saat = null }

    const takildi = err.message === 'takildim'

    // TESPİT TEK BAŞINA YARIM ÇÖZÜM.
    //
    // Takıldığımızı anlamak botu kurtarmıyor: aynı dar yarıkta duruyor,
    // sadece artık bunu biliyor. Çağıran taraf başka bir hedefe geçiyor,
    // pathfinder yine yol bulamıyor, döngü baştan başlıyor. Ekran
    // görüntülerinde tekrar tekrar gördüğümüz buydu.
    //
    // Önce kurtul, sonra BİR KEZ daha dene. `kurtarmayiDene: false` ile
    // çağrıldığı için tekrar özyinelemeye girmiyor.
    if (takildi && kurtarmayiDene) {
      const { kurtar } = require('./kurtar')
      const kurtuldu = await kurtar(bot, kontrol)
      if (kurtuldu) {
        return pathfinderGit(bot, hedef, kontrol, {
          zamanAsimi: Math.min(zamanAsimi, 10000),
          durgunlukMs,
          esik,
          kurtarmayiDene: false
        })
      }
    }

    return { ok: false, sebep: takildi ? 'takildim' : 'yol_yok' }
  } finally {
    if (saat) clearInterval(saat)
  }
}

module.exports = {
  GorevKontrol, IptalEdildi, sinirli, pathfinderDurdur, pathfinderHazirla, pathfinderGit
}
