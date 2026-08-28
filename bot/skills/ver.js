'use strict'

const log = require('../utils/log')

/**
 * SKILL: Envanterdeki bir eşyayı oyuncuya at.
 *
 * Eşya adı tam eşleşmek zorunda değil — "odun" yazınca `oak_log` da bulunur.
 * Kullanıcı `stripped_dark_oak_log` yazmak zorunda kalmamalı.
 */

// Türkçe kısaltmalar: kullanıcı İngilizce blok adı ezberlemesin
const TAKMA_ADLAR = {
  odun: '_log',
  kütük: '_log',
  kutuk: '_log',
  tahta: '_planks',
  balta: '_axe',
  kazma: '_pickaxe',
  kürek: '_shovel',
  kurek: '_shovel',
  çubuk: 'stick',
  cubuk: 'stick',
  fidan: '_sapling',
  yaprak: '_leaves',
  elma: 'apple',
  tezgah: 'crafting_table'
}

function esyaBul (bot, arama) {
  const anahtar = TAKMA_ADLAR[arama] || arama
  const esyalar = bot.inventory.items()

  // Önce tam eşleşme, sonra içerenler
  return esyalar.find((i) => i.name === anahtar) ||
         esyalar.find((i) => i.name.includes(anahtar.replace(/^_/, ''))) ||
         null
}

async function ver (bot, oyuncuAdi, arama, adet = null) {
  if (!arama) {
    bot.chat('Ne vereyim? Örnek: "ver odun" ya da "ver odun 10"')
    return { basarili: false }
  }

  const esya = esyaBul(bot, arama)
  if (!esya) {
    const eldekiler = bot.inventory.items()
    bot.chat(eldekiler.length === 0
      ? 'Envanterim boş.'
      : `"${arama}" bende yok. Var olanlar: ${eldekiler.map((i) => i.name).join(', ')}`)
    return { basarili: false, hata: 'esya_yok' }
  }

  const oyuncu = bot.players[oyuncuAdi]
  if (oyuncu && oyuncu.entity) {
    // Ona doğru bakıp atalım ki eşya ayağının dibine düşsün
    try { await bot.lookAt(oyuncu.entity.position.offset(0, 1, 0), true) } catch (err) {}
  }

  const verilecek = adet ? Math.min(adet, esya.count) : esya.count

  try {
    await bot.toss(esya.type, null, verilecek)
    log.basari(`${verilecek} ${esya.name} verildi.`)
    bot.chat(`${verilecek} ${esya.name} verdim.`)
    return { basarili: true, esya: esya.name, adet: verilecek }
  } catch (err) {
    log.hata(`Veremedim: ${err.message}`)
    bot.chat(`Veremedim: ${err.message}`)
    return { basarili: false, hata: err.message }
  }
}

module.exports = { ver, esyaBul }
