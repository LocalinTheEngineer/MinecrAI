'use strict'
require('dotenv').config()

/**
 * Every setting in one place. Values come from .env; without a .env the
 * defaults here are used.
 */
const config = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT || '25565', 10),
  version: process.env.MC_VERSION || '1.20.4',
  username: process.env.MC_USERNAME || 'MinecrAI',
  auth: process.env.MC_AUTH || 'offline',
  bridgePort: parseInt(process.env.BRIDGE_PORT || '8765', 10),

  // Chat layer (bot/sohbet/). With no key it stays quietly off and the bot
  // keeps working from exact commands, so someone cloning the project can
  // run everything without an API key.
  //
  // Two providers are supported; whichever key exists is used. Gemini is
  // tried first because it has a free tier: this is a student portfolio and
  // should not need a credit card to run.
  geminiAnahtari: process.env.GEMINI_API_KEY || '',
  anthropicAnahtari: process.env.ANTHROPIC_API_KEY || '',
  sohbetSaglayici: process.env.SOHBET_SAGLAYICI || '', // empty = auto
  sohbetModeli: process.env.SOHBET_MODELI || '',       // empty = provider default

  // Bot behaviour settings
  searchRadius: 64, // how far to look when searching for resources
  // (was 32: in a cleared area it gave up with "no tree found". The server
  //  loads ~160 blocks of view distance, so 64 is still safe.)
  // (was 64: it found trees in unloaded chunks)
  maxLogsPerTree: 40 // max logs cut in one go
  // (was 12: dark oak and forest trees have 20+ logs, the flood fill stopped
  //  halfway and root and top never made the list. That was the real reason
  //  the bot cut the middle of a tree and walked off.)
}

module.exports = config
