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
// En fazla kaç iş arka arkaya istenebilir. Sınır var çünkü model uzun bir
// liste uydurursa bot dakikalarca meşgul kalır; "dur" her zaman çalışıyor
// ama oyuncunun beklemek zorunda kalması da bir maliyet.
const MAKS_ADIM = 4

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

/**
 * Araç tanımı — SAĞLAYICIDAN BAĞIMSIZ.
 *
 * Her sağlayıcı bunu kendi API'sinin şekline çeviriyor
 * (Anthropic `input_schema`, Gemini `parameters`). Şemanın kendisi
 * ikisinde de JSON Schema, o yüzden tek yerde duruyor.
 */
function aracTanimi () {
  const satirlar = Object.entries(IZINLI_KOMUTLAR)
    .map(([k, a]) => `- ${k}: ${a}`)
    .join('\n')

  return {
    ad: 'komut_calistir',
    aciklama:
      'Botun bir işi yapmasını sağlar. SADECE oyuncu gerçekten bir iş ' +
      'istediyse kullan; sohbet ya da soru ise bunu çağırma, düz metinle cevap ver.\n\n' +
      'Kullanılabilir komutlar:\n' + satirlar,
    sema: {
      type: 'object',
      properties: {
        adimlar: {
          type: 'array',
          maxItems: MAKS_ADIM,
          description:
            'Sırayla çalıştırılacak komutlar. Tek iş için tek eleman yaz. ' +
            'Oyuncu birden fazla iş istediyse ("önce odun kes sonra kazma yap") ' +
            'hepsini SIRAYLA buraya koy — bot birini bitirmeden diğerine geçmez.',
          items: {
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
        }
      },
      required: ['adimlar']
    }
  }
}

/**
 * Tek bir adımı çalıştırılabilir komut satırına çevirir.
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

/**
 * Modelin döndürdüğü adım listesini komut satırlarına çevirir.
 *
 * Neden liste: bot tek komut alabildiği sürece "önce odun kes sonra kazma
 * yap" gibi sıradan bir istek çalışmıyordu — model niyeti anlıyor ama
 * ifade edemiyordu. Beceriler değişmedi, sadece kaç tanesinin arka arkaya
 * istenebileceği değişti.
 *
 * TEKİL BİÇİM DE KABUL EDİLİYOR: model bazen `adimlar` yerine doğrudan
 * `{komut, arguman}` döndürüyor. Şema listeyi zorunlu kılıyor ama modelin
 * şemaya uyacağına güvenip cevabı çöpe atmak gereksiz katılık.
 *
 * Geçersiz adımlar atılıyor, geçerliler kalıyor: üç adımın ikisi tanınıyorsa
 * o ikisini yapmak hiçbirini yapmamaktan iyi.
 */
function komutSatirlari (girdi) {
  if (!girdi) return []
  const ham = Array.isArray(girdi.adimlar) ? girdi.adimlar : [girdi]
  return ham.slice(0, MAKS_ADIM).map(komutSatiri).filter(Boolean)
}

module.exports = {
  IZINLI_KOMUTLAR, MAKS_ADIM, aracTanimi, komutSatiri, komutSatirlari
}
