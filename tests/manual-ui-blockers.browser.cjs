// Real staging sessions + intercepted capability projections. No financial/transaction writes.
/* global fetch, window, document, getComputedStyle, performance, requestAnimationFrame */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const sharp = require('sharp')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000',
  staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
let stage = 'runtime guard'
;(async () => {
  const html = await (await fetch(base + '/home')).text()
  let stageUrl = false,
    stageEnv = false
  for (const m of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const code = (await (await fetch(new URL(m[1], base))).text()).replaceAll(
      String.fromCharCode(92, 34),
      '"'
    )
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs\.supabase\.co"/.test(
        code
      )
    )
    stageUrl ||=
      /(?:const|let|var)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo\.supabase\.co"/.test(
        code
      )
    stageEnv ||= /(?:const|let|var)\s+designation\s*=\s*"staging"/.test(code)
  }
  assert(stageUrl && stageEnv)
  const creds = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json')
  )
  const state = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/state.json')
  )
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  const root = 'tests/artifacts/manual-ui-blockers'
  fs.mkdirSync(root, { recursive: true })
  let writes = 0,
    errors = 0
  const results = []
  try {
    for (const width of [1280, 1536, 390, 430]) {
      stage = width + ' login'
      const c = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      assert.equal(
        (
          await c.request.post(base + '/api/auth/sign-in', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: {
              email: creds['seller-b'].email,
              password: creds['seller-b'].password,
            },
          })
        ).status(),
        200
      )
      let capability = 'unset'
      await c.route('**/*', (r) => {
        const q = r.request(),
          u = new URL(q.url())
        if (![base, staging].includes(u.origin)) return r.abort()
        if (q.method() === 'POST' && u.pathname.endsWith('/read'))
          return r.fulfill({
            json: {
              last_read_sequence: q.postDataJSON().throughSequence,
              unread_count: 0,
            },
          })
        if (
          !['GET', 'HEAD'].includes(q.method()) &&
          u.pathname !== '/api/messages/realtime-session'
        ) {
          writes++
          return r.abort()
        }
        if (u.pathname.startsWith('/api/orders'))
          return r.fulfill({
            json: { orders: [], serverTime: new Date().toISOString() },
          })
        if (u.pathname === '/api/financial-capabilities')
          return r.fulfill({
            json: {
              paymentMethod: { status: 'unset', brand: null, last4: null },
              payoutAccount: {
                status: capability,
                institution: null,
                last4: null,
              },
            },
          })
        return r.continue()
      })
      const p = await c.newPage()
      p.setDefaultTimeout(30000)
      p.on('pageerror', () => errors++)
      await p.addInitScript(() =>
        window.addEventListener('unhandledrejection', () => {
          window.__uiRejections = (window.__uiRejections || 0) + 1
        })
      )
      const openChat = async () => {
        await p
          .locator(
            '[data-conversation-id="' + state.conversations['monitor-a'] + '"]'
          )
          .first()
          .click()
        await p
          .getByRole('button', { name: 'Add to conversation', exact: true })
          .waitFor()
      }
      const openRequest = async () => {
        await p
          .getByRole('button', { name: 'Add to conversation', exact: true })
          .click()
        await p
          .getByRole('button', { name: 'Send Order Request', exact: true })
          .click()
      }
      stage = width + ' payout gate'
      await p.goto(base + '/home?section=messages&destination=selling')
      await openChat()
      await openRequest()
      let gate = p.getByRole('dialog')
      await gate.getByText('Set up payouts first', { exact: true }).waitFor()
      assert(
        (
          await gate
            .getByRole('button', { name: 'Cancel', exact: true })
            .getAttribute('class')
        ).includes('raisedButtonDanger')
      )
      assert(
        (
          await gate
            .getByRole('button', { name: 'Go to Payout Settings', exact: true })
            .getAttribute('class')
        ).includes('shining-button--green')
      )
      await gate
        .getByRole('button', { name: 'Go to Payout Settings', exact: true })
        .click()
      await p
        .getByRole('complementary', { name: 'Staging financial test controls' })
        .waitFor()
      assert(
        await p.getByRole('region', { name: 'Payments & payouts' }).isVisible()
      )
      stage = width + ' repeated Settings navigation'
      const nav = p.locator(
        width < 1024 ? '[data-smooth-dropdown]' : '[data-slot="sidebar-body"]'
      )
      if (width < 1024)
        await nav
          .getByRole('button', { name: 'Open Home navigation', exact: true })
          .click()
      else await nav.hover()
      await nav
        .getByRole(width < 1024 ? 'button' : 'link', {
          name: 'Messages',
          exact: true,
        })
        .click()
      await nav.getByRole('button', { name: 'Selling', exact: true }).click()
      await p.mouse.move(width - 10, 500)
      await openChat()
      await openRequest()
      await p
        .getByRole('button', { name: 'Go to Payout Settings', exact: true })
        .click()
      await p
        .getByRole('complementary', { name: 'Staging financial test controls' })
        .waitFor()
      // Ready is a browser-only projection, preserving the user's live capability rows.
      capability = 'needs_attention'
      stage = width + ' Review payout navigation'
      await p.goto(base + '/home?section=messages&destination=selling')
      await openChat()
      await openRequest()
      await p
        .getByRole('button', { name: 'Review Payout Settings', exact: true })
        .click()
      await p
        .getByRole('complementary', { name: 'Staging financial test controls' })
        .waitFor()
      capability = 'ready'
      stage = width + ' Request editor'
      await p.goto(base + '/home?section=messages&destination=selling')
      await openChat()
      await openRequest()
      const editor = p.getByRole('dialog', {
        name: 'Order Request editor',
        exact: true,
      })
      await editor.waitFor()
      const form = editor.getByRole('form', {
        name: 'Order transaction details',
      })
      const geometry = await editor.evaluate((e) => ({
        scroll: e.scrollHeight > e.clientHeight + 2,
        overflow: getComputedStyle(e).overflowY,
      }))
      assert.equal(geometry.scroll, false)
      assert.equal(geometry.overflow, 'hidden')
      if (width >= 1024) {
        assert.equal(
          await form.evaluate((e) => getComputedStyle(e).overflowY),
          'auto'
        )
        const card = editor.locator('[data-listing-preview]')
        const a = await card.boundingBox(),
          foot = await editor.locator('footer').boundingBox()
        await form.evaluate((e) => {
          e.scrollTop = 200
        })
        assert.deepEqual(await card.boundingBox(), a)
        assert.deepEqual(await editor.locator('footer').boundingBox(), foot)
        assert(
          a.y + a.height <= foot.y + 1,
          'Listing content must fit above footer'
        )
        assert.equal(
          await card
            .locator(':scope > div')
            .first()
            .evaluate((e) => e.scrollHeight > e.clientHeight + 2),
          false
        )
      }
      await editor
        .getByRole('button', { name: 'Shipping', exact: true })
        .click()
      await editor
        .getByRole('button', { name: 'Included', exact: true })
        .click()
      const send = editor.getByRole('button', {
        name: 'Send Request',
        exact: true,
      })
      assert(await send.isEnabled())
      assert(
        (await send.getAttribute('class')).includes('shining-button--green')
      )
      const cancel = editor.getByRole('button', { name: 'Cancel', exact: true })
      assert(
        (await cancel.getAttribute('class')).includes('raisedButtonDanger')
      )
      await p.screenshot({ path: root + '/editor-' + width + '.png' })
      await send.click()
      const confirm = p.getByRole('dialog')
      assert(
        (
          await confirm
            .getByRole('button', { name: 'Confirm & Send', exact: true })
            .getAttribute('class')
        ).includes('shining-button--green')
      )
      assert(
        (
          await confirm
            .getByRole('button', { name: 'Go Back', exact: true })
            .getAttribute('class')
        ).includes('raisedButtonDanger')
      )
      await confirm
        .getByRole('button', { name: 'Go Back', exact: true })
        .click()
      await cancel.click()
      await editor.waitFor({ state: 'detached' })
      stage = width + ' attachments'
      await p
        .getByRole('button', { name: 'Add to conversation', exact: true })
        .click()
      const enterSamples = await p
        .getByRole('button', { name: 'Attachment', exact: true })
        .evaluate(async (button) => {
          const values = [],
            start = performance.now()
          button.click()
          while (performance.now() - start < 320) {
            await new Promise(requestAnimationFrame)
            const element = document.querySelector('[data-attachment-panel]')
            values.push({
              ms: performance.now() - start,
              opacity: element
                ? Number(getComputedStyle(element).opacity)
                : null,
            })
          }
          return values
        })
      assert(
        enterSamples.some((v) => v.opacity !== null && v.opacity < 0.15),
        'Enter painted near transparent'
      )
      assert(
        enterSamples.some((v) => v.opacity > 0.15 && v.opacity < 0.95),
        'Enter opacity changes over time'
      )
      assert.equal(enterSamples.at(-1).opacity, 1)
      const panel = p.locator('[data-attachment-panel]')
      assert.equal(
        await panel
          .getByRole('button', { name: 'Send', exact: true })
          .evaluate((e) =>
            getComputedStyle(e).getPropertyValue('--surface').trim()
          ),
        '#237a48'
      )
      const photos = []
      for (const color of ['red', 'blue'])
        photos.push({
          name: color + '.png',
          mimeType: 'image/png',
          buffer: await sharp({
            create: { width: 120, height: 80, channels: 3, background: color },
          })
            .png()
            .toBuffer(),
        })
      await p.locator('#message-photos').setInputFiles(photos)
      await p
        .getByRole('img', { name: 'Selected photo 1', exact: true })
        .waitFor()
      await p
        .getByRole('button', { name: 'Next selected photo', exact: true })
        .click()
      await p
        .getByRole('img', { name: 'Selected photo 2', exact: true })
        .waitFor()
      assert(
        await p
          .getByRole('img', { name: 'Selected photo 2', exact: true })
          .evaluate((e) => {
            const r = e.getBoundingClientRect()
            return (
              document
                .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
                .closest('[data-active-photo]') === e.parentElement
            )
          })
      )
      assert(
        await p
          .getByRole('button', { name: 'Next selected photo', exact: true })
          .isDisabled()
      )
      await p
        .getByRole('button', { name: 'Previous selected photo', exact: true })
        .click()
      await p
        .getByRole('img', { name: 'Selected photo 1', exact: true })
        .waitFor()
      assert(
        await p
          .getByRole('button', { name: 'Previous selected photo', exact: true })
          .isDisabled()
      )
      if (width >= 1024) {
        const upload = await p
          .locator('#message-photos')
          .evaluate((e) =>
            e.closest('[class*="upload"]').getBoundingClientRect().toJSON()
          )
        const preview = await p.locator('[data-selected-photos]').boundingBox()
        assert(upload.right <= preview.x)
        const square = await panel
          .locator('[data-slot="file-drop"] > label')
          .boundingBox()
        assert(
          Math.abs(square.width - square.height) < 2,
          'Desktop upload square'
        )
        assert.equal(
          await panel.evaluate((e) => e.scrollHeight > e.clientHeight + 2),
          false
        )
      }
      await p.screenshot({ path: root + '/attachment-' + width + '.png' })
      const exitSamples = await panel
        .getByRole('button', { name: 'Back', exact: true })
        .evaluate(async (button) => {
          const values = [],
            start = performance.now()
          button.click()
          while (performance.now() - start < 320) {
            await new Promise(requestAnimationFrame)
            const e = document.querySelector('[data-attachment-panel]')
            values.push({
              ms: performance.now() - start,
              opacity: e ? Number(getComputedStyle(e).opacity) : null,
            })
          }
          return values
        })
      assert(
        exitSamples.some(
          (v) => v.opacity !== null && v.opacity > 0.05 && v.opacity < 0.9
        ),
        'Exit remains mounted with changing opacity'
      )
      assert.equal(exitSamples.at(-1).opacity, null, 'Unmount after fade')
      await panel.waitFor({ state: 'detached' })
      if (width === 430) {
        await p.emulateMedia({ reducedMotion: 'reduce' })
        await p
          .getByRole('button', { name: 'Add to conversation', exact: true })
          .click()
        await p.getByRole('button', { name: 'Attachment', exact: true }).click()
        await panel.waitFor()
        assert.equal(
          await panel.evaluate((e) => getComputedStyle(e).opacity),
          '1'
        )
        await panel.getByRole('button', { name: 'Back', exact: true }).click()
        await panel.waitFor({ state: 'detached' })
      }
      assert.equal(await p.evaluate(() => window.__uiRejections || 0), 0)
      results.push({
        width,
        payoutNavigation: true,
        repeatedSettingsNavigation: true,
        editorScroll: true,
        colors: true,
        carousel: true,
        fade: true,
        enterSamples,
        exitSamples,
      })
      await c.close()
    }
    assert.equal(writes, 0)
    assert.equal(errors, 0)
    fs.writeFileSync(
      root + '/results.json',
      JSON.stringify({ passed: true, results, writes, errors }, null, 2)
    )
    console.log(
      JSON.stringify({
        passed: true,
        results: results.map((r) => ({
          ...r,
          enterSamples: r.enterSamples.map((v) => v.opacity),
          exitSamples: r.exitSamples.map((v) => v.opacity),
        })),
        writes,
        errors,
      })
    )
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error('FAIL ' + stage + ': ' + e.message)
  process.exitCode = 1
})
