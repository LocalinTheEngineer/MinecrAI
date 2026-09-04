'use strict'
require('dotenv').config()

/**
 * Tüm ayarlar tek yerde. Değerler .env dosyasından okunur,
 * .env yoksa buradaki varsayılanlar kullanılır.
 */
const config = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT || '25565', 10),
  version: process.env.MC_VERSION || '1.20.4',
  username: process.env.MC_USERNAME || 'MinecrAI',
  auth: process.env.MC_AUTH || 'offline',
  bridgePort: parseInt(process.env.BRIDGE_PORT || '8765', 10),

  // SOHBET KATMANI (bot/sohbet/). Anahtar yoksa sessizce kapalı:
  // bot tam komutlarla çalışmaya devam eder. Projeyi klonlayan birinin
  // API anahtarı olmadan da her şeyi çalıştırabilmesi gerekiyor.
  //
  // İki sağlayıcı destekleniyor; hangi anahtar varsa o kullanılır.
  // Gemini'nin ÜCRETSİZ katmanı olduğu için o önce deneniyor —
  // bu bir öğrenci portföyü, çalışması için kredi kartı gerekmemeli.
  geminiAnahtari: process.env.GEMINI_API_KEY || '',
  anthropicAnahtari: process.env.ANTHROPIC_API_KEY || '',
  sohbetSaglayici: process.env.SOHBET_SAGLAYICI || '', // boş = otomatik
  sohbetModeli: process.env.SOHBET_MODELI || '',       // boş = sağlayıcının varsayılanı

  // Botun davranış ayarları
  searchRadius: 64, // kaynak ararken kaç blok uzağa bakılsın
  // (32'ydi: temizlenmiş bir alanda "ağaç bulamadım" deyip pes ediyordu.
  //  Sunucu görüş mesafesi ~160 blok yüklüyor, 64 hâlâ güvenli.)
  // (64 idi: yüklenmemiş chunk'lardaki ağaçları buluyordu)
  maxLogsPerTree: 40 // tek seferde en fazla kaç kütük kesilsin
  // (12'ydi: koyu meşe/orman ağaçları 20+ kütük, yayılma ortada kesiliyor,
  //  kök ve tepe listeye hiç girmiyordu — botun ağacın ortasını kesip
  //  gitmesinin asıl sebebi buydu)
}

module.exports = config
