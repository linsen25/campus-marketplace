/* global window, document, DOMException */
// Actual notification stream/player with deterministic Audio instrumentation.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const setup = fs.readFileSync(
  'tests/notification-preferences.browser.cjs',
  'utf8'
)
const { root, build, aliases } = new Function(
  'require',
  setup.slice(0, setup.indexOf('async function main()')) +
    '\nreturn {root,build,aliases}'
)(require)
async function main() {
  await build(aliases)
  for (const name of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, name))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.addInitScript(() => {
        window.audioLog = {
          instances: 0,
          plays: [],
          maxActive: 0,
          active: 0,
          rejected: 0,
          released: 0,
        }
        window.Audio = class {
          constructor(src) {
            this.src = src
            this.paused = true
            this.currentTime = 0
            window.audioLog.instances++
          }
          pause() {
            if (!this.paused) window.audioLog.active--
            this.paused = true
          }
          removeAttribute(name) {
            if (name === 'src') this.src = ''
          }
          load() {
            window.audioLog.released++
          }
          play() {
            window.audioLog.plays.push({
              src: this.src,
              volume: this.volume,
              loop: this.loop,
              time: this.currentTime,
              popup:
                document.querySelector('[aria-label="New notifications"]')
                  ?.children.length > 0,
            })
            if (window.blockAudio) {
              window.audioLog.rejected++
              return Promise.reject(
                new DOMException('Autoplay denied', 'NotAllowedError')
              )
            }
            this.paused = false
            window.audioLog.active++
            window.audioLog.maxActive = Math.max(
              window.audioLog.maxActive,
              window.audioLog.active
            )
            return Promise.resolve()
          }
        }
      })
      await p.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await p.evaluate(() => {
        window.feed = [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            event_type: 'new_message',
            created_at: '2026-01-01T00:00:00Z',
            read_at: null,
            destination: {},
          },
        ]
        window.show('buyer')
      })
      const toggle = (label) =>
        p.getByRole('switch', { name: label, exact: true })
      await toggle('Notification sounds').waitFor()
      assert.equal(await p.getByText(/Coming soon/).count(), 0)
      const count = () => p.evaluate(() => window.audioLog.plays.length)
      const settle = () => p.waitForTimeout(140)
      const set = async (label, key, value) => {
        if (
          (await toggle(label).getAttribute('aria-checked')) !== String(value)
        )
          await toggle(label).click()
        await p.waitForFunction(
          ({ key, value }) => window.store.buyer[key] === value,
          { key, value }
        )
        await settle()
      }
      const emit = (type) => p.evaluate((type) => window.emit(type), type)
      assert.equal(await count(), 0, 'initial unread/login hydration is silent')
      await emit('new_message')
      await settle()
      assert.equal(await count(), 0, 'B popup ON, sound OFF')
      assert(
        (await p
          .getByRole('button', { name: 'Dismiss notification', exact: true })
          .count()) > 0
      )
      await set('Notification sounds', 'sounds', true)
      let expected = 0
      for (const type of [
        'new_message',
        'order_cancelled',
        'price_drop',
        'notification_test',
      ]) {
        const n = await emit(type)
        expected++
        await p.waitForFunction(
          (n) => window.audioLog.plays.length === n,
          expected
        )
        await p.evaluate((n) => {
          window.signal({ changed: true, inserted: true, notification: n })
          window.reconnect()
        }, n)
        await settle()
        assert.equal(
          await count(),
          expected,
          'new category once, replay/refetch silent'
        )
      }
      const period = await p.evaluate(() => window.audioLog)
      assert.equal(period.instances, 1, 'one reused Audio instance')
      assert(
        period.plays.every(
          (x) =>
            x.src === '/static/sounds/notification.wav' &&
            x.volume === 0.45 &&
            x.loop === false &&
            x.time === 0 &&
            x.popup
        )
      )
      assert.equal(period.maxActive, 1, 'no overlapping players')
      await set('In-app notifications', 'inApp', false)
      await emit('new_message')
      await settle()
      assert.equal(await count(), expected, 'C in-app OFF/sound ON silent')
      assert.equal(
        await p
          .getByRole('button', { name: 'Dismiss notification', exact: true })
          .count(),
        0
      )
      await set('Notification sounds', 'sounds', false)
      await emit('order_cancelled')
      await settle()
      assert.equal(await count(), expected, 'D both OFF silent')
      const unread = await p.evaluate(
        () => window.feed.filter((n) => !n.read_at).length
      )
      await p
        .getByRole('button', {
          name: `Notifications, ${unread} unread`,
          exact: true,
        })
        .waitFor()
      await set('In-app notifications', 'inApp', true)
      await emit('price_drop')
      await settle()
      assert.equal(await count(), expected, 'B remains silent after re-enable')
      await set('Notification sounds', 'sounds', true)
      await set('Email notifications', 'email', false)
      await p.evaluate(() => (window.blockAudio = true))
      const blocked = await emit('notification_test')
      expected++
      await p.waitForFunction(
        (n) => window.audioLog.plays.length === n,
        expected
      )
      assert.equal(await p.evaluate(() => window.audioLog.rejected), 1)
      assert.equal(
        await p.getByRole('alert').count(),
        0,
        'autoplay rejection is non-disruptive'
      )
      await p.evaluate(
        (n) =>
          window.signal({ changed: true, inserted: true, notification: n }),
        blocked
      )
      await settle()
      assert.equal(await count(), expected, 'blocked event is not retried')
      await p.mouse.click(width - 4, 850)
      await p.evaluate(() => (window.blockAudio = false))
      await emit('new_message')
      expected++
      await p.waitForFunction(
        (n) => window.audioLog.plays.length === n,
        expected
      )
      assert.equal(
        await p.evaluate(() => window.store.buyer.email),
        false,
        'email independent'
      )
      const beforeBurst = await count()
      await p.evaluate(() => {
        for (let i = 0; i < 10; i++) window.emit('new_message')
      })
      await settle()
      const afterBurst = await count()
      assert(afterBurst > beforeBurst && afterBurst <= beforeBurst + 10)
      assert.equal(await p.evaluate(() => window.audioLog.maxActive), 1)
      assert.equal(
        await p
          .getByRole('button', { name: 'Dismiss notification', exact: true })
          .count(),
        width >= 1024 ? 3 : 1
      )
      await p.evaluate(() => {
        window.emit('new_message')
        window.end()
      })
      await settle()
      assert.equal(
        await count(),
        afterBurst,
        'in-flight notification after session end is silent'
      )
      await p.evaluate(() => window.show(null))
      assert.equal(
        await p.evaluate(() => window.audioLog.active),
        0,
        'logout stops audio'
      )
      await p.evaluate(() => window.show('buyer'))
      await toggle('Notification sounds').waitFor()
      await settle()
      assert.equal(
        await toggle('Notification sounds').getAttribute('aria-checked'),
        'true'
      )
      assert.equal(
        await count(),
        afterBurst,
        'remount/login with unread history is silent'
      )
      assert.equal(await p.evaluate(() => window.channels), 1)
      assert.equal(await p.locator('audio').count(), 0)
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS sound ' +
          width +
          ': A/B/C/D, four categories once, hydration/replay/refetch/remount silent, .45/reuse/restart, burst/no overlap, autoplay rejection/recovery, persistence/logout, no layout change'
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
