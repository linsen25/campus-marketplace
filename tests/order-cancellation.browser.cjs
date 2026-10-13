// Real authenticated sessions, intercepted synthetic DTOs. No hosted transaction mutation.
/* global fetch, document, innerWidth, getComputedStyle */
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000'
const staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
const keyboardOnly = process.env.CANCEL_KEYBOARD_ONLY === '1'
;(async () => {
  const html = await (await fetch(base + '/home')).text()
  let bound = false
  for (const m of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const js = (await (await fetch(new URL(m[1], base))).text()).replaceAll(
      String.fromCharCode(92, 34),
      '"'
    )
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs/.test(js)
    )
    bound ||=
      /(?:const|let|var)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo/.test(js)
  }
  assert(bound)
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json')
  )
  const state = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/state.json')
  )
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE,
  })
  let lastPage,
    lastStage = 'start'
  const results = []
  let writes = 0,
    errors = 0
  const root = 'tests/artifacts/order-cancellation'
  fs.mkdirSync(root, { recursive: true })
  try {
    for (const role of ['buyer', 'seller'])
      for (const width of keyboardOnly ? [1280] : [1280, 1536, 390, 430]) {
        const c = await browser.newContext({
          viewport: { width, height: 900 },
          serviceWorkers: 'block',
        })
        const credentialsForRole = credentials[role + '-a']
        assert.equal(
          (
            await c.request.post(base + '/api/auth/sign-in', {
              headers: { Origin: base, 'X-Marketplace-Request': '1' },
              data: {
                email: credentialsForRole.email,
                password: credentialsForRole.password,
              },
            })
          ).status(),
          200
        )
        const mode = role === 'buyer' ? 'purchases' : 'sales'
        const historical = await c.request.get(
          base + '/api/orders/b289dd54-b226-4e1f-9f65-6e530a885911'
        )
        assert.equal(historical.status(), 200)
        const actualListing = (await historical.json()).order.snapshot.listing
        const id = '11111111-1111-4111-8111-111111111111'
        const requestId = '22222222-2222-4222-8222-222222222222'
        const draft = {
          price: 8000,
          fulfillment: 'shipping',
          location: '',
          scheduleMode: 'tbd',
          shippingCost: 'included',
          shippingFee: 0,
          shippingMethod: '',
          note: '',
        }
        const snapshot = {
          buyerId: state.users['buyer-a'],
          sellerId: state.users['seller-a'],
          buyer: 'Demo_buyer_a',
          seller: 'Demo_seller_a',
          listing: {
            id: state.listings.nike,
            liveId: state.listings.nike,
            title: 'Cancellation UI fixture',
            price: 8000,
            currency: 'CAD',
            category: 'Clothing',
            availability: 'available',
            photoUrls: actualListing.photoUrls,
          },
          draft,
        }
        let order = {
          id,
          requestId,
          conversationId: state.conversations['nike-a'],
          listingId: state.listings.nike,
          buyerId: state.users['buyer-a'],
          sellerId: state.users['seller-a'],
          snapshot,
          lifecycle: 'open',
          holdsListing: true,
          moneyStatus: 'finalized',
          paymentStatus: 'pending',
          paymentPaidAt: null,
          payoutStatus: 'not_eligible',
          fulfillmentStatus: 'awaiting_payment',
          itemAmount: 8000,
          shippingAmount: 0,
          serviceFee: 320,
          totalAmount: 8320,
          createdAt: new Date().toISOString(),
          reservationStartedAt: new Date().toISOString(),
          reservationExpiresAt: new Date(Date.now() + 1800000).toISOString(),
        }
        let posts = 0,
          failRefresh = false
        await c.route('**/*', (r) => {
          const q = r.request(),
            u = new URL(q.url())
          if (![base, staging].includes(u.origin)) return r.abort()
          if (u.pathname === '/api/order-requests')
            return r.fulfill({
              json: {
                requests: [
                  {
                    id: requestId,
                    conversationId: order.conversationId,
                    status: 'accepted',
                    createdAt: Date.now(),
                    acceptedAt: Date.now(),
                    snapshot,
                  },
                ],
                events: [],
                eligibleRequestIds: [],
                sellerId: order.sellerId,
                buyerId: order.buyerId,
                serverTime: new Date().toISOString(),
              },
            })
          if (u.pathname.startsWith('/api/orders')) {
            if (u.pathname.endsWith('/cancel')) {
              posts++
              const body = q.postDataJSON()
              assert.equal(
                body.reason,
                role === 'buyer'
                  ? 'buyer_changed_mind'
                  : 'seller_scheduling_issue'
              )
              assert(body.note.trim())
              order = {
                ...order,
                lifecycle: 'cancelled',
                holdsListing: false,
                cancellation: {
                  at: new Date().toISOString(),
                  byRole: role,
                  reasonCode: body.reason,
                  reason:
                    role === 'buyer' ? 'Changed my mind' : 'Scheduling issue',
                  note: body.note,
                },
              }
              failRefresh = true
              return r.fulfill({
                json: { order, serverTime: new Date().toISOString() },
              })
            }
            if (failRefresh)
              return r.fulfill({
                status: 503,
                json: { error: 'Forced refresh failure' },
              })
            return r.fulfill({
              json:
                u.pathname === '/api/orders'
                  ? { orders: [order], serverTime: new Date().toISOString() }
                  : { order, serverTime: new Date().toISOString() },
            })
          }
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
          return r.continue()
        })
        const p = await c.newPage()
        lastPage = p
        lastStage = role + ' ' + width
        p.setDefaultTimeout(15000)
        p.on('pageerror', () => errors++)
        await p.goto(
          base + `/home?section=orders&destination=${mode}&order=${id}`
        )
        const detail = p.locator('[data-formal-order]')
        await detail.waitFor()
        assert.equal(
          await detail
            .getByRole('button', { name: 'Cancel order', exact: true })
            .count(),
          1
        )
        assert(
          (
            await detail
              .getByRole('button', { name: 'Cancel order', exact: true })
              .getAttribute('class')
          ).includes('raisedButtonDanger')
        )
        await detail
          .getByRole('button', { name: 'Cancel order', exact: true })
          .click()
        const dialog = p.getByRole('dialog', {
          name: 'Cancel this order?',
          exact: true,
        })
        await dialog.waitFor()
        assert(
          (
            await dialog
              .getByRole('button', { name: 'Keep order', exact: true })
              .getAttribute('class')
          ).includes('shining-button--green')
        )
        assert(
          (
            await dialog
              .getByRole('button', { name: 'Cancel order', exact: true })
              .getAttribute('class')
          ).includes('raisedButtonDanger')
        )
        assert(
          await dialog.evaluate(
            (el) => parseFloat(getComputedStyle(el).gap) >= 20
          )
        )
        assert.notEqual(
          await dialog.evaluate((e) => getComputedStyle(e).backgroundColor),
          'rgba(0, 0, 0, 0)'
        )
        await dialog
          .getByRole('button', { name: 'Keep order', exact: true })
          .click()
        await dialog.waitFor({ state: 'detached' })
        assert.equal(posts, 0)
        await detail
          .getByRole('button', { name: 'Cancel order', exact: true })
          .click()
        const selector = dialog.getByRole('combobox', {
          name: 'Cancellation reason',
          exact: true,
        })
        await selector.focus()
        await p.keyboard.press('Space')
        await dialog.getByRole('listbox').waitFor()
        await p.keyboard.press('Escape')
        await p.waitForFunction(
          () =>
            document
              .querySelector('[role="combobox"]')
              ?.getAttribute('aria-expanded') === 'false'
        )
        await selector.focus()
        await p.keyboard.press('ArrowDown')
        await p.keyboard.press('End')
        await p.keyboard.press('Enter')
        await selector.getByText('Other', { exact: true }).waitFor()
        assert(
          await dialog
            .getByRole('button', { name: 'Cancel order', exact: true })
            .isDisabled()
        )
        await selector.focus()
        await p.keyboard.press('Enter')
        await p.keyboard.press('Home')
        if (role === 'seller') await p.keyboard.press('ArrowDown')
        await p.keyboard.press('Space')
        await selector
          .getByText(
            role === 'buyer' ? 'Changed my mind' : 'Scheduling issue',
            { exact: true }
          )
          .waitFor()
        await dialog
          .getByRole('textbox', { name: 'Optional note', exact: true })
          .fill('Synthetic UI cancellation')
        await p.screenshot({ path: root + `/dialog-${role}-${width}.png` })
        await dialog
          .getByRole('button', { name: 'Cancel order', exact: true })
          .click()
        await p.waitForURL(
          (url) =>
            url.searchParams.get('section') === 'orders' &&
            url.searchParams.get('destination') === mode &&
            !url.searchParams.has('order')
        )
        const retryOrders = p.getByRole('button', {
          name: /^Retry(?: Orders)?$/,
        })
        await retryOrders.waitFor()
        const cancelledCard = p.locator(
          `[data-order-list-card="${id}"][data-order-terminal="Cancelled"]`
        )
        assert.equal(
          await p
            .locator('[data-order-list-card]:not([data-order-terminal])')
            .count(),
          0
        )
        assert.equal(
          await p
            .getByRole('button', { name: 'Cancel order', exact: true })
            .count(),
          0
        )
        assert.equal(posts, 1)
        failRefresh = false
        await retryOrders.click()
        await cancelledCard.waitFor()
        assert.equal(new URL(p.url()).searchParams.get('orderView'), 'history')
        const historicalButton = cancelledCard.getByRole('button', {
          name: 'View details',
          exact: true,
        })
        assert(
          !(await historicalButton.getAttribute('class')).includes(
            'shining-button--green'
          )
        )
        await historicalButton.click()
        await p
          .getByText('Synthetic UI cancellation', { exact: true })
          .waitFor()
        await p.reload()
        await p
          .getByText('Synthetic UI cancellation', { exact: true })
          .waitFor()
        await p.goto(
          base + `/home?section=orders&destination=${mode}&orderView=history`
        )
        await p
          .locator(
            `[data-order-list-card="${id}"][data-order-terminal="Cancelled"]`
          )
          .waitFor()
        await p.goto(
          base +
            `/home?section=messages&destination=${
              role === 'buyer' ? 'buying' : 'selling'
            }`
        )
        await p
          .locator(`[data-conversation-id="${order.conversationId}"]`)
          .first()
          .click()
        await p
          .getByRole('button', { name: 'Expand Order Request', exact: true })
          .click()
        const requestDialog = p.getByRole('dialog', {
          name: 'Order Request',
          exact: true,
        })
        assert(
          (
            await requestDialog
              .getByRole('button', { name: 'View details', exact: true })
              .getAttribute('class')
          ).includes('shining-button--green')
        )
        for (const text of [
          'Synthetic UI cancellation',
          'Cancelled by',
          'Cancelled at',
          'Reason',
        ])
          assert.equal(
            await requestDialog.getByText(text, { exact: true }).count(),
            0
          )
        assert.equal(new URL(p.url()).searchParams.get('orderView'), null)
        assert(
          (
            await requestDialog
              .getByRole('button', { name: 'Close', exact: true })
              .getAttribute('class')
          ).includes('raisedButtonDanger')
        )
        if (width >= 1280 && actualListing.photoUrls.length) {
          const img = requestDialog.locator('img').first()
          assert.equal(
            await img.evaluate((el) => getComputedStyle(el).objectFit),
            'cover'
          )
          assert(
            await img.evaluate((el) => {
              const pane = el.closest('span')?.parentElement
              return (
                pane &&
                Math.abs(
                  el.getBoundingClientRect().height -
                    pane.getBoundingClientRect().height
                ) < 2
              )
            })
          )
        }
        await p.screenshot({ path: root + `/request-${role}-${width}.png` })
        assert.equal(
          await requestDialog
            .getByRole('button', { name: 'Accept', exact: true })
            .count(),
          0
        )
        await requestDialog
          .getByRole('button', { name: 'View details', exact: true })
          .click()
        await p
          .getByText('Synthetic UI cancellation', { exact: true })
          .waitFor()
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        await p.screenshot({ path: root + `/cancelled-${role}-${width}.png` })
        results.push({
          role,
          width,
          dialog: true,
          keepOrderZeroWrites: true,
          oneInterceptedCancel: posts,
          failedRefreshLocked: true,
          historicalDetail: true,
          historyVisible: true,
        })
        await c.close()
      }
    assert.equal(writes, 0)
    assert.equal(errors, 0)
    fs.writeFileSync(
      root +
        (keyboardOnly ? '/keyboard-results.json' : '/browser-results.json'),
      JSON.stringify(
        {
          passed: true,
          results,
          hostedTransactionWrites: writes,
          runtimeErrors: errors,
        },
        null,
        2
      )
    )
    console.log(
      JSON.stringify({
        passed: true,
        results,
        hostedTransactionWrites: writes,
        runtimeErrors: errors,
      })
    )
  } catch (e) {
    if (lastPage) {
      fs.writeFileSync(
        root + '/browser-failure.txt',
        lastStage + '\n' + (await lastPage.locator('body').innerText())
      )
      await lastPage.screenshot({ path: root + '/browser-failure.png' })
    }
    throw Error(lastStage + ': ' + e.message)
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
