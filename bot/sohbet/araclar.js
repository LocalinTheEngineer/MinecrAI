'use strict'

/**
 * Tool definition handed to the LLM.
 *
 * The model does not produce free text or code, it picks a command from a
 * fixed list. Execution still goes through the existing router in
 * `bot/index.js`, so the chat layer widens how the bot is asked for things,
 * not what it can do.
 *
 * In-game chat is untrusted input. On a single-player local server the threat
 * is small, but the worst anything a player types can cause is a legitimate
 * command from this list running. The model cannot say "delete that file"
 * because no such option exists.
 *
 * What is left out is deliberate too:
 *   koru / korumalar / korumasil — protection zones are the player's own
 *   call, and `korumasil` is destructive: one misunderstanding wipes every
 *   zone and there is no undo.
 *   yersil — same reason. Saving and walking to a place is safe, deleting
 *   one the player spent time marking is not.
 *   korun — turns on fighting back automatically, on a world the model
 *   cannot see. Pets, villagers and other players are all in swinging
 *   range of that decision.
 */

// Commands the model can pick from. Key = command, value = what it does.
// How many jobs can be queued in one go. Capped because a model that invents
// a long list keeps the bot busy for minutes; "dur" always works, but making
// the player wait is a cost too.
const MAKS_ADIM = 4

const IZINLI_KOMUTLAR = {
  gel: 'Oyuncunun yanına yürür. Argüman almaz.',
  git: 'Bir koordinata ya da kayıtlı bir yere yürür. Argüman: "<x> <y> <z>" (örn "120 64 -300"), sadece "<x> <z>" ya da kayıtlı yer adı (örn "ev").',
  burasi: 'Oyuncunun durduğu noktayı verilen adla kaydeder, sonra "git <ad>" ile oraya gidilir. Argüman: yer adı, örn "ev", "koy".',
  yerler: 'Kayıtlı yerleri chat\'e yazar. Argüman almaz.',
  ye: 'Envanterindeki en iyi yemeği yer. Argüman almaz.',
  savas: 'Yakındaki düşman yaratığa saldırır (creeper\'a bulaşmaz, ondan uzaklaşır). Argüman: arama yarıçapı, örn "10". Boş bırakılabilir.',
  platform: 'Ayağının altına kare bir zemin örer. Argüman: kenar uzunluğu 1-7, örn "3".',
  duvar: 'Baktığı yöne duvar örer. Argüman: "<en> [yukseklik]", örn "3 2".',
  kapat: 'Tam önündeki 1 genişlik 2 yükseklik boşluğu kapatır. Argüman almaz.',
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
 * Provider-independent tool definition.
 *
 * Each provider reshapes it for its own API (Anthropic `input_schema`,
 * Gemini `parameters`). The schema itself is JSON Schema in both, so it
 * lives in one place.
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
                  'uret için "tas kazma", kaz için "demir 5", git için "ev" ya da "120 64 -300".'
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
 * Turns one step into a runnable command line.
 *
 * Validation happens here; model output is not trusted. Unknown commands are
 * rejected and characters that could break the command line are stripped from
 * the argument. The model behaves today, maybe not after a version bump.
 */
function komutSatiri (girdi) {
  if (!girdi || typeof girdi.komut !== 'string') return null
  const komut = girdi.komut.trim().toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(IZINLI_KOMUTLAR, komut)) return null

  let arguman = typeof girdi.arguman === 'string' ? girdi.arguman : ''
  // Letters, digits, spaces and Turkish characters only. No newlines and no
  // '/': something starting with '/' can be read as a server command.
  // '-' is allowed because coordinates are negative half the time; stripping
  // it turned "git 100 64 -300" into a walk to +300. '/' stays out: an
  // argument starting with it can be read as a server command.
  arguman = arguman.toLowerCase().replace(/[^a-z0-9çğıöşü\-\s]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 40)

  return arguman ? `${komut} ${arguman}` : komut
}

/**
 * Turns the model's step list into command lines.
 *
 * A list rather than a single command because "chop wood then make a pickaxe"
 * did not work while the bot took one command at a time: the model got the
 * intent but could not express it. The skills did not change, only how many
 * of them can be asked for in a row.
 *
 * The singular shape is accepted as well, since the model sometimes returns
 * `{komut, arguman}` instead of `adimlar`. The schema requires the list, but
 * throwing away a usable answer over that is needless strictness.
 *
 * Invalid steps are dropped and valid ones kept: if two of three steps are
 * recognised, doing those two beats doing nothing.
 */
function komutSatirlari (girdi) {
  if (!girdi) return []
  const ham = Array.isArray(girdi.adimlar) ? girdi.adimlar : [girdi]
  return ham.slice(0, MAKS_ADIM).map(komutSatiri).filter(Boolean)
}

module.exports = {
  IZINLI_KOMUTLAR, MAKS_ADIM, aracTanimi, komutSatiri, komutSatirlari
}
