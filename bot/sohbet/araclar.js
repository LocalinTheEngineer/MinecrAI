'use strict'

/**
 * LLM'e verilecek ARAÇ TANIMI.
 *
 * TASARIMIN EN ÖNEMLİ KARARI BURADA: model serbest metin ya da kod
 * üretmiyor, SABİT BİR LİSTEDEN komut seçiyor. Çalıştıran yine
 * `bot/index.js` içindeki mevcut yönlendirici — yani sohbet katmanı
 * botun yapabileceklerini genişletmiyor, sadece nasıl istendiğini
 * genişletiyor.
 *
 * Neden böyle: oyun içi chat GÜVENİLMEZ girdi. Tek kişilik yerel
 * sunucuda tehdit küçük ama tasarım ilkesi aynı — başka bir oyuncu
 * bota ne yazarsa yazsın, olabilecek en kötü şey bu listedeki meşru
 * bir komutun çalışmasıdır. Model "şu dosyayı sil" diyemez, çünkü
 * öyle bir seçenek yok.
 *
 * Listede OLMAYANLAR da bilinçli:
 *   koru / korumalar / korumasil — koruma bölgeleri oyuncunun kendi
 *   kararı olmalı. `korumasil` yıkıcı: bir yanlış anlama bütün koruma
 *   bölgelerini siler ve geri alınamaz.
 */

// Modelin seçebileceği komutlar. Anahtar = komut, değer = ne işe yaradığı.
const IZINLI_KOMUTLAR = {
  gel: 'Oyuncunun yanına yürür. Argüman almaz.',
  kes: 'Ağaç keser. Argüman: adet (1-64) ya da "surekli". Boş bırakılırsa 1 ağaç.',
  kaz: 'Yer altına inip cevher kazar. Argüman: "<cevher> [adet]", örn "demir 5", "elmas", "tas 20".',
  uret: 'Bir eşya üretir; eksik ham maddeyi kendi toplar ve eritir. Argüman: "<esya> [adet]", örn "tas kazma", "cubuk 8", "demir kazma".',
  balta: 'Envanterindeki odundan tahta balta yapar. Argüman almaz.',
  ver: 'Oyuncuya eşya atar. Argüman: "<esya> [adet]", örn "odun 10", "kazma".',
  cik: 'Sütun örerek yüzeye çıkar (mağarada sıkıştıysa). Argüman almaz.',
  takip: 'Oyuncunun peşinden gelmeye başlar. Argüman almaz.',
  takipbirak: 'Takibi bırakır. Argüman almaz.',
  envanter: 'Envanterini chat\'e yazar. Argüman almaz.',
  nerede: 'Koordinatlarını chat\'e yazar. Argüman almaz.',
  dur: 'Yaptığı işi anında bırakır. Argüman almaz.',
  komut: 'Bütün komutların listesini chat\'e yazar. Argüman almaz.'
}

/** Anthropic araç şeması — model bu biçimde cevap veriyor. */
function aracSemasi () {
  const satirlar = Object.entries(IZINLI_KOMUTLAR)
    .map(([k, a]) => `- ${k}: ${a}`)
    .join('\n')

  return [{
    name: 'komut_calistir',
    description:
      'Botun bir işi yapmasını sağlar. SADECE oyuncu gerçekten bir iş ' +
      'istediyse kullan; sohbet ya da soru ise bunu çağırma, düz metinle cevap ver.\n\n' +
      'Kullanılabilir komutlar:\n' + satirlar,
    input_schema: {
      type: 'object',
      properties: {
        komut: {
          type: 'string',
          enum: Object.keys(IZINLI_KOMUTLAR),
          description: 'Çalıştırılacak komut'
        },
        arguman: {
          type: 'string',
          description:
            'Komutun argümanı, yoksa boş bırak. Örn kes için "3", ' +
            'uret için "tas kazma", kaz için "demir 5".'
        }
      },
      required: ['komut']
    }
  }]
}

/**
 * Modelin seçtiğini çalıştırılabilir bir komut satırına çevirir.
 *
 * DOĞRULAMA BURADA, model çıktısına güvenmiyoruz: bilinmeyen komut
 * reddediliyor ve argümandan komut satırını bozabilecek karakterler
 * atılıyor. Model bugün uslu, yarın sürüm değişince olmayabilir.
 */
function komutSatiri (girdi) {
  if (!girdi || typeof girdi.komut !== 'string') return null
  const komut = girdi.komut.trim().toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(IZINLI_KOMUTLAR, komut)) return null

  let arguman = typeof girdi.arguman === 'string' ? girdi.arguman : ''
  // Sadece harf, rakam, boşluk ve Türkçe karakter. Yeni satır ve '/' yok:
  // '/' ile başlayan bir şey sunucu komutu olarak yorumlanabilir.
  arguman = arguman.toLowerCase().replace(/[^a-z0-9çğıöşü\s]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 40)

  return arguman ? `${komut} ${arguman}` : komut
}

module.exports = { IZINLI_KOMUTLAR, aracSemasi, komutSatiri }
