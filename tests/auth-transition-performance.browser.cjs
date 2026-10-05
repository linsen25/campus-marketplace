/* global window, document, performance, requestAnimationFrame, getComputedStyle, location, HTMLImageElement */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true, args: ['--enable-unsafe-swiftshader'] })
  try {
    for (const [name, delay] of [['fast', 0], ['slow', 5000], ['cards', 0], ['retry', 0]].filter(([name]) => !process.env.CASE || process.env.CASE === name)) {
      const page = await browser.newPage({ viewport: { width: Number(process.env.WIDTH || 1280), height: 900 } })
      const errors = []; page.on('pageerror', e => errors.push(e.stack || e.message))
      let signedIn = false
      // Deterministic fallback font; no dependency on Google's network latency.
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort())
      await page.route('**/api/auth/**', async route => {
        const action = new URL(route.request().url()).pathname.split('/').pop()
        if (action === 'session') {
          if (signedIn) await page.evaluate(() => window.trace.push({ event: 'username-response', t: performance.now() }))
          return route.fulfill({ json: { seller: signedIn ? { id: 'test', displayName: 'Tester' } : null } })
        }
        if (action === 'sign-in') {
          signedIn = true
          await page.evaluate(() => window.trace.push({ event: 'auth-response', t: performance.now() }))
        }
        return route.fulfill({ json: null })
      })
      await page.route('**/_next/data/**/listings.json*', async route => {
        await new Promise(resolve => setTimeout(resolve, delay))
        return route.fulfill({ json: { pageProps: { listings: [], values: { status: 'available', sort: 'newest', search: '', category: '', condition: '' }, page: 1, hasNextPage: false, error: null }, __N_SSP: true } })
      })
      await page.goto('http://localhost:3100/', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.evaluate(() => {
        window.trace = []; window.transitionFrames = []
        const decode = HTMLImageElement.prototype.decode
        HTMLImageElement.prototype.decode = async function () {
          if (window.slowCards && this.closest('[data-market-card]')) {
            await new Promise(resolve => setTimeout(resolve, 2500))
          }
          return decode.call(this)
        }
        const router = window.next.router
        for (const event of ['routeChangeStart', 'routeChangeComplete']) router.events.on(event, () => window.trace.push({ event, t: performance.now() }))
        const prefetch = router.prefetch.bind(router)
        router.prefetch = (...args) => { window.trace.push({ event: 'prefetch', t: performance.now() }); return prefetch(...args) }
        let previous = ''
        const tick = () => {
          const overlay = document.querySelector('[data-auth-success]')
          const text = overlay?.querySelector('[role="status"]')
          const frame = { t: performance.now(), phase: overlay?.dataset.authSuccess || '', text: text?.textContent || '', opacity: text ? getComputedStyle(overlay.querySelector('[data-success-content]')).opacity : '', form: !!document.querySelector('form[data-auth-mode]'), market: !!document.querySelector('#listing-sort-label'), ready: !!document.querySelector('[data-market-ready="true"]'), stage: document.querySelector('[data-market-preparation]')?.dataset.marketPreparation, steps: Array.from(document.querySelectorAll('[data-loading-step]')).map(e => e.dataset.state), elapsed: document.querySelector('[data-loading-timer]')?.textContent, home: !!document.querySelector('[data-slot="home-sidebar-demo"]'), wipe: !!document.querySelector('[data-route-phase]') }
          window.transitionFrames.push(frame)
          const key = [frame.phase, frame.text, frame.form, frame.market, frame.ready, frame.stage].join('|')
          if (key !== previous) { window.trace.push({ event: 'frame', ...frame }); previous = key }
          requestAnimationFrame(tick)
        }; tick()
      })
      if (name === 'cards') await page.evaluate(() => { window.slowCards = true })
      if (name === 'retry' && !process.env.BASELINE) await page.evaluate(() => {
        const push = window.next.router.push.bind(window.next.router)
        let fail = true
        window.next.router.push = (...args) => { if (fail) { fail = false; return Promise.reject(new Error('Test destination failure')) } return push(...args) }
      })
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      await auth.locator('#login-email').fill('tester@uwo.ca')
      await auth.locator('#login-password').fill('Abcdefg1!')
      await page.evaluate(() => window.trace.push({ event: 'submit', t: performance.now() }))
      await auth.getByRole('button', { name: 'Log in', exact: true }).click()
      await page.locator('[data-auth-success]').waitFor()
      if (name === 'retry' && !process.env.BASELINE) {
        await page.getByText('You are signed in, but Market could not open.').waitFor()
        assert.equal(await auth.count(), 0)
        assert.equal(await page.locator('[data-loading-step]').count(), 0, 'Failure stops progress')
        await page.getByRole('button', { name: 'Try opening Market again' }).click()
      }
      if ((delay || name === 'cards') && !process.env.BASELINE) {
        await page.locator('[data-auth-success="waiting"]').waitFor()
        const session = await page.context().newCDPSession(page)
        const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        fs.writeFileSync(`${process.env.TEMP}/auth-transition-waiting-${process.env.WIDTH || 1280}.png`, Buffer.from(shot.data, 'base64'))
        await session.detach()
      }
      try { await page.locator('[data-auth-success]').waitFor({ state: 'detached', timeout: 30000 }) } catch (error) {
        console.log('READINESS', await page.evaluate(() => ({ pathname: location.pathname, ready: document.querySelector('[data-market-ready]')?.getAttribute('data-market-ready'), canvas: document.querySelector('[data-market-background] canvas')?.dataset.rendered, label: !!document.querySelector('#listing-sort-label'), images: Array.from(document.querySelectorAll('[data-market-card] img')).slice(0, 5).map(e => ({ complete: e.complete, width: e.naturalWidth })), trace: window.trace })))
        throw error
      }
      const result = await page.evaluate(() => ({ trace: window.trace, frames: window.transitionFrames,
        chunks: performance.getEntriesByType('resource').filter(e => e.name.includes('/_next/static/') && e.name.endsWith('.js')).map(e => ({ file: new URL(e.name).pathname.split('/').pop(), start: e.startTime, duration: e.duration, bytes: e.transferSize })) }))
      const origin = result.trace.find(e => e.event === 'auth-response').t
      const timing = {}
      for (const event of ['routeChangeStart', 'username-response', 'routeChangeComplete']) timing[event] = Math.round(result.trace.find(e => e.event === event)?.t - origin)
      for (const phase of ['hold', 'waiting', 'fading', 'reveal']) timing[phase] = Math.round(result.frames.find(e => e.phase === phase)?.t - origin)
      for (const stage of ['fonts', 'assets', 'paint']) timing[stage] = Math.round(result.frames.find(e => e.stage === stage)?.t - origin)
      timing.ready = Math.round(result.frames.find(e => e.ready)?.t - origin)
      timing.visible = Math.round(result.frames.find(e => e.t > origin && !e.phase && e.ready)?.t - origin)
      console.log(`${process.env.BASELINE ? 'BEFORE' : 'AFTER'} ${name}:`, JSON.stringify(timing))
      fs.writeFileSync(`${process.env.TEMP}/auth-transition-${process.env.BASELINE ? 'before' : 'after'}-${name}.json`, JSON.stringify(result))
      if (!process.env.BASELINE) {
        const frames = result.frames.filter(f => f.t >= origin + 80)
        assert(!frames.some(f => f.phase && f.form), 'No auth form exists during success')
        assert(!frames.some(f => f.home), 'Home must not mount')
        assert(!frames.some(f => f.wipe), 'Desktop route wipe must not run during auth success')
        const fade = frames.find(f => f.phase === 'fading')
        const ready = frames.find(f => f.ready)
        const hold = frames.find(f => f.phase === 'hold')
        const reveal = frames.find(f => f.phase === 'reveal')
        assert(fade && ready && hold && reveal)
        assert(frames.every(f => f.steps.filter(s => s === 'active').length <= 1))
        assert.deepEqual(fade.steps, ['complete', 'complete', 'complete', 'complete'])
        if (name === 'cards') {
          const stalled = frames.filter(f => f.stage === 'assets' && f.steps[2] === 'active')
          assert(stalled.length > 30, 'Real card decoding keeps card step active')
          assert(stalled.every(f => f.steps.length === 3 && !f.ready))
        }
        if (name === 'slow') {
          const waiting = frames.filter(f => !f.market && f.steps[0] === 'active')
          assert(waiting.length > 10 && waiting.every(f => f.steps.length === 1), 'No future rows before route starts')
          assert(new Set(waiting.map(f => f.elapsed)).size > 3, 'Live timer increments')
        }
        const afterReady = frames.filter(f => f.ready && f.elapsed && f.phase === 'fading')
        assert(new Set(afterReady.map(f => f.elapsed)).size === 1, 'Timer freezes at readiness')
        assert(fade.t >= ready.t && fade.t - hold.t >= 140)
        assert(reveal.t - fade.t >= 180 && reveal.opacity < 0.01)
        if (delay) {
          const waiting = frames.filter(f => f.phase === 'waiting' && !f.ready)
          assert(waiting.length > 10)
          assert(waiting.every(f => f.text === 'Welcome back, Tester' && Number(f.opacity) > 0.99))
        }
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exitCode = 1 })
