/* global document, window, innerWidth */
// Real main app, two independent authenticated disposable staging participants.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const h = require('./order-meetup-fixtures.cjs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = 'http://localhost:3000'
const uuid = () => crypto.randomUUID()
const ok = (result) => {
  assert(!result.error, result.error?.code || 'Staging transport')
  return result.data
}
const button = (page, name) => page.getByRole('button', { name, exact: true })
async function chat(page, cid, role) {
  await page.goto(
    `${base}/home?section=messages&destination=${role}&conversation=${cid}`,
    { waitUntil: 'domcontentloaded', timeout: 120000 }
  )
  const row = page.locator(`[data-conversation-id="${cid}"]`).first()
  const history = page.locator(`[data-message-history="${cid}"]`)
  await Promise.race([
    row.waitFor({ timeout: 60000 }),
    history.waitFor({ timeout: 60000 }),
  ])
  if (!(await history.isVisible())) await row.click()
  await history.waitFor({ timeout: 60000 })
}
async function safeDialog(page) {
  const dialog = page.getByRole('dialog').last()
  await dialog.waitFor()
  await page.waitForTimeout(650)
  const geometry = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      width: innerWidth,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      title: el.querySelector('h3')?.textContent,
    }
  })
  if (
    !(
      geometry.left >= 0 &&
      geometry.right <= geometry.width + 1 &&
      geometry.scrollWidth <= geometry.clientWidth + 1
    )
  ) {
    await page.screenshot({ path: `${h.root}/revision-dialog-failure.png` })
    throw new Error('Responsive dialog geometry: ' + JSON.stringify(geometry))
  }
  await page.keyboard.press('Tab')
  assert(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    'Focus stays in dialog'
  )
  return dialog
}
async function longPress(page, target) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  })
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    })
    // Assert the action exists while the finger is still held, not after a tap.
    await button(page, 'Withdraw').waitFor({ timeout: 5000 })
  } finally {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await session.detach()
  }
  await page.waitForTimeout(350)
  assert(
    await button(page, 'Withdraw').isVisible(),
    'Finger release must not dismiss the portal'
  )
}
async function run() {
  const baseline = await h.fingerprint(),
    contexts = [],
    errors = [],
    imagePaths = [],
    checks = []
  let browser
  fs.writeFileSync(
    `${h.root}/qualification-baseline.json`,
    JSON.stringify(baseline)
  )
  try {
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    const f = await h.fixture('on_campus')
    const row = (
      await h.query(
        `select conversation_id,offer_terms from public.order_requests where id=${h.q(
          f.offer
        )}`
      )
    )[0]
    const cid = row.conversation_id
    const expiredOfferId = f.offer
    await h.query(`begin;lock table public.order_requests in access exclusive mode;
      alter table public.order_requests disable trigger order_request_immutable;
      update public.order_requests set offer_terms=jsonb_set(offer_terms,'{scheduled_at}',to_jsonb(date_trunc('hour',clock_timestamp())-interval '1 hour')) where id=${h.q(
        expiredOfferId
      )};
      alter table public.order_requests enable trigger order_request_immutable;commit;`)
    ok(
      await h.clients[0].rpc('marketplace_offer_history', {
        p_conversation_id: cid,
      })
    )
    const prior = ok(
      await h.clients[0].rpc('marketplace_submit_offer', {
        p_conversation_id: cid,
        p_terms: row.offer_terms,
        p_client_action_id: uuid(),
      })
    )
    h.offers.push(prior.id)
    h.journal()
    const revised = ok(
      await h.clients[0].rpc('marketplace_submit_offer', {
        p_conversation_id: cid,
        p_terms: { ...row.offer_terms, item_amount_cents: 7600 },
        p_client_action_id: uuid(),
        p_comparison_offer_id: prior.id,
        p_kind: 'revise',
      })
    )
    h.offers.push(revised.id)
    h.journal()
    f.offer = revised.id
    let buyerOffer = ok(
      await h.clients[1].rpc('marketplace_submit_offer', {
        p_conversation_id: cid,
        p_terms: { ...row.offer_terms, item_amount_cents: 7200 },
        p_client_action_id: uuid(),
        p_comparison_offer_id: f.offer,
        p_kind: 'counter',
      })
    )
    h.offers.push(buyerOffer.id)
    h.journal()
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE,
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    })
    const pages = [],
      signals = [0, 0],
      writes = [0, 0]
    for (const i of [0, 1]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        timezoneId: 'America/Toronto',
        serviceWorkers: 'block',
        hasTouch: true,
      })
      contexts.push(context)
      const response = await context.request.post(base + '/api/auth/sign-in', {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: h.accounts[i],
      })
      assert.equal(
        response.status(),
        200,
        'Synthetic staging existing-account sign-in'
      )
      const page = await context.newPage()
      pages.push(page)
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().includes('/api/offers')
        )
          writes[i]++
      })
      page.on('websocket', (socket) =>
        socket.on('framereceived', ({ payload }) => {
          if (
            String(payload).includes('messages_changed') &&
            String(payload).includes(cid)
          )
            signals[i]++
        })
      )
    }
    const [seller, buyer] = pages
    for (const width of process.env.TEST_WIDTHS
      ? process.env.TEST_WIDTHS.split(',').map(Number)
      : [390, 430, 1280, 1536]) {
      for (const [i, page] of pages.entries()) {
        console.log(`Checking ${width} ${i === 0 ? 'seller' : 'buyer'}`)
        await page.setViewportSize({ width, height: 900 })
        await chat(page, cid, i === 0 ? 'selling' : 'buying')
        await page
          .locator(
            `[data-offer-id="${expiredOfferId}"][data-offer-status="Expired"]`
          )
          .waitFor()
        await page
          .locator(
            `[data-offer-id="${prior.id}"][data-offer-status="Replaced"]`
          )
          .waitFor()
        assert.equal(
          await page.getByText('Preview Controls', { exact: true }).count(),
          0
        )
        await page
          .locator(`[data-offer-id="${f.offer}"]`)
          .waitFor({ timeout: 60000 })
        assert.equal(
          await page
            .locator(`[data-timeline-offer="${f.offer}"] [data-sent]`)
            .getAttribute('data-sent'),
          String(i === 0)
        )
        assert.equal(
          await page
            .locator(`[data-timeline-offer="${buyerOffer.id}"] [data-sent]`)
            .getAttribute('data-sent'),
          String(i === 1)
        )
        const received = i === 0 ? buyerOffer.id : f.offer
        const sent = i === 0 ? f.offer : buyerOffer.id
        await page.locator(`[data-offer-id="${received}"] > button`).click()
        const dialog = await safeDialog(page)
        for (const action of ['Cancel', 'Deny', 'Confirm'])
          assert.equal(
            await dialog
              .getByRole('button', { name: action, exact: true })
              .count(),
            1
          )
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Accept', exact: true })
            .count(),
          0
        )
        const before = writes[i]
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        await dialog.waitFor({ state: 'detached' })
        assert.equal(writes[i], before, 'Cancel is zero Offer writes')
        await page.locator(`[data-offer-id="${sent}"] > button`).click()
        const own = await safeDialog(page)
        assert.equal(
          await own
            .getByRole('button', { name: 'Confirm', exact: true })
            .count(),
          0
        )
        assert.equal(
          await own.getByRole('button', { name: 'Deny', exact: true }).count(),
          0
        )
        await own
          .getByRole('button', { name: 'Revise Offer', exact: true })
          .click()
        await safeDialog(page)
        await page
          .getByRole('textbox', { name: 'Offer price (CA$)', exact: true })
          .fill('71.00')
        await button(page, 'Review Offer').click()
        const review = await safeDialog(page)
        assert((await review.innerText()).includes('Changed terms: Price'))
        assert(
          (await review.innerText()).includes(
            i === 1 ? 'Buyer service fee' : 'Seller platform fee'
          )
        )
        await review
          .getByRole('button', { name: 'Go Back', exact: true })
          .click()
        await button(page, 'Cancel').click()
        const discard = await safeDialog(page)
        assert.deepEqual(await discard.getByRole('button').allTextContents(), [
          'Discard',
          'Keep editing',
        ])
        await button(page, 'Keep editing').click()
        await button(page, 'Cancel').click()
        await button(page, 'Discard').click()
        await page.waitForFunction(
          () => document.querySelectorAll('dialog[open]').length === 0
        )
        assert.equal(writes[i], before, 'Unsent edits/discard are zero writes')
        await page.screenshot({
          path: `${h.root}/revision-${
            i === 0 ? 'seller' : 'buyer'
          }-${width}.png`,
        })
        checks.push({
          width,
          role: i === 0 ? 'seller' : 'buyer',
          dualActive: true,
          alignment: true,
          recipientActions: true,
          review: true,
          focus: true,
          discardZeroWrites: true,
        })
      }
    }
    await buyer.setViewportSize({ width: 1280, height: 900 })
    await chat(buyer, cid, 'buying')
    await chat(seller, cid, 'selling')
    await buyer.locator(`[data-offer-id="${f.offer}"] > button`).click()
    await button(buyer, 'Deny').click()
    await buyer
      .locator(`[data-offer-id="${f.offer}"][data-offer-status="Declined"]`)
      .waitFor({ timeout: 60000 })
    await seller
      .locator(`[data-offer-id="${f.offer}"][data-offer-status="Declined"]`)
      .waitFor({ timeout: 60000 })
    assert.equal(
      await buyer
        .locator(`[data-offer-id="${buyerOffer.id}"]`)
        .getAttribute('data-offer-status'),
      'Active'
    )
    // A fresh Seller Counter is sent through the actual composer, not direct insertion.
    await button(seller, 'Add to conversation').click()
    await button(seller, 'Counter Offer').click()
    await safeDialog(seller)
    await seller
      .getByRole('textbox', { name: 'Offer price (CA$)', exact: true })
      .fill('73.00')
    await button(seller, 'Review Offer').click()
    await button(seller, 'Send Counter Offer').click()
    await seller.waitForFunction(
      () => document.querySelectorAll('dialog[open]').length === 0,
      undefined,
      { timeout: 60000 }
    )
    let history = ok(
      await h.clients[1].rpc('marketplace_offer_history', {
        p_conversation_id: cid,
      })
    )
    const sellerActive = history.offers.find(
      (offer) =>
        offer.sender_user_id === h.users[0] && offer.status === 'active'
    )
    assert(sellerActive)
    await buyer
      .locator(`[data-offer-id="${sellerActive.id}"]`)
      .waitFor({ timeout: 60000 })
    // A mobile long press uses the same sender-only context action as desktop.
    await buyer.setViewportSize({ width: 390, height: 900 })
    const textSent = ok(
      await h.clients[1].rpc('marketplace_send_text', {
        p_conversation_id: cid,
        p_client_message_id: uuid(),
        p_content: 'Synthetic long-press withdrawal',
      })
    )
    const textMessage = buyer.locator(`[data-message-id="${textSent.id}"]`)
    await textMessage.waitFor({ timeout: 60000 })
    const touchTarget = textMessage.getByRole('group', {
      name: 'Own content actions',
      exact: true,
    })
    await longPress(buyer, touchTarget)
    await button(buyer, 'Withdraw').click()
    await textMessage
      .getByText('You withdrew a message.', { exact: true })
      .waitFor({ timeout: 60000 })
    assert(
      !(await textMessage.innerText()).includes(
        'Synthetic long-press withdrawal'
      )
    )
    await buyer.setViewportSize({ width: 1280, height: 900 })
    // IMAGE withdrawal exercises the real FileDrop/prepare/upload/finalize path.
    await button(buyer, 'Add to conversation').click()
    await button(buyer, 'Attachment').click()
    await buyer.locator('input[type="file"]').setInputFiles({
      name: 'synthetic-withdrawal.jpg',
      mimeType: 'image/jpeg',
      buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
    })
    await buyer
      .getByRole('region', { name: 'Add attachment' })
      .getByRole('button', { name: 'Send', exact: true })
      .click()
    await buyer
      .getByRole('region', { name: 'Add attachment' })
      .waitFor({ state: 'detached', timeout: 60000 })
    const image = (
      await h.query(
        `select id from public.messages where conversation_id=${h.q(
          cid
        )} and type='IMAGE' order by sequence desc limit 1`
      )
    )[0]
    assert(image)
    imagePaths.push(
      ...(
        await h.query(
          `select storage_path from public.message_images where message_id=${h.q(
            image.id
          )}`
        )
      ).map((value) => value.storage_path)
    )
    const message = buyer.locator(`[data-message-id="${image.id}"]`)
    await message.waitFor()
    await message
      .getByRole('group', { name: 'Own content actions', exact: true })
      .focus()
    await buyer.keyboard.press('Shift+F10')
    await button(buyer, 'Withdraw').click()
    await message
      .getByText('You withdrew a message.', { exact: true })
      .waitFor({ timeout: 60000 })
    assert.equal(await message.locator('img').count(), 0)
    assert.equal(
      ok(
        await h.clients[1]
          .from('message_images')
          .select('id')
          .eq('message_id', image.id)
      ).length,
      0,
      'Withdrawn IMAGE metadata not signable'
    )
    // Sender withdrawal leaves a lightweight chronological tombstone, then a new Offer.
    await seller.setViewportSize({ width: 430, height: 900 })
    await longPress(
      seller,
      seller
        .locator(`[data-timeline-offer="${sellerActive.id}"]`)
        .getByRole('group', { name: 'Own content actions', exact: true })
    )
    await button(seller, 'Withdraw').click()
    await seller
      .getByText('You withdrew an offer.', { exact: true })
      .waitFor({ timeout: 60000 })
    await buyer
      .locator(`[data-timeline-offer="${sellerActive.id}"]`)
      .getByText(/withdrew an offer/)
      .waitFor({ timeout: 60000 })
    assert.equal(
      await buyer.locator(`[data-offer-id="${sellerActive.id}"]`).count(),
      0
    )
    const next = ok(
      await h.clients[0].rpc('marketplace_submit_offer', {
        p_conversation_id: cid,
        p_terms: { ...row.offer_terms, item_amount_cents: 7300 },
        p_client_action_id: uuid(),
        p_comparison_offer_id: buyerOffer.id,
        p_kind: 'counter',
      })
    )
    h.offers.push(next.id)
    h.journal()
    await buyer.locator(`[data-offer-id="${next.id}"] > button`).click()
    await safeDialog(buyer)
    let accepted, acceptCommand
    for (let attempt = 0; attempt < 3; attempt++) {
      const accepting = buyer.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/offers/${next.id}/accept`) &&
          response.request().method() === 'POST',
        { timeout: 60000 }
      )
      await button(buyer, 'Confirm').click()
      accepted = await accepting
      const body = await accepted.json()
      const command = accepted.request().postDataJSON().clientActionId
      if (acceptCommand)
        assert.equal(
          command,
          acceptCommand,
          'Media transport retry retains command identity'
        )
      acceptCommand = command
      if (accepted.status() === 200) break
      assert.equal(
        accepted.status(),
        503,
        'Unexpected Confirm failure: ' + JSON.stringify(body.error)
      )
      assert.equal(
        body.error,
        'Snapshot upload failed. Retry.',
        'Only this classified transport failure may retry'
      )
      assert.equal(
        (
          await h.query(
            `select count(*) count from public.orders where listing_id=${h.q(
              f.lid
            )}`
          )
        )[0].count,
        0,
        'Failed snapshot must not create an Order'
      )
      console.log(
        'Confirm media transport retry; same client command, no Order created'
      )
    }
    assert.equal(accepted.status(), 200, 'Confirm must eventually succeed')
    await buyer
      .locator(`[data-offer-id="${next.id}"][data-offer-status="Accepted"]`)
      .waitFor({ timeout: 60000 })
    history = ok(
      await h.clients[1].rpc('marketplace_offer_history', {
        p_conversation_id: cid,
      })
    )
    const orderId = history.agreements[0].id
    assert.equal(
      history.agreements.length,
      1,
      'Exactly one Order after Confirm/recovery'
    )
    assert(
      buyer.url().includes('section=messages'),
      'Confirm remains in Messages'
    )
    await seller
      .locator(
        `[data-offer-id="${buyerOffer.id}"][data-offer-status="No longer available"]`
      )
      .waitFor({ timeout: 60000 })
    for (const page of pages)
      await page
        .locator(`[data-timeline-agreement="${orderId}"]`)
        .getByText('Agreement reached', { exact: true })
        .waitFor({ timeout: 60000 })
    ok(
      await h.clients[1].rpc('marketplace_cancel_order', {
        p_order_id: orderId,
        p_reason: 'buyer_changed_mind',
        p_note: 'Synthetic qualification',
        p_client_action_id: uuid(),
      })
    )
    for (const page of pages)
      await page
        .locator(`[data-timeline-agreement="${orderId}"]`)
        .getByText('Cancelled', { exact: true })
        .waitFor({ timeout: 60000 })
    assert.equal(
      (
        await h.query(
          `select status from public.order_requests where id=${h.q(next.id)}`
        )
      )[0].status,
      'accepted'
    )
    assert(
      signals.every((count) => count > 0),
      'Both participants received private realtime invalidation'
    )
    for (const width of [390, 430, 1280, 1536]) {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]
        await page.setViewportSize({ width, height: 900 })
        await chat(page, cid, i === 0 ? 'selling' : 'buying')
        for (const [id, status] of [
          [f.offer, 'Declined'],
          [next.id, 'Accepted'],
          [buyerOffer.id, 'No longer available'],
          [expiredOfferId, 'Expired'],
        ]) {
          await page
            .locator(`[data-offer-id="${id}"][data-offer-status="${status}"]`)
            .waitFor({ timeout: 60000 })
        }
        await page
          .locator(`[data-timeline-agreement="${orderId}"]`)
          .getByText('Cancelled', { exact: true })
          .waitFor()
        await page
          .locator(`[data-message-id="${textSent.id}"]`)
          .getByText(/withdrew a message/)
          .waitFor()
        await page
          .locator(`[data-message-id="${image.id}"]`)
          .getByText(/withdrew a message/)
          .waitFor()
        assert.equal(
          await page.locator(`[data-message-id="${image.id}"] img`).count(),
          0
        )
        checks.push({
          width,
          role: i === 0 ? 'seller' : 'buyer',
          terminalHistory: true,
          withdrawalRedacted: true,
        })
      }
    }
    assert.deepEqual(errors, [], 'No real app runtime errors')
    console.log(
      JSON.stringify({
        checks,
        denied: true,
        imageWithdrawal: true,
        mobileTextLongPressWithdrawal: true,
        offerTombstone: true,
        confirm: true,
        remainingInMessages: true,
        agreementCancelled: true,
        acceptedEvidenceUnchanged: true,
        realtimeBothParticipants: true,
        runtimeErrors: 0,
      })
    )
  } finally {
    if (browser) await browser.close()
    if (imagePaths.length)
      assert(
        !(await h.admin.storage.from('chat-images').remove(imagePaths)).error,
        'Synthetic chat-image cleanup'
      )
    await h.cleanup()
    assert.deepEqual(
      await h.fingerprint(),
      baseline,
      'Canonical/manual unchanged'
    )
  }
}
run().catch((error) => {
  console.error('Revision browser qualification failed:', error.message)
  process.exitCode = 1
})
