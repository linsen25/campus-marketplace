// Real staging authentication; all transaction/capability variants are intercepted DTOs.
/* global fetch, document, innerWidth, getComputedStyle */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000'
const staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
const root = 'tests/artifacts/manual-flow-ux'
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
fs.mkdirSync(root, { recursive: true })
async function color(dialog, name, green) {
  const button = dialog.getByRole('button', { name, exact: true })
  const classes = await button.getAttribute('class')
  assert(
    classes.includes(green ? 'shining-button--green' : 'raisedButtonDanger'),
    name
  )
}
(async () => {
  const html = await (await fetch(base + '/home')).text()
  let bound = false
  for (const match of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const code = (
      await (await fetch(new URL(match[1], base))).text()
    ).replaceAll(String.fromCharCode(92, 34), '"')
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs/.test(
        code
      )
    )
    bound ||=
      /(?:const|let|var)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo/.test(code)
  }
  assert(bound)
  const creds = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json')
  )
  const state = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/state.json')
  )
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE,
  })
  let errors = 0,
    writes = 0,
    stage = 'login'
  const results = []
  try {
    const c = await browser.newContext({ serviceWorkers: 'block' })
    assert.equal(
      (
        await c.request.post(base + '/api/auth/sign-in', {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: {
            email: creds['seller-a'].email,
            password: creds['seller-a'].password,
          },
        })
      ).status(),
      200
    )
    const response = await c.request.get(
      base + '/api/orders/b289dd54-b226-4e1f-9f65-6e530a885911'
    )
    assert.equal(response.status(), 200)
    const original = (await response.json()).order
    const otherResponse = await c.request.get(
      base + '/api/listings/' + state.listings.macbook
    )
    assert.equal(otherResponse.status(), 200)
    const other = await otherResponse.json()
    assert(other.photoUrls.length && original.snapshot.listing.photoUrls.length)
    const request = {
      id: 'aabbccdd-1111-4222-8333-000000000008',
      conversationId: original.conversationId,
      status: 'active',
      createdAt: new Date().toISOString(),
      snapshot: original.snapshot,
    }
    let capability = 'ready',
      requests = []
    await c.route('**/*', (route) => {
      const q = route.request(),
        u = new URL(q.url())
      if (![base, staging].includes(u.origin)) return route.abort()
      if (u.pathname === '/api/order-requests')
        return route.fulfill({
          json: {
            requests,
            events: [],
            eligibleRequestIds: requests.map((r) => r.id),
            sellerId: original.sellerId,
            buyerId: original.buyerId,
            serverTime: new Date().toISOString(),
          },
        })
      if (u.pathname === '/api/orders')
        return route.fulfill({
          json: { orders: [], serverTime: new Date().toISOString() },
        })
      if (u.pathname === '/api/financial-capabilities')
        return route.fulfill({
          json: {
            paymentMethod: { status: 'unset' },
            payoutAccount: { status: capability },
            serverTime: new Date().toISOString(),
          },
        })
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
    for (const width of [1280, 1536, 390, 430]) {
      const p = await c.newPage()
      p.setDefaultTimeout(25000)
      p.on('pageerror', () => errors++)
      await p.setViewportSize({ width, height: 1000 })
      stage = 'matrix ' + width
      capability = 'ready'
      requests = []
      await p.goto(
        base +
          '/home?section=messages&destination=selling&conversation=' +
          original.conversationId
      )
      const add = p.getByRole('button', {
        name: 'Add to conversation',
        exact: true,
      })
      await add.waitFor()
      await add.click()
      await p
        .getByRole('button', { name: 'Send Order Request', exact: true })
        .click()
      const editor = p.getByRole('dialog', {
        name: 'Order Request editor',
        exact: true,
      })
      await editor
        .getByRole('button', { name: 'Shipping', exact: true })
        .click()
      await editor
        .getByRole('button', { name: 'Included', exact: true })
        .click()
      await editor
        .getByRole('button', { name: 'Send Request', exact: true })
        .click()
      const confirmation = p.getByRole('dialog', {
        name: 'Confirm Order Request',
        exact: true,
      })
      await color(confirmation, 'Go Back', false)
      await color(confirmation, 'Confirm & Send', true)
      await confirmation
        .getByRole('button', { name: 'Go Back', exact: true })
        .click()
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
      for (const value of ['unset', 'needs_attention']) {
        capability = value
        await add.click()
        await p
          .getByRole('button', { name: 'Send Order Request', exact: true })
          .click()
        const payout = p.getByRole('dialog', {
          name:
            value === 'unset'
              ? 'Set up payouts first'
              : 'Payout account needs attention',
          exact: true,
        })
        await color(payout, 'Cancel', false)
        await color(
          payout,
          value === 'unset'
            ? 'Go to Payout Settings'
            : 'Review Payout Settings',
          true
        )
        await payout
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
      }
      for (const listing of [
        original.snapshot.listing,
        {
          ...original.snapshot.listing,
            id: other.id,
            title: other.title,
          photoUrls: other.photoUrls,
        },
      ]) {
        stage = 'image ' + width + ' ' + listing.title
        request.snapshot = { ...original.snapshot, listing }
        requests = [request]
        await p.reload()
        await p
          .locator(`[data-order-preview="${request.id}"]`)
          .getByRole('button', { name: 'Expand Order Request', exact: true })
          .click()
        const dialog = p.getByRole('dialog', {
          name: 'Order Request',
          exact: true,
        })
        const img = dialog.locator('img').first()
        await img.waitFor()
        await p.waitForFunction(() => {
          const img = document.querySelector('dialog img')
          return img && img.complete && img.naturalWidth > 0
        })
        assert.equal(
          await img.evaluate((el) => getComputedStyle(el).objectFit),
          'cover'
        )
        if (width >= 1280)
          assert(
            await img.evaluate(
              (el) =>
                Math.abs(
                  el.getBoundingClientRect().height -
                    el.closest('span').parentElement.getBoundingClientRect()
                      .height
                ) < 2
            )
          )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        await color(dialog, 'Close', false)
        await p.screenshot({ path: root + `/image-${width}-${listing.id}.png` })
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      }
      results.push({
        width,
        confirmationColors: true,
        payoutColors: true,
        twoLoadedImages: true,
        overflow: false,
      })
      await p.close()
      console.log(
        'PASS confirmation/payout color matrix and two loaded images ' + width
      )
    }
    assert.equal(errors, 0)
    assert.equal(writes, 0)
    fs.writeFileSync(
      root + '/results.json',
      JSON.stringify({ results, errors, writes, passed: true }, null, 2)
    )
  } catch (error) {
    throw Error(stage + ': ' + error.message)
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
