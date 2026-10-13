// Real staging history and sessions; no Request writes. Expired-only presentation uses an explicitly intercepted API response.
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
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  try {
    let canonical
    for (const [identity, role] of [
      ['seller-a', 'selling'],
      ['buyer-a', 'buying'],
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block',
      })
      await context.route('**/*', (route) => {
        const request = route.request(),
          url = new URL(request.url())
        if (![base, staging].includes(url.origin)) return route.abort()
        if (request.method() === 'POST' && /\/read$/.test(url.pathname))
          return route.fulfill({
            json: {
              conversation_id: url.pathname.split('/')[4],
              last_read_sequence: request.postDataJSON().throughSequence,
              unread_count: 0,
            },
          })
        if (
          !['GET', 'HEAD'].includes(request.method()) &&
          url.pathname !== '/api/messages/realtime-session'
        )
          return route.abort()
        return route.continue()
      })
      stage = 'sign in ' + role
      const signIn = await context.request.post(base + '/api/auth/sign-in', {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: {
          email: credentials[identity].email,
          password: credentials[identity].password,
        },
      })
      assert.equal(signIn.status(), 200)
      const list = await context.request.get(
        base + '/api/messages/conversations?role=' + role
      )
      assert.equal(list.status(), 200)
      const conversation = (await list.json()).conversations.find((item) =>
        item.listing.title.includes('Nike')
      )
      assert(conversation, 'Staging Nike demo conversation required')
      const history = await context.request.get(
        base + '/api/messages/conversations/' + conversation.id + '/messages'
      )
      assert.equal(history.status(), 200)
      const messages = (await history.json()).messages
      const page = await context.newPage()
      let errors = 0
      page.on('pageerror', () => errors++)
      stage = 'open ' + role
      await page.goto(base + '/home?section=messages&destination=' + role)
      const entry = page
        .locator('[data-conversation-id="' + conversation.id + '"]')
        .first()
      await entry.waitFor({ timeout: 60000 })
      await entry.click()
      await page
        .locator(
          '[data-message-history="' + conversation.id + '"] [data-message-id]'
        )
        .first()
        .waitFor({ timeout: 30000 })
      assert.equal(
        await page
          .getByRole('region', { name: 'Preview Controls', exact: true })
          .count(),
        0
      )
      for (const name of [
        'Buyer view',
        'Seller view',
        'Advance protection window',
      ])
        assert.equal(
          await page.getByRole('button', { name, exact: true }).count(),
          0
        )

      const response = await context.request.get(
        base + '/api/order-requests?conversationId=' + conversation.id
      )
      assert.equal(response.status(), 200)
      const persisted = await response.json()
      assert(
        persisted.requests.some((r) =>
          ['active', 'accepted'].includes(r.status)
        )
      )
      assert(persisted.requests.some((r) => r.status === 'superseded'))
      assert(persisted.requests.some((r) => r.status === 'cancelled'))
      const same = persisted.requests.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
      }))
      if (canonical) assert.deepEqual(same, canonical)
      else canonical = same
      const cancellations = persisted.events.filter(
        (e) => e.kind === 'request-cancelled'
      )
      assert(cancellations.length > 0)
      assert(
        cancellations.every(
          (event) => event.actorId === credentials['seller-a'].id
        )
      )
      for (const width of [1280, 1536, 390, 430]) {
        stage = 'timeline ' + role + ' ' + width
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(500)
        if (
          !(await page
            .getByRole('button', { name: 'Add to conversation', exact: true })
            .count())
        )
          await entry.click()
        for (const request of persisted.requests) {
          const card = page.locator('[data-order-preview="' + request.id + '"]')
          await card.waitFor()
          assert.equal(await card.locator('p').count(), 0)
          assert.equal(
            await card.getAttribute('data-request-status'),
            request.status
          )
          const section = page.locator(
            '[data-timeline-request="' + request.id + '"]'
          )
          assert.equal(
            await section.getAttribute('data-timeline-created-at'),
            request.createdAt
          )
          assert.equal(
            await section
              .locator('[data-timeline-id]')
              .getAttribute('data-sent'),
            String(role === 'selling')
          )
          assert.equal(
            await card
              .getByRole('button', { name: 'Cancel Request', exact: true })
              .count(),
            role === 'selling' && request.status === 'active' ? 1 : 0
          )
          if (request.status === 'superseded') {
            assert(request.lifecycle.replacedAt)
            await card.locator('button').first().click()
            const detail = page.getByRole('dialog', {
              name: 'Order Request',
              exact: true,
            })
            await detail.waitFor()
            assert.equal(
              await detail
                .locator('[aria-label="Request lifecycle"] time')
                .getAttribute('dateTime'),
              request.lifecycle.replacedAt
            )
            assert.equal(
              await detail
                .getByRole('button', { name: 'Accept', exact: true })
                .count(),
              0
            )
            await detail
              .getByRole('button', { name: 'Close', exact: true })
              .click()
            await detail.waitFor({ state: 'hidden' })
          }
        }
        assert.equal(
          await page.locator('[data-timeline-event]').count(),
          cancellations.length
        )
        for (const event of cancellations) {
          const section = page.locator(
            '[data-timeline-event="' + event.id + '"]'
          )
          const row = section.locator(
            '[data-automatic-notification="request-cancelled"]'
          )
          await row.waitFor()
          assert.equal(
            await row.getAttribute('data-sent'),
            String(role === 'selling')
          )
          assert.equal(
            await section.getAttribute('data-timeline-created-at'),
            event.createdAt
          )
          assert.equal(
            await row.getByText('Order update', { exact: true }).count(),
            1
          )
          assert.equal(
            await row
              .getByText('Reason: ' + event.cancellation.cancelReason, {
                exact: true,
              })
              .count(),
            1
          )
          const bounds = await row.boundingBox(),
            bubble = await row.locator('div').boundingBox()
          if (role === 'selling')
            assert(
              Math.abs(bounds.x + bounds.width - bubble.x - bubble.width) < 2
            )
          else assert(Math.abs(bounds.x - bubble.x) < 2)
          const request = persisted.requests.find(
            (r) => r.id === event.requestId
          )
          await page
            .locator('[data-order-preview="' + request.id + '"] button')
            .first()
            .click()
          const detail = page.getByRole('dialog', {
            name: 'Order Request',
            exact: true,
          })
          const lifecycle = detail.locator('[aria-label="Request lifecycle"]')
          await lifecycle.waitFor()
          assert(
            (await lifecycle.textContent()).includes(
              event.cancellation.cancelReason
            )
          )
          assert.equal(
            await lifecycle.locator('time').getAttribute('dateTime'),
            request.cancellation.cancelledAt
          )
          assert.equal(
            await detail
              .getByRole('button', { name: 'Accept', exact: true })
              .count(),
            0
          )
          await detail
            .getByRole('button', { name: 'Close', exact: true })
            .click()
          await detail.waitFor({ state: 'hidden' })
        }
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        const groups = await page
          .locator('[data-message-history] [data-timeline-created-at]')
          .evaluateAll((nodes) =>
            nodes.map((n) => ({
              at: n.dataset.timelineCreatedAt,
              separator: !!n.querySelector('[data-time-separator]'),
            }))
          )
        for (let i = 0; i < groups.length; i++)
          assert.equal(
            groups[i].separator,
            i === 0 ||
              Math.floor(Date.parse(groups[i].at) / 60000) !==
                Math.floor(Date.parse(groups[i - 1].at) / 60000)
          )
        assert(groups.filter((g) => g.separator).length < groups.length)
        assert.equal(
          await page
            .getByText('Automatic notification', { exact: true })
            .count(),
          0
        )
        const add = page.getByRole('button', {
          name: 'Add to conversation',
          exact: true,
        })
        await add.click()
        assert.equal(
          await page
            .getByRole('button', { name: 'Attachment', exact: true })
            .count(),
          1
        )
        assert.equal(
          await page
            .getByRole('button', { name: 'Send Order Request', exact: true })
            .count(),
          role === 'selling' &&
            conversation.listing.availability === 'available'
            ? 1
            : 0
        )
        await add.click()
        await page.screenshot({
          path:
            'tests/artifacts/order-requests-phase1/timeline-' +
            role +
            '-' +
            width +
            '.png',
        })
        console.log(
          JSON.stringify({
            role,
            width,
            cancellationMessages: cancellations.length,
            aligned: true,
            compactTerminalCards: true,
            noReplacementOrExpiryMessages: true,
            overflow: false,
          })
        )
      }
      const chronology = await page
        .locator('[data-timeline-id]')
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.timelineId))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await entry.waitFor()
      if (
        !(await page
          .getByRole('button', { name: 'Add to conversation', exact: true })
          .count())
      )
        await entry.click()
      await page
        .locator('[data-order-preview="' + persisted.requests[0].id + '"]')
        .waitFor()
      const refreshed = await context.request.get(
        base + '/api/order-requests?conversationId=' + conversation.id
      )
      const refreshedHistory = await refreshed.json()
      assert.deepEqual(refreshedHistory.requests, persisted.requests)
      assert.deepEqual(refreshedHistory.events, persisted.events)
      // Request history and TEXT/IMAGE history load independently after refresh.
      await page.waitForFunction(
        (expected) =>
          JSON.stringify(
            Array.from(document.querySelectorAll('[data-timeline-id]')).map(
              (node) => node.getAttribute('data-timeline-id')
            )
          ) === JSON.stringify(expected),
        chronology
      )
      assert.deepEqual(
        await page
          .locator('[data-timeline-id]')
          .evaluateAll((nodes) => nodes.map((n) => n.dataset.timelineId)),
        chronology
      )
      console.log(
        JSON.stringify({
          role,
          refreshIdsStatusesTermsEventsChronology: true,
          sameMinuteSeparators: true,
          realRoleMenu: true,
        })
      )
      // Trigger the same invalidation/refetch hook without creating a new persisted cancellation.
      const refetched = page.waitForResponse(
        (r) => r.url().includes('/api/order-requests?') && r.status() === 200
      )
      await page.evaluate(
        (id) =>
          window.dispatchEvent(
            new CustomEvent('marketplace-request-invalidated', {
              detail: { conversationId: id },
            })
          ),
        conversation.id
      )
      assert.deepEqual(
        (await (await refetched).json()).requests,
        persisted.requests
      )
      // No real expired fixture is retained; isolate an expired API projection to test its card at all widths.
      const expiredRequest = persisted.requests.find(
        (r) => r.status === 'superseded'
      )
      await page.route('**/api/order-requests?*', (route) =>
        route.fulfill({
          json: {
            ...persisted,
            requests: persisted.requests.map((r) =>
              r.id === expiredRequest.id
                ? {
                    ...r,
                    status: 'expired',
                    lifecycle: { expiredAt: persisted.serverTime },
                  }
                : r
            ),
            events: [
              ...persisted.events,
              {
                id: 'expired-presentation-only',
                requestId: expiredRequest.id,
                kind: 'request-expired',
                createdAt: persisted.serverTime,
              },
            ],
          },
        })
      )
      const expiryRefetch = page.waitForResponse((r) =>
        r.url().includes('/api/order-requests?')
      )
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('marketplace-request-invalidated'))
      )
      await expiryRefetch
      for (const width of [1280, 1536, 390, 430]) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(400)
        if (
          !(await page
            .getByRole('button', { name: 'Add to conversation', exact: true })
            .count())
        )
          await entry.click()
        const card = page.locator(
          '[data-order-preview="' +
            expiredRequest.id +
            '"][data-request-status="expired"]'
        )
        await card.waitFor()
        assert.equal(await card.locator('p').count(), 0)
        assert.equal(
          await card.getByText('Expired', { exact: true }).count(),
          1
        )
        assert.equal(
          await page
            .locator('[data-timeline-event="expired-presentation-only"]')
            .count(),
          0
        )
        await card.locator('button').first().click()
        const detail = page.getByRole('dialog', {
          name: 'Order Request',
          exact: true,
        })
        await detail.waitFor()
        assert.equal(
          await detail
            .locator('[aria-label="Request lifecycle"] time')
            .getAttribute('dateTime'),
          persisted.serverTime
        )
        await detail.getByRole('button', { name: 'Close', exact: true }).click()
        await detail.waitFor({ state: 'hidden' })
      }
      console.log(
        JSON.stringify({
          role,
          authoritativeInvalidationRefetch: true,
          expiredPresentationOnlyMock: true,
          expiredWidths: [1280, 1536, 390, 430],
        })
      )
      let own = 0,
        other = 0
      for (const message of messages) {
        const row = page.locator('[data-message-id="' + message.id + '"]')
        if (!(await row.count())) continue
        const sent = message.senderId === credentials[identity].id
        assert.equal(await row.getAttribute('data-sent'), String(sent))
        if (sent) own++
        else other++
      }
      assert(own > 0 && other > 0)
      assert.equal(errors, 0)
      console.log(
        JSON.stringify({
          session: identity,
          role,
          apiStatus: 200,
          noPerspectiveControls: true,
          ownRight: own,
          otherLeft: other,
          runtimeErrors: errors,
        })
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  let message = error.message
  for (const credential of Object.values(
    JSON.parse(fs.readFileSync('tests/artifacts/staging-demo/credentials.json'))
  )) {
    for (const field of ['email', 'password']) {
      message = message.replaceAll(credential[field], '[redacted]')
    }
  }
  console.error(stage, message)
  console.error(
    'Formal perspective browser check failed; credentials and response details withheld.'
  )
  process.exitCode = 1
})
