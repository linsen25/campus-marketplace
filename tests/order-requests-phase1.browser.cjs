// Real localhost:3000 staging E2E. Existing demo accounts; no preview role, signup or email.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  crypto = require('node:crypto')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000',
  staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
const marker = 'Phase 1 formal staging acceptance'
;(async () => {
  const html = await (await fetch(base + '/home')).text()
  let stagingRuntime = false
  for (const match of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const code = (
      await (await fetch(new URL(match[1], base))).text()
    ).replaceAll(String.fromCharCode(92, 34), '"')
    assert(
      !/(?:const|var|let)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs/.test(
        code
      )
    )
    stagingRuntime ||=
      /(?:const|var|let)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo/.test(code)
  }
  assert(stagingRuntime, 'Staging runtime required')
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json')
  )
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  let stage = 'start'
  try {
    const contexts = [],
      pages = []
    let errors = 0
    const writes = []
    for (const [identity, role] of [
      ['seller-a', 'selling'],
      ['buyer-a', 'buying'],
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        timezoneId: 'America/Toronto',
        serviceWorkers: 'block',
      })
      await context.route('**/*', (route) => {
        const request = route.request(),
          url = new URL(request.url())
        if (![base, staging].includes(url.origin)) return route.abort()
        if (request.method() !== 'GET' && url.origin === base)
          writes.push(url.pathname)
        return route.continue()
      })
      const signed = await context.request.post(base + '/api/auth/sign-in', {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: {
          email: credentials[identity].email,
          password: credentials[identity].password,
        },
      })
      assert.equal(signed.status(), 200)
      const page = await context.newPage()
      page.on('pageerror', () => errors++)
      contexts.push(context)
      pages.push(page)
      await page.goto(base + '/home?section=messages&destination=' + role)
    }
    const [seller, buyer] = pages,
      [sellerContext, buyerContext] = contexts
    const list = await sellerContext.request.get(
      base + '/api/messages/conversations?role=selling'
    )
    assert.equal(list.status(), 200)
    const sellerConversations = (await list.json()).conversations
    const conversation = sellerConversations.find(
      (c) =>
        c.listing.title.includes('Nike') &&
        c.person.id === credentials['buyer-a'].id
    )
    assert(conversation)
    const history = async (context) => {
      const response = await context.request.get(
        base + '/api/order-requests?conversationId=' + conversation.id
      )
      assert.equal(response.status(), 200)
      return response.json()
    }
    if (process.env.ORDER_PHASE1_VERIFY_RESTART === '1') {
      const saved = JSON.parse(
        fs.readFileSync(
          'tests/artifacts/order-requests-phase1/browser-result.json'
        )
      )
      assert.equal(conversation.id, saved.conversationId)
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index]
        await page
          .locator('[data-conversation-id="' + conversation.id + '"]')
          .first()
          .waitFor({ timeout: 60000 })
        await page
          .locator('[data-conversation-id="' + conversation.id + '"]')
          .first()
          .click()
        await page
          .locator('[data-timeline-request="' + saved.requestIds[2] + '"]')
          .waitFor()
        const request = (await history(contexts[index])).requests.find(
          (r) => r.id === saved.requestIds[2]
        )
        assert.equal(request.status, 'active')
        assert.equal(request.createdAt, saved.createdAt)
        assert.deepEqual(request.snapshot.draft, saved.terms)
        const messageResponse = await contexts[index].request.get(
          base + '/api/messages/conversations/' + conversation.id + '/messages'
        )
        assert.equal(messageResponse.status(), 200)
        const imageMessage = (await messageResponse.json()).messages.find(
          (message) => message.type === 'IMAGE'
        )
        assert(imageMessage, 'Existing durable staging IMAGE required')
        const photos = page.locator(
          '[data-message-id="' + imageMessage.id + '"] img'
        )
        await photos.first().waitFor()
        await page.waitForFunction((id) => {
          const image = document.querySelector(
            '[data-message-id="' + id + '"] img'
          )
          return (
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0
          )
        }, imageMessage.id)
      }
      assert.equal(errors, 0)
      console.log(
        'PASS real restarted localhost:3000: both authenticated accounts see the same persisted ID, status, terms and created_at; no Request mutation.'
      )
      return
    }
    const initial = await history(sellerContext)
    for (const request of initial.requests.filter(
      (r) => r.status === 'active'
    )) {
      assert(
        request.snapshot.draft.note.startsWith(marker),
        'Do not overwrite unrelated active Request'
      )
      const response = await sellerContext.request.post(
        base + '/api/order-requests/' + request.id + '/cancel',
        {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: {
            clientActionId: crypto.randomUUID(),
            reasonCode: 'other',
            note: 'Repeat acceptance run',
          },
        }
      )
      assert.equal(response.status(), 200)
    }
    for (const page of pages) {
      await page.reload()
      await page
        .locator('[data-conversation-id="' + conversation.id + '"]')
        .first()
        .waitFor({ timeout: 60000 })
      await page
        .locator('[data-conversation-id="' + conversation.id + '"]')
        .first()
        .click()
      await page
        .locator(
          '[data-message-history="' + conversation.id + '"] [data-message-id]'
        )
        .first()
        .waitFor()
      assert.equal(
        await page
          .getByRole('region', { name: 'Preview Controls', exact: true })
          .count(),
        0
      )
    }
    // Wait for authoritative Request membership before testing the menus.
    const sellerMenu = seller.getByRole('button', {
      name: 'Add to conversation',
      exact: true,
    })
    const buyerMenu = buyer.getByRole('button', {
      name: 'Add to conversation',
      exact: true,
    })
    await sellerMenu.click()
    await seller
      .getByRole('button', { name: 'Send Order Request', exact: true })
      .waitFor({ timeout: 30000 })
    await buyerMenu.click()
    assert.equal(
      await buyer
        .getByRole('button', { name: 'Send Order Request', exact: true })
        .count(),
      0
    )
    await buyerMenu.click()
    console.log(
      'PASS real Seller menu includes Send Order Request; real Buyer menu excludes it.'
    )
    const button = (page, name) =>
      page.getByRole('button', { name, exact: true })
    const create = async (price, note, replace) => {
      stage = 'editor-' + price
      if (!(await button(seller, 'Send Order Request').count()))
        await sellerMenu.click()
      await button(seller, 'Send Order Request').click()
      const editor = seller.getByRole('dialog', {
        name: 'Order Request editor',
        exact: true,
      })
      await editor.waitFor()
      await editor.getByLabel('Agreed price (CAD)').fill(price)
      await editor.getByLabel('Pickup location').fill('UCC main entrance')
      await editor.getByLabel('Optional note').fill(marker + ' ' + note)
      const key = await seller.evaluate(() => {
        const d = new Date()
        d.setDate(d.getDate() + 3)
        return (
          d.getFullYear() +
          '-' +
          String(d.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(d.getDate()).padStart(2, '0')
        )
      })
      await editor.getByRole('button', { name: /^Date / }).click()
      const calendar = seller.getByRole('dialog', {
        name: 'Schedule calendar',
        exact: true,
      })
      if (!(await calendar.locator('[data-day="' + key + '"] button').count()))
        await calendar.getByRole('button', { name: /next month/i }).click()
      await calendar.locator('[data-day="' + key + '"] button').click()
      await editor.getByRole('button', { name: /^Time / }).click()
      const wheel = seller.getByRole('dialog', {
        name: 'Choose time',
        exact: true,
      })
      for (const [name, value] of [
        ['Hour', '5'],
        ['Minute', '45'],
        ['AM / PM', 'PM'],
      ]) {
        const group = wheel.getByRole('group', { name, exact: true })
        await group.locator('[data-rwp]').focus()
        if (name === 'AM / PM') await seller.keyboard.press('End')
        else await seller.keyboard.type(value, { delay: 40 })
        await seller.waitForFunction(
          ({ name, value }) => {
            const node = document.querySelector(
              '[role="dialog"][aria-label="Choose time"]'
            )
            return (
              node
                ?.querySelector('[aria-label="' + name + '"]')
                ?.getAttribute('data-wheel-value') === String(value)
            )
          },
          { name, value: name === 'Minute' ? Number(value) : value }
        )
      }
      await button(seller, 'Done').click()
      await button(seller, 'Send Request').click()
      await seller
        .getByRole('dialog', { name: 'Confirm Order Request', exact: true })
        .waitFor()
      const mutation = seller.waitForResponse(
        (r) =>
          r.url().startsWith(base + '/api/order-requests') &&
          r.request().method() === 'POST'
      )
      await button(seller, 'Confirm & Send').click()
      if (replace) {
        await seller
          .getByRole('dialog', {
            name: 'Replace current Order Request?',
            exact: true,
          })
          .waitFor()
        await button(seller, 'Replace & Send').click()
      }
      const response = await mutation
      assert.equal(response.status(), 200)
      const request = await response.json()
      await seller
        .getByRole('dialog', {
          name: replace
            ? 'Replace current Order Request?'
            : 'Confirm Order Request',
          exact: true,
        })
        .waitFor({ state: 'hidden' })
      await buyer
        .locator('[data-timeline-request="' + request.id + '"]')
        .waitFor({ timeout: 30000 })
      assert.equal(
        await seller
          .locator('[data-timeline-request="' + request.id + '"] [data-sent]')
          .getAttribute('data-sent'),
        'true'
      )
      assert.equal(
        await buyer
          .locator('[data-timeline-request="' + request.id + '"] [data-sent]')
          .getAttribute('data-sent'),
        'false'
      )
      assert.equal(
        await buyer
          .getByRole('button', { name: 'Accept', exact: true })
          .count(),
        0
      )
      return request
    }
    const a = await create('80', 'A', false)
    console.log(
      'PASS Request A persisted via editor; Buyer received same ID through Realtime without refresh.'
    )
    stage = 'refresh'
    for (const page of pages) {
      await page.reload()
      await page
        .locator('[data-conversation-id="' + conversation.id + '"]')
        .first()
        .waitFor()
      await page
        .locator('[data-conversation-id="' + conversation.id + '"]')
        .first()
        .click()
      await page.locator('[data-timeline-request="' + a.id + '"]').waitFor()
    }
    const refreshed = (await history(buyerContext)).requests.find(
      (r) => r.id === a.id
    )
    assert.deepEqual(refreshed, a)
    console.log(
      'PASS both browser refreshes retained the same Request ID/terms/status/created_at.'
    )
    stage = 'interleaved-text'
    const sent = await sellerContext.request.post(
      base + '/api/messages/conversations/' + conversation.id + '/messages',
      {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: {
          type: 'TEXT',
          content:
            'Phase 1 staging: the updated request will follow this message.',
          clientMessageId: crypto.randomUUID(),
        },
      }
    )
    assert.equal(sent.status(), 200)
    const message = await sent.json()
    const b = await create('75', 'B', true)
    await buyer
      .locator(
        '[data-timeline-request="' +
          a.id +
          '"] [data-request-status="superseded"]'
      )
      .waitFor()
    const stateB = await history(buyerContext)
    assert.equal(
      stateB.requests.find((r) => r.id === a.id).status,
      'superseded'
    )
    assert.equal(stateB.requests.find((r) => r.id === b.id).status, 'active')
    const order = await buyer
      .locator('[data-timeline-id]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.timelineId))
    assert(
      order.indexOf('request:' + a.id) <
        order.indexOf('message:' + message.id) &&
        order.indexOf('message:' + message.id) <
          order.indexOf('request:' + b.id)
    )
    console.log('PASS atomic replacement and real persisted TEXT interleave.')
    stage = 'cancel'
    await buyer
      .locator('[data-timeline-request="' + b.id + '"]')
      .getByRole('button', { name: 'Expand Order Request', exact: true })
      .click()
    assert.equal(
      await buyer.getByRole('button', { name: 'Accept', exact: true }).count(),
      0
    )
    await button(buyer, 'Close').click()
    await seller
      .locator('[data-timeline-request="' + b.id + '"]')
      .getByRole('button', { name: 'Cancel Request', exact: true })
      .click()
    const cancel = seller.getByRole('dialog', {
      name: 'Cancel Order Request?',
      exact: true,
    })
    await cancel
      .getByLabel('Reason', { exact: true })
      .selectOption({ label: 'Incorrect transaction details' })
    await cancel
      .getByLabel('Additional note (optional)')
      .fill('Replaced by a fresh offer for acceptance testing.')
    const cancellationResponse = seller.waitForResponse(
      (r) => r.url().endsWith('/cancel') && r.request().method() === 'POST'
    )
    await cancel
      .getByRole('button', { name: 'Cancel Request', exact: true })
      .click()
    assert.equal((await cancellationResponse).status(), 200)
    await buyer
      .locator(
        '[data-timeline-request="' +
          b.id +
          '"] [data-request-status="cancelled"]'
      )
      .waitFor()
    await buyer
      .getByText('Reason: Incorrect transaction details', { exact: true })
      .first()
      .waitFor()
    const c = await create('80', 'C - active for manual inspection', false)
    for (const action of ['cancel', 'replace']) {
      const denied = await buyerContext.request.post(
        base + '/api/order-requests/' + c.id + '/' + action,
        {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: {
            clientActionId: crypto.randomUUID(),
            reasonCode: 'other',
            note: '',
            terms: {},
          },
        }
      )
      assert.equal(denied.status(), 403)
    }
    stage = 'persistence'
    const final = await history(buyerContext)
    assert.equal(final.requests.find((r) => r.id === b.id).status, 'cancelled')
    assert.equal(final.requests.filter((r) => r.status === 'active').length, 1)
    fs.mkdirSync('tests/artifacts/order-requests-phase1', { recursive: true })
    fs.writeFileSync(
      'tests/artifacts/order-requests-phase1/browser-result.json',
      JSON.stringify(
        {
          conversationId: conversation.id,
          requestIds: [a.id, b.id, c.id],
          createdAt: c.createdAt,
          terms: c.snapshot.draft,
          serverTime: final.serverTime,
        },
        null,
        2
      )
    )
    assert.equal(errors, 0)
    assert(!writes.some((p) => /payment|accept|reservation|handoff/.test(p)))
    console.log(
      'PASS cancel/new Request, Buyer denial, no local Accept; no runtime errors. Durable demo Request C retained for manual inspection.'
    )
    if (process.env.ORDER_PHASE1_RESTART === '1') {
      console.log(
        'RESTART_READY: waiting for Enter after localhost:3000 server restart; browser sessions remain open.'
      )
      await new Promise((resolve) => {
        if (!process.stdin.isTTY)
          throw Error(
            'Interactive restart mode requires a TTY; use read-only VERIFY_RESTART after restarting instead.'
          )
        process.stdin.resume()
        process.stdin.once('data', resolve)
      })
      for (const page of pages) {
        await page.reload()
        await page
          .locator('[data-conversation-id="' + conversation.id + '"]')
          .first()
          .waitFor({ timeout: 60000 })
        await page
          .locator('[data-conversation-id="' + conversation.id + '"]')
          .first()
          .click()
        await page.locator('[data-timeline-request="' + c.id + '"]').waitFor()
      }
      const restarted = (await history(buyerContext)).requests.find(
        (r) => r.id === c.id
      )
      assert.deepEqual(restarted, c)
      console.log(
        'PASS same authenticated browser sessions after dev-server restart; ID/terms/created_at unchanged.'
      )
      process.stdin.pause()
    }
  } catch (error) {
    console.error(
      'Phase 1 browser stage failed: ' +
        stage +
        ' (' +
        String(error.message).replace(/eyJ\S+/g, '[redacted]') +
        ')'
    )
    process.exitCode = 1
  } finally {
    await browser.close()
  }
})()
