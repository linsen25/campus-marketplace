/* global location, document, window, MutationObserver, performance, getComputedStyle, requestAnimationFrame */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
const base = process.env.BASE_URL || 'http://localhost:3100'
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 768, 834, 1280, 1536].filter(w => !process.env.WIDTH || w === Number(process.env.WIDTH))) {
      for (const reduced of [false, true].filter(r => !process.env.MOTION || r === (process.env.MOTION === 'reduced'))) {
        console.log(`Checking ${width} ${reduced ? 'reduced' : 'motion'}`)
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
          serviceWorkers: 'block',
        })
        let signedIn = false
        await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort())
        let delay = 50
        let failSend = false
        let submits = 0
        await page.route('**/api/auth/**', async (route) => {
          const action = new URL(route.request().url()).pathname.split('/').pop()
          if (action === 'session') return route.fulfill({ json: {
            seller: signedIn ? { id: 'test', displayName: 'Tester' } : null,
          } })
          if (action === 'username-availability') return route.fulfill({ json: { available: true } })
          if (action === 'signup-code') {
            await new Promise((resolve) => { setTimeout(resolve, delay) })
            return route.fulfill({ status: failSend ? 400 : 200,
              json: failSend ? { error: 'Test send failure' } : null })
          }
          if (['sign-in', 'verify-signup'].includes(action)) {
            signedIn = true
            submits++
          }
          return route.fulfill({ json: null })
        })
        await page.route('**/_next/data/**/listings.json*', (route) => {
          return route.fulfill({ json: { pageProps: {
            listings: [], values: { status: 'available', sort: 'newest', search: '', category: '', condition: '' },
            page: 1, hasNextPage: false, error: null,
          }, __N_SSP: true } })
        })
        const auth = page.locator('dialog[aria-labelledby="auth-title"]')
        const open = async () => {
          await page.goto(base, { waitUntil: 'domcontentloaded' })
          await page.getByRole('button', { name: 'Log in', exact: true }).click()
          await auth.waitFor()
        }
        const signup = async () => {
          await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
          await auth.locator('form[data-auth-mode="signup"]').waitFor()
          await page.waitForTimeout(200)
        }
        const fields = async () => {
          await auth.locator('[name$="-email"]').fill('tester@uwo.ca')
          await auth.locator('[name="signup-username"]').fill('Tester')
          await auth.locator('[name$="-password"]').fill('Abcdefg1!')
          await page.waitForTimeout(500)
        }
        const dismiss = async () => {
          await auth.getByRole('button', { name: 'Close authentication' }).click()
          await auth.waitFor({ state: 'detached' })
        }
        const hold = auth.getByRole('button', { name: /Hold to create account/ })
        if (process.env.LOADER_ONLY) {
          await open()
          await signup()
        } else {
        await open()
        assert.equal(await auth.locator('#login-email').getAttribute('autocomplete'), 'username')
        assert.equal(await auth.locator('#login-password').getAttribute('autocomplete'), 'current-password')
        await signup()
        assert.equal(await auth.locator('#signup-email').getAttribute('autocomplete'), 'section-signup email')
        assert.equal(await auth.locator('#signup-password').getAttribute('autocomplete'), 'new-password')
        assert.equal(await auth.locator('form').getAttribute('name'), 'signup-form')
        assert(await hold.isDisabled())
        await fields()
        assert(await hold.isDisabled())
        await auth.locator('[name="code"]').fill('123456')
        assert(await hold.isDisabled())
        // In-session email survives mode switching, separate modal session does not.
        await auth.getByRole('tab', { name: 'Log in', exact: true }).click()
        await auth.locator('form[data-auth-mode="signin"]').waitFor()
        await signup()
        assert.equal(await auth.locator('[name$="-email"]').inputValue(), 'tester@uwo.ca')
        await dismiss()
        await page.getByRole('button', { name: 'Log in', exact: true }).click()
        await signup()
        for (const name of ['email', 'username', 'password', 'code'])
          assert.equal(await auth.locator(`[name$="${name}"]`).inputValue(), '')
        assert(!(await auth.locator('[type="checkbox"]').isChecked()))
        // Fast, medium, slow and failed requests: measure actual loading state.
        for (const [ms, failure] of [[50, false], [250, false], [800, false], [50, true]]) {
          delay = ms
          failSend = failure
          await fields()
          await auth.locator('[type="checkbox"]').check()
          await page.evaluate(() => {
            window.loadingTimes = []
            const button = document.querySelector('dialog [data-state]')
            const observer = new MutationObserver(() => {
              window.loadingTimes.push({ state: button.dataset.state, time: performance.now() })
            })
            observer.observe(button, { attributes: true, attributeFilter: ['data-state'] })
          })
          const send = auth.getByRole('button', { name: /Send code/ })
          await send.click()
          await page.waitForFunction(() => window.loadingTimes.some((x) => ['success', 'error'].includes(x.state)))
          const times = await page.evaluate(() => window.loadingTimes)
          const elapsed = times.find((x) => ['success', 'error'].includes(x.state)).time - times.find((x) => x.state === 'loading').time
          assert(elapsed >= Math.max(ms, 200) - 20, `${elapsed}ms too fast`)
          assert(elapsed < Math.max(ms, 200) + 180, `${elapsed}ms unnecessary extra delay`)
          if (failure) assert(await auth.getByText('Test send failure').isVisible())
          if (ms === 50 && !failure) {
            await auth.locator('[name="code"]').fill('123456')
            assert(!(await hold.isDisabled()))
            await auth.locator('[type="checkbox"]').uncheck()
            assert(await hold.isDisabled())
          }
          await dismiss()
          await page.getByRole('button', { name: 'Log in', exact: true }).click()
          await signup()
        }
        }
        // Both success modes use the same top-layer overlay across actual Next navigation.
        for (const mode of ['signup', 'signin']) {
          const observeSuccess = () => page.evaluate(() => {
            window.successPhases = []
            window.successFrames = []
            const sample = () => {
              const element = document.querySelector('[data-auth-success]')
              if (element) {
                const message = element.querySelector('[role="status"]')
                window.successFrames.push({ phase: element.dataset.authSuccess,
                  text: message?.textContent || '', opacity: message ? Number(getComputedStyle(element.querySelector('[data-success-content]')).opacity) : 0,
                  steps: Array.from(element.querySelectorAll('[data-loading-step]')).map(e => e.dataset.state), time: performance.now(), destination: Boolean(document.querySelector('#listing-sort-label')) })
                requestAnimationFrame(sample)
              } else if (!window.successFrames.length) requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
            new MutationObserver(() => {
              const element = document.querySelector('[data-auth-success]')
              if (element) window.successPhases.push(element.dataset.authSuccess)
            }).observe(document.body, { subtree: true, childList: true, attributes: true })
          })
          if (mode === 'signup') {
            failSend = false
            await fields()
            await auth.locator('[type="checkbox"]').check()
            await auth.getByRole('button', { name: /Send code/ }).click()
            await auth.getByText('Verification code sent. Check your inbox.').waitFor()
            await auth.locator('[name="code"]').fill('123456')
            await observeSuccess()
            await hold.focus()
            await page.keyboard.down('Space')
            await page.waitForTimeout(1150)
            await page.keyboard.up('Space')
          } else {
            await open()
            await auth.locator('[name$="-email"]').fill('tester@uwo.ca')
            await auth.locator('[name$="-password"]').fill('Abcdefg1!')
            await observeSuccess()
            await auth.getByRole('button', { name: 'Log in', exact: true }).click()
          }
          const overlay = page.locator('[data-auth-success]')
          await overlay.waitFor()
          await page.waitForFunction(() => window.successPhases.includes('covered'))
          if (!reduced) {
            const panels = await overlay.locator('div').evaluateAll((elements) => elements.map((e) => {
              const r = e.getBoundingClientRect()
              return { top: r.top, bottom: r.bottom }
            }))
            assert(panels[0].top <= 1 && panels[1].bottom >= 899)
            assert(panels[0].bottom >= panels[1].top, 'No seam')
          }
          try { await page.waitForFunction(() => location.pathname === '/listings') } catch (error) {
            console.log('FAILED STATE', await page.evaluate(() => ({ path: location.pathname, phase: document.querySelector('[data-auth-success]')?.dataset.authSuccess, readiness: document.querySelector('[data-market-preparation]')?.dataset.marketPreparation, frames: window.successFrames.slice(-3), body: document.body.innerText })))
            throw error
          }
          await overlay.waitFor({ state: 'detached' })
          const frames = await page.evaluate(() => window.successFrames)
          assert(frames.filter((x) => x.phase === 'cover').every((x) => x.text === ''))
          assert(frames.some((x) => x.text === 'Welcome back, Tester'))
          const fading = frames.find((x) => x.phase === 'fading')
          const reveal = frames.find((x) => x.phase === 'reveal')
          assert(fading && reveal && fading.text === 'Welcome back, Tester')
          assert.deepEqual(fading.steps, ['complete', 'complete', 'complete', 'complete'])
          assert(frames.every(f => f.steps.filter(s => s === 'active').length <= 1))
          assert(reveal.opacity < 0.01 && reveal.destination, 'Reveal requires faded text AND ready destination')
          assert(reveal.time - fading.time >= 180, 'Text fade must finish before opening')
          if (!reduced) assert(frames.some((x) => x.phase === 'covered' && x.text.length > 0 && x.text.length < 'Welcome back, Tester'.length))
          assert(await page.locator('#listing-sort-label').isVisible())
          assert.equal(await page.evaluate(() => document.body.style.overflow), '')
          assert.equal(await auth.count(), 0)
        }
        assert.equal(submits, 2)
        await open()
        await page.evaluate(() => {
          window.next.router.push = async () => { throw new Error('Test cancelled navigation') }
        })
        await auth.locator('[name$="-email"]').fill('tester@uwo.ca')
        await auth.locator('[name$="-password"]').fill('Abcdefg1!')
        await auth.getByRole('button', { name: 'Log in', exact: true }).click()
        await page.getByText('You are signed in, but Market could not open.').waitFor()
        assert.equal(await auth.count(), 0, 'Navigation failure never asks for credentials again')
        assert(await page.getByRole('button', { name: 'Try opening Market again' }).isVisible())
        console.log(`PASS ${width} ${reduced ? 'reduced' : 'motion'}: ${process.env.LOADER_ONLY ? 'loader only' : 'full auth'}, signup/login readiness, fade, reveal and failure`)
        await page.close()
      }
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
