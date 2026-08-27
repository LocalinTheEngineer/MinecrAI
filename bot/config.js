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

  // Botun davranış ayarları
  searchRadius: 64,   // kaynak ararken kaç blok uzağa bakılsın
  maxLogsPerTree: 12  // tek seferde en fazla kaç kütük kesilsin
}

module.exports = config
