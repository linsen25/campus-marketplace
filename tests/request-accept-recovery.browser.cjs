// Real staging sessions/history. Transport gates exercise loading; no transaction writes.
/* global fetch, structuredClone, getComputedStyle, document, innerWidth */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
let stage = 'runtime guard'
const base = 'http://localhost:3000'
const staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
;(async () => {
  // Confirm the served build before any authenticated request is made.
  const html = await (await fetch(base + '/home')).text()
  let stagingUrl = false
  let stagingEnvironment = false
  for (const match of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const code = (await (await fetch(new URL(match[1], base))).text())
      .replaceAll(String.fromCharCode(92, 34), '"')
      .replaceAll(String.fromCharCode(92, 110), '\n')
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs\.supabase\.co"/.test(
        code
      ),
      'Production runtime prohibited'
    )
    stagingUrl ||=
      /(?:const|let|var)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo\.supabase\.co"/.test(
        code
      )
    stagingEnvironment ||=
      /(?:const|let|var)\s+designation\s*=\s*"staging"/.test(code)
  }
  assert(stagingUrl && stagingEnvironment, 'Confirmed staging runtime required')

  const creds = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const account = creds['buyer-a']
  assert.equal(
    (
      await context.request.post(base + '/api/auth/sign-in', {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: { email: account.email, password: account.password },
      })
    ).status(),
    200
  )
  const saved = (
    await (
      await context.request.get(
        base + '/api/orders/b289dd54-b226-4e1f-9f65-6e530a885911'
      )
    ).json()
  ).order
  assert(
    saved,
    'Existing historical DTO required; never consume Active Request'
  )
  let errors = 0,
    writes = 0,
    posts = 0
  const results = []
  try {
    for (const width of [390, 430, 1280, 1536]) {
      stage = 'Accept ' + width
      const page = await context.newPage()
      page.setDefaultTimeout(30000)
      page.on('pageerror', () => errors++)
      await page.setViewportSize({ width, height: 1000 })
      const request = {
        id: 'aabbccdd-1111-4222-8333-000000000001',
        conversationId: saved.conversationId,
        status: 'active',
        createdAt: new Date().toISOString(),
        snapshot: structuredClone(saved.snapshot),
      }
      const order = {
        ...structuredClone(saved),
        id: 'aabbccdd-1111-4222-8333-000000000002',
        requestId: request.id,
        lifecycle: 'open',
      }
      let mode = 'active',
        release,
        reached
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const started = new Promise((resolve) => {
        reached = resolve
      })
      let localPosts = 0,
        direct = false
      await page.route('**/*', (route) => {
        const q = route.request(),
          u = new URL(q.url())
        if (![base, staging].includes(u.origin)) return route.abort()
        if (q.method() === 'POST' && u.pathname.endsWith('/read'))
          return route.fulfill({
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
          return route.abort()
        }
        return route.continue()
      })
      await page.route('**/api/orders?**', (route) =>
        route.fulfill({
          json: {
            orders: mode === 'recovered' ? [order] : [],
            serverTime: new Date().toISOString(),
          },
        })
      )
      await page.route('**/api/order-requests?**', async (route) => {
        if (mode === 'held') {
          reached()
          await gate
        }
        if (mode === 'failed')
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: 'temporary_unavailable',
                message: 'Forced test read failure',
              },
            },
          })
        return route.fulfill({
          json: {
            buyerId: saved.buyerId,
            sellerId: saved.sellerId,
            requests: [
              {
                ...request,
                status: mode === 'recovered' ? 'accepted' : 'active',
              },
            ],
            events: [],
            eligibleRequestIds: mode === 'recovered' ? [] : [request.id],
            serverTime: new Date().toISOString(),
          },
        })
      })
      await page.route('**/api/order-requests/*/accept', (route) => {
        assert(
          route
            .request()
            .url()
            .endsWith('/' + request.id + '/accept'),
          'Only intercepted synthetic Request'
        )
        localPosts++
        posts++
        mode = direct ? 'recovered' : 'held'
        return route.fulfill({
          json: { order, serverTime: new Date().toISOString() },
        })
      })
      await page.goto(
        base +
          '/home?section=messages&destination=buying&conversation=' +
          saved.conversationId,
        { waitUntil: 'domcontentloaded' }
      )
      let card = page.locator('[data-order-preview="' + request.id + '"]')
      await card.waitFor({ timeout: 60000 })
      const openAccept = async () => {
        await card
          .getByRole('button', { name: 'Expand Order Request', exact: true })
          .click()
        const acceptAction = page
          .getByRole('dialog', { name: 'Order Request', exact: true })
          .getByRole('button', { name: 'Accept', exact: true })
        assert(
          (await acceptAction.getAttribute('class')).includes(
            'shining-button--green'
          )
        )
        await acceptAction.click()
        const dialog = page.getByRole('dialog', {
          name: 'Accept this Order Request?',
          exact: true,
        })
        await dialog.waitFor()
        assert(
          (
            await dialog
              .getByRole('button', { name: 'Accept & Reserve', exact: true })
              .getAttribute('class')
          ).includes('shining-button--green')
        )
        return dialog
      }
      let dialog = await openAccept()
      assert(
        await dialog.evaluate((el) => {
          const s = getComputedStyle(el)
          return (
            s.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            parseFloat(s.paddingTop) >= 24 &&
            parseFloat(s.borderTopWidth) >= 1 &&
            el.contains(document.activeElement)
          )
        })
      )
      // Native Chrome permits focus on browser chrome at the wrap boundary (BODY).
      // It must never focus an actionable background page control.
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab')
        assert(
          await dialog.evaluate(
            (el) =>
              el.matches(':modal') &&
              (el.contains(document.activeElement) ||
                document.activeElement === document.body)
          ),
          'Native modal focus boundary'
        )
      }
      assert(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
        'Tab returns to dialog actions'
      )
      await page.screenshot({
        path: 'tests/artifacts/order-accept/cleanup-dialog-' + width + '.png',
        fullPage: true,
      })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(localPosts, 0)
      assert(
        await card.evaluate((el) => el.contains(document.activeElement)),
        'Cancel restores Request focus'
      )
      dialog = await openAccept()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(localPosts, 0)
      dialog = await openAccept()
      await dialog
        .getByRole('button', { name: 'Accept & Reserve', exact: true })
        .click()
      await started
      const confirm = dialog.getByRole('button', {
        name: 'Accepting...',
        exact: true,
      })
      assert(
        await confirm.isDisabled(),
        'No second confirmation while authoritative refresh is pending'
      )
      await confirm.evaluate((button) => button.click())
      // Before the read returns, the original Active snapshot must not be actionable.
      assert.equal(await card.getAttribute('data-request-status'), 'active')
      assert.equal(localPosts, 1)
      mode = 'failed'
      release()
      await dialog.waitFor({ state: 'hidden' })
      await page
        .getByText(
          /Acceptance succeeded, but Request state could not be refreshed/
        )
        .waitFor()
      await card
        .getByRole('button', { name: 'Expand Order Request', exact: true })
        .click()
      const expanded = page.getByRole('dialog', {
        name: 'Order Request',
        exact: true,
      })
      await expanded.waitFor()
      assert.equal(
        await expanded
          .getByRole('button', { name: 'Accept', exact: true })
          .count(),
        0
      )
      assert.equal(
        await card.getAttribute('data-request-status'),
        'active',
        'No fabricated Accepted status'
      )
      await expanded.getByRole('button', { name: 'Close', exact: true }).click()
      mode = 'recovered'
      await page
        .getByRole('button', { name: 'Retry Order Requests', exact: true })
        .click()
      await page.locator('[data-formal-order="' + order.id + '"]').waitFor()
      assert.equal(
        new URL(page.url()).searchParams.get('destination'),
        'purchases'
      )
      assert.equal(new URL(page.url()).searchParams.get('order'), order.id)
      await page.reload()
      await page.locator('[data-formal-order="' + order.id + '"]').waitFor()
      assert.equal(localPosts, 1, 'No duplicate Accept/Order')
      assert.equal(
        await page.locator('[data-order-preview="' + request.id + '"]').count(),
        0
      )
      // A separate synthetic Request exercises the normal direct-success path too.
      direct = true
      mode = 'active'
      request.id = 'aabbccdd-1111-4222-8333-000000000003'
      card = page.locator('[data-order-preview="' + request.id + '"]')
      order.requestId = request.id
      order.id = 'aabbccdd-1111-4222-8333-000000000004'
      await page.goto(
        base +
          '/home?section=messages&destination=buying&conversation=' +
          saved.conversationId
      )
      dialog = await openAccept()
      await dialog
        .getByRole('button', { name: 'Accept & Reserve', exact: true })
        .click()
      await page.locator('[data-formal-order="' + order.id + '"]').waitFor()
      assert.equal(
        new URL(page.url()).searchParams.get('destination'),
        'purchases'
      )
      assert.equal(new URL(page.url()).searchParams.get('order'), order.id)
      await page.reload()
      await page.locator('[data-formal-order="' + order.id + '"]').waitFor()
      assert.equal(localPosts, 2)
      await page
        .getByRole('button', { name: 'Back to Purchases', exact: true })
        .click()
      await page.locator(`[data-order-list-card="${order.id}"]`).waitFor()
      assert.equal(new URL(page.url()).searchParams.get('orderView'), 'active')
      assert.equal(
        await page
          .getByRole('button', { name: 'Active', exact: true })
          .getAttribute('aria-pressed'),
        'true'
      )
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      )
      results.push({
        width,
        cardSurface: true,
        keyboard: true,
        cancelPosts: 0,
        acceptPosts: localPosts,
        recovery: true,
      })
      await page.close()
      console.log(
        'PASS Accept surface/focus/Cancel/no stale re-Accept/refetch recovery ' +
          width
      )
    }
    assert.equal(errors, 0)
    assert.equal(writes, 0)
    assert.equal(posts, 8)
    fs.writeFileSync(
      'tests/artifacts/order-accept/cleanup-result.json',
      JSON.stringify(
        {
          results,
          interceptedAcceptPosts: posts,
          actualTransactionWrites: writes,
          errors,
          passed: true,
        },
        null,
        2
      )
    )
    console.log(
      JSON.stringify({
        checks: results.length,
        errors,
        actualTransactionWrites: writes,
        passed: true,
      })
    )
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error('FAIL ' + stage + ': ' + e.stack)
  process.exitCode = 1
})
