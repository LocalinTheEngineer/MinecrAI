'use strict'

const { goals } = require('mineflayer-pathfinder')
const { kutukMu, oduncuSay } = require('../skills/chopTree')
const config = require('../config')

const MAX_ADIM = 500
const HEDEF_ODUN = 5

/**
 * Botu bir RL "environment"ına çeviren katman.
 *
 * Python tarafı sadece şunu bilir: reset() ver, step(action) ver, karşılığında
 * gözlem + ödül al. Minecraft'ın karmaşası bu dosyada kalır.
 */
class MinecraftEnvironment {
  constructor (bot) {
    this.bot = bot
    this.adim = 0
    this.oncekiOdun = 0
    this.oncekiMesafe = null
  }

  // ---------------------------------------------------------------- gözlem

  enYakinKutuk () {
    return this.bot.findBlock({
      matching: (b) => kutukMu(b),
      maxDistance: config.searchRadius
    })
  }

  gozlem () {
    const bot = this.bot
    const p = bot.entity.position
    const kutuk = this.enYakinKutuk()

    let dx = 0; let dy = 0; let dz = 0; let mesafe = 1
    if (kutuk) {
      const fark = kutuk.position.minus(p)
      mesafe = Math.max(fark.norm(), 0.001)
      dx = fark.x / mesafe
      dy = fark.y / mesafe
      dz = fark.z / mesafe
      mesafe = Math.min(mesafe / config.searchRadius, 1)
    }

    const baktigi = bot.blockAtCursor(5)

    return [
      dx, dy, dz,
      mesafe,
      bot.entity.yaw / Math.PI,
      bot.entity.pitch / Math.PI,
      Math.min(oduncuSay(bot) / 16, 1),
      (bot.health ?? 20) / 20,
      (bot.food ?? 20) / 20,
      kutukMu(baktigi) ? 1 : 0,
      bot.entity.onGround ? 1 : 0,
      this.adim / MAX_ADIM
    ]
  }

  /** Ham mesafe (normalize edilmemiş) — ödül hesabı için */
  hamMesafe () {
    const kutuk = this.enYakinKutuk()
    if (!kutuk) return null
    return kutuk.position.distanceTo(this.bot.entity.position)
  }

  // ---------------------------------------------------------------- aksiyon

  async aksiyonUygula (action) {
    const bot = this.bot
    let kirilanKutuk = 0

    switch (action) {
      case 0: // ileri yürü
        bot.setControlState('forward', true)
        await this.bekle(500)
        bot.setControlState('forward', false)
        break

      case 1: // sağa dön
        await bot.look(bot.entity.yaw - Math.PI / 4, bot.entity.pitch, true)
        break

      case 2: // sola dön
        await bot.look(bot.entity.yaw + Math.PI / 4, bot.entity.pitch, true)
        break

      case 3: { // baktığı bloğu kır
        const hedef = bot.blockAtCursor(5)
        if (hedef && bot.canDigBlock(hedef)) {
          const kutuktu = kutukMu(hedef)
          try {
            await bot.dig(hedef)
            if (kutuktu) kirilanKutuk = 1
          } catch (err) { /* kıramadıysa ceza zaten zaman cezası */ }
        }
        break
      }

      case 4: { // en yakın kütüğe doğru bir adım
        const kutuk = this.enYakinKutuk()
        if (kutuk) {
          try {
            await this.zamanAsimiyla(
              bot.pathfinder.goto(new goals.GoalNear(
                kutuk.position.x, kutuk.position.y, kutuk.position.z, 2
              )),
              4000
            )
          } catch (err) { bot.pathfinder.stop() }
        }
        break
      }

      case 5: // bekle
      default:
        await this.bekle(200)
        break
    }

    return kirilanKutuk
  }

  // ---------------------------------------------------------------- döngü

  async reset () {
    this.adim = 0
    this.bot.pathfinder.stop()
    this.bot.clearControlStates()
    this.oncekiOdun = oduncuSay(this.bot)
    this.oncekiMesafe = this.hamMesafe()

    return { obs: this.gozlem(), info: { odun: 0, adim: 0 } }
  }

  async step (action) {
    this.adim++

    const kirilanKutuk = await this.aksiyonUygula(action)

    // --- ödül hesabı ---
    const odun = oduncuSay(this.bot)
    const yeniOdun = odun - this.oncekiOdun
    this.oncekiOdun = odun

    const mesafe = this.hamMesafe()
    let yaklasma = 0
    if (mesafe !== null && this.oncekiMesafe !== null) {
      yaklasma = this.oncekiMesafe - mesafe
    }
    this.oncekiMesafe = mesafe

    const reward =
      1.00 * yeniOdun +
      0.20 * kirilanKutuk +
      0.05 * yaklasma -
      0.01

    const terminated = odun >= HEDEF_ODUN || this.bot.health <= 0
    const truncated = this.adim >= MAX_ADIM

    return {
      obs: this.gozlem(),
      reward,
      terminated,
      truncated,
      info: { odun, adim: this.adim, yeniOdun, kirilanKutuk }
    }
  }

  // ---------------------------------------------------------------- yardımcı

  bekle (ms) {
    return new Promise((r) => setTimeout(r, ms))
  }

  zamanAsimiyla (soz, ms) {
    return Promise.race([
      soz,
      new Promise((_, red) => setTimeout(() => red(new Error('zaman asimi')), ms))
    ])
  }
}

module.exports = { MinecraftEnvironment, MAX_ADIM, HEDEF_ODUN }
