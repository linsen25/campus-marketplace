/* global window, fetch */
// Real staging sessions; no transaction writes. Socket diagnostics are counts only.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000'
const staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
async function main() {
  const html = await (await fetch(base + '/home')).text()
  let bound = false
  for (const m of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const s = (await (await fetch(new URL(m[1], base))).text()).replaceAll(
      String.fromCharCode(92, 34),
      '"'
    )
    assert(
      !/(?:var|let|const)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs/.test(s)
    )
    bound ||=
      /(?:var|let|const)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo/.test(s)
  }
  assert(bound)
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  try {
    for (const [key, role] of [
      ['seller-a', 'selling'],
      ['buyer-a', 'buying'],
    ]) {
      const context = await browser.newContext({ serviceWorkers: 'block' })
      await context.route('**/*', (route) => {
        const req = route.request(),
          url = new URL(req.url())
        if (![base, staging].includes(url.origin)) return route.abort()
        if (req.method() === 'POST' && url.pathname.endsWith('/read'))
          return route.fulfill({ json: { unread_count: 0 } })
        if (
          req.method() !== 'GET' &&
          !['/api/auth/sign-in', '/api/messages/realtime-session'].includes(
            url.pathname
          )
        )
          return route.abort()
        return route.continue()
      })
      assert.equal(
        (
          await context.request.post(base + '/api/auth/sign-in', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: {
              email: credentials[key].email,
              password: credentials[key].password,
            },
          })
        ).status(),
        200
      )
      const page = await context.newPage()
      let errors = 0
      page.on('pageerror', () => errors++)
      await page.addInitScript(() => {
        window.__a1 = { active: 0, maximum: 0, privateJoin: false, joins: 0 }
        const Original = window.WebSocket
        window.WebSocket = class extends Original {
          constructor(...args) {
            super(...args)
            this.pending = new Set()
            this.joined = false
            this.addEventListener('message', (e) => {
              try {
                const raw = JSON.parse(e.data)
                const m = Array.isArray(raw)
                  ? {
                      ref: raw[1],
                      topic: raw[2],
                      event: raw[3],
                      payload: raw[4],
                    }
                  : raw
                if (
                  m.event === 'phx_reply' &&
                  m.payload?.status === 'ok' &&
                  this.pending.has(m.ref)
                ) {
                  this.pending.delete(m.ref)
                  if (!this.joined) {
                    this.joined = true
                    window.__a1.active++
                    window.__a1.joins++
                    window.__a1.maximum = Math.max(
                      window.__a1.maximum,
                      window.__a1.active
                    )
                  }
                }
              } catch {
                /* No raw socket payload leaves the browser. */
              }
            })
            this.addEventListener('close', () => {
              if (this.joined) {
                this.joined = false
                window.__a1.active--
              }
            })
          }
          send(data) {
            try {
              const raw = JSON.parse(data)
              const m = Array.isArray(raw)
                ? { ref: raw[1], topic: raw[2], event: raw[3], payload: raw[4] }
                : raw
              if (
                m.topic?.includes('marketplace:messages:') &&
                m.event === 'phx_join'
              ) {
                window.__a1.privateJoin ||= m.payload?.config?.private === true
                this.pending.add(m.ref)
              }
            } catch {
              /* Counts only. */
            }
            return super.send(data)
          }
        }
      })
      await page.goto(base + '/home?section=messages&destination=' + role)
      await page
        .waitForFunction(() => window.__a1.active === 1, null, {
          timeout: 30000,
        })
        .catch(async (error) => {
          console.log(
            JSON.stringify({
              role,
              diagnostics: await page.evaluate(() => window.__a1),
              runtimeErrors: errors,
            })
          )
          throw error
        })
      const stats = await page.evaluate(() => ({ ...window.__a1 }))
      assert.equal(stats.maximum, 1)
      assert.equal(stats.privateJoin, true)
      assert.equal(errors, 0)
      for (const path of [
        '/api/messages/conversations?role=buying',
        '/api/messages/conversations?role=selling',
      ])
        assert.equal((await context.request.get(base + path)).status(), 200)
      assert.equal(
        (
          await context.request.post(base + '/api/messages/realtime-session', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: {},
          })
        ).status(),
        200
      )
      console.log(
        JSON.stringify({
          role,
          ...stats,
          runtimeErrors: errors,
          apiStatuses: [200, 200, 200],
          transactionWrites: 0,
        })
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
