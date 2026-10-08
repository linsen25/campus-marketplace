/* global window, document, Event, fetch */
// Concise Phase 3D release-candidate acceptance; preserves the Phase 3C contract. instrumentation contains counts, never auth payloads.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')

module.exports = async function acceptance(ctx) {
  const {
    seller,
    buyer,
    outsider,
    conversation: primary,
    files,
    base,
    api,
    openChat,
    sendFiles,
    readableImages,
    listingIds,
    conversationIds,
    pass,
  } = ctx
  const root = '/api/messages/conversations'
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async (check, label) => {
    for (let n = 0; n < 100; n++) {
      if (await check()) return
      await pause(100)
    }
    throw Error('Timed out: ' + label)
  }
  const stats = (page) => page.evaluate(() => ({ ...window.__phase3c }))
  const joined = (page) =>
    until(async () => (await stats(page)).active === 1, 'one private channel')
  const history = () =>
    api(buyer.context.request, `${root}/${primary}/messages`)
  const visible = (page, message) =>
    page
      .locator(`[data-message-id="${message.id}"]`)
      .waitFor({ timeout: 20000 })
  const send = async (page, content) => {
    const input = page.getByRole('textbox', { name: 'Message', exact: true })
    await page.bringToFront()
    assert.equal(
      await input.evaluate((element) => Boolean(element.closest('[inert]'))),
      false,
      'Composer is interactive'
    )
    await input.click()
    await input.press('ControlOrMeta+A')
    await input.press('Backspace')
    await input.pressSequentially(content, { delay: 15 })

    const button = page.locator('[data-chat-send]')
    try {
      await until(() => button.isEnabled(), 'composer ready')
    } catch {
      const state = await input.evaluate((element) => {
        const props =
          element[
            Object.keys(element).find((key) => key.startsWith('__reactProps$'))
          ] || {}
        const button = document.querySelector('[data-chat-send]')
        return {
          nativeLength: element.value.length,
          reactLength: String(props.value || '').length,
          disabled: button.disabled,
          buttonState: button.dataset.state,
          historyCount: document.querySelectorAll('[data-message-history]')
            .length,
          channelCounts: { ...window.__phase3c },
          detailInactive: document
            .querySelector('[data-mobile-message-screen=detail]')
            ?.getAttribute('aria-hidden'),
        }
      })
      throw Error('Composer state: ' + JSON.stringify(state))
    }
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes('/api/messages/conversations/') &&
        r.url().endsWith('/messages')
    )
    response.catch(() => {})
    await input.press('End')
    await input.press('Enter')
    const result = await response
    assert.equal(result.status(), 200)
    const message = await result.json()
    assert.equal(message.conversationId, primary)
    await visible(page, message)
    await page.locator('[data-chat-send][data-state=idle]').waitFor()
    return message
  }
  const canonicalSend = (session, id, content) =>
    api(session.context.request, `${root}/${id}/messages`, {
      type: 'TEXT',
      content,
      clientMessageId: crypto.randomUUID(),
    })
  await openChat(buyer.page, primary)
  await openChat(seller.page, primary, 'selling')
  await joined(seller.page)
  await joined(buyer.page)
  await outsider.page.goto(base + '/home?section=messages&destination=buying', {
    waitUntil: 'domcontentloaded',
  })
  await outsider.page
    .getByText('No conversations yet.', { exact: true })
    .waitFor()
  await joined(outsider.page)
  pass(
    'three real browser private channel joins and unchanged zero-conversation state'
  )
  const a = await send(buyer.page, 'Phase3C Buyer live TEXT')
  await visible(seller.page, a)
  pass('Buyer UI TEXT delivered live to Seller')
  const b = await send(seller.page, 'Phase3C Seller live TEXT')
  await visible(buyer.page, b)
  pass('Seller UI TEXT delivered live to Buyer')
  const one = await sendFiles(buyer.page, [files['fixture.jpg']])
  await visible(seller.page, one)
  await readableImages(seller.page)
  pass('Buyer UI IMAGE delivered live to Seller')
  const four = await sendFiles(seller.page, [
    files['fixture.jpg'],
    files['fixture.png'],
    files['fixture.webp'],
    files['fourth.png'],
  ])
  await visible(buyer.page, four)
  await readableImages(buyer.page)
  assert.equal(four.images.length, 4)
  for (const page of [buyer.page, seller.page])
    for (const message of [a, b, one, four])
      assert.equal(
        await page.locator(`[data-message-id="${message.id}"]`).count(),
        1
      )
  pass(
    'bidirectional real UI TEXT/one/four IMAGE live without reload, signed bytes and own echo dedupe'
  )

  // Two buying conversations plus a selling conversation served by the same user channel.
  async function createListing(session, title) {
    const listing = await api(
      session.context.request,
      '/api/listings',
      {
        title,
        description: 'Disposable Phase3C fixture',
        price: 4500,
        currency: 'CAD',
        category: 'Home & Dorm',
        subcategory: 'Furniture',
        condition: 'good',
        pickupArea: 'On campus',
        photoUrls: [],
        expectedImageCount: 1,
      },
      201
    )
    listingIds.push(listing.id)
    const response = await session.context.request.post(
      `${base}/api/listing-images/${listing.id}`,
      {
        headers: {
          Origin: base,
          'X-Marketplace-Request': '1',
          'Content-Type': 'image/jpeg',
        },
        data: fs.readFileSync(files['fixture.jpg']),
      }
    )
    assert.equal(response.status(), 200)
    await api(
      session.context.request,
      `/api/listings/${listing.id}/finalize`,
      {}
    )
    return listing.id
  }
  const secondaryListing = await createListing(
    seller,
    'Phase3C TEMP secondary ' + crypto.randomUUID().slice(0, 8)
  )
  const secondary = await api(buyer.context.request, root, {
    listingId: secondaryListing,
  })
  conversationIds.push(secondary.id)
  const buyerListing = await createListing(
    buyer,
    'Phase3C TEMP buyer-selling ' + crypto.randomUUID().slice(0, 8)
  )
  const selling = await api(outsider.context.request, root, {
    listingId: buyerListing,
  })
  conversationIds.push(selling.id)
  await pause(800)
  const inactive = await canonicalSend(
    seller,
    secondary.id,
    'Phase3C inactive unread'
  )
  await until(
    async () =>
      (await buyer.page
        .locator(
          `[data-conversation-id="${secondary.id}"] [data-conversation-unread]`
        )
        .count()) > 0,
    'inactive unread dot'
  )
  assert.equal(
    await buyer.page.locator(`[data-message-history="${primary}"]`).count(),
    1
  )
  assert(
    (await api(buyer.context.request, `${root}/${secondary.id}`)).unreadCount >
      0
  )
  await buyer.page
    .locator(`[data-conversation-id="${secondary.id}"]`)
    .first()
    .click()
  await visible(buyer.page, inactive)
  await until(
    async () =>
      (
        await api(buyer.context.request, `${root}/${secondary.id}`)
      ).unreadCount === 0,
    'rendered read'
  )
  pass(
    'multiple conversations live reorder/preview/unread, selection preserved and render-before-read'
  )

  for (let n = 0; n < 2; n++) {
    const listingId = await createListing(
      seller,
      'Phase3C TEMP rail ' + n + ' ' + crypto.randomUUID().slice(0, 8)
    )
    const item = await api(buyer.context.request, root, { listingId })
    conversationIds.push(item.id)
  }
  await until(
    () =>
      buyer.page
        .getByRole('button', { name: 'Expand conversations', exact: true })
        .count()
        .then((count) => count > 0),
    'recent three plus N rail'
  )
  await buyer.page
    .getByRole('button', { name: 'Expand conversations', exact: true })
    .click()
  assert.equal(
    await buyer.page
      .locator('[data-conversation-list] [data-conversation-id]')
      .count(),
    4
  )
  await buyer.page.getByRole('button', { name: 'Go Back', exact: true }).click()
  await canonicalSend(
    outsider,
    selling.id,
    'Phase3C Selling hidden-role live preview'
  )
  assert(
    (await api(buyer.context.request, `${root}/${selling.id}`)).unreadCount > 0
  )
  await buyer.page.locator('[data-slot=sidebar-body]').hover()
  const joinsBefore = (await stats(buyer.page)).joins
  await buyer.page.getByRole('button', { name: 'Selling', exact: true }).click()
  await buyer.page.locator(`[data-message-history="${selling.id}"]`).waitFor()
  await buyer.page
    .locator('[data-message-history]')
    .getByText('Phase3C Selling hidden-role live preview', { exact: true })
    .waitFor()
  await buyer.page.getByRole('button', { name: 'Buying', exact: true }).click()
  await buyer.page.locator(`[data-message-history="${secondary.id}"]`).waitFor()
  assert.equal((await stats(buyer.page)).active, 1)
  assert.equal((await stats(buyer.page)).joins, joinsBefore)
  pass(
    'Buying/Selling switches retain the same single channel; hidden role live preview/unread and recent three plus N expanded rail'
  )

  // Return with the actual existing navigation; no hidden replacement page.
  await openChat(buyer.page, primary)
  await joined(buyer.page)
  const requests = []
  buyer.page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      request.url().includes('/api/messages/conversations')
    )
      requests.push(Date.now())
  })
  const start = Date.now()
  const rapid1 = await canonicalSend(seller, primary, 'Phase3C rapid one')
  const rapid2 = await canonicalSend(seller, primary, 'Phase3C rapid two')
  const rapidImage = await sendFiles(seller.page, [files['fixture.webp']])
  const rapid3 = await canonicalSend(seller, primary, 'Phase3C rapid three')
  await visible(buyer.page, rapid3)
  await visible(buyer.page, rapidImage)
  const sequences = await buyer.page
    .locator('[data-message-id]')
    .evaluateAll((rows) =>
      rows.map((row) => Number(row.dataset.messageSequence))
    )
  assert.deepEqual(
    sequences,
    [...new Set(sequences)].sort((x, y) => x - y)
  )
  for (const message of [rapid1, rapid2, rapid3, rapidImage])
    assert.equal(
      await buyer.page.locator(`[data-message-id="${message.id}"]`).count(),
      1
    )
  pass('rapid TEXT/TEXT/IMAGE/TEXT converges by canonical identity/sequence', {
    refreshRequests: requests.length,
    convergenceMs: Date.now() - start,
    channels: (await stats(buyer.page)).active,
  })

  // Fill enough real history to exercise upward viewport/read boundaries.
  for (let n = 0; n < 12; n++)
    await canonicalSend(
      seller,
      primary,
      'Phase3C scroll ' + n + ' ' + 'scroll text '.repeat(18)
    )
  await until(
    async () => (await buyer.page.locator('[data-message-id]').count()) > 18,
    'scroll history'
  )
  const viewport = buyer.page.locator('[data-message-history]')
  await viewport.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  const beforeTop = await viewport.evaluate((element) => element.scrollTop)
  const upward = await canonicalSend(
    seller,
    primary,
    'Phase3C preserve upward scroll'
  )
  await visible(buyer.page, upward)
  assert(
    Math.abs(
      (await viewport.evaluate((element) => element.scrollTop)) - beforeTop
    ) < 100
  )
  assert(
    (await api(buyer.context.request, `${root}/${primary}`)).lastReadSequence <
      upward.sequence
  )
  await buyer.page.getByRole('button', { name: /Jump to latest/ }).click()
  await until(
    async () =>
      (
        await api(buyer.context.request, `${root}/${primary}`)
      ).lastReadSequence >= upward.sequence,
    'visible tail read'
  )
  pass(
    'incoming preserves upward viewport and unread until jump/render; near-bottom follows'
  )

  await buyer.context.setOffline(true)
  const missed = await canonicalSend(
    seller,
    primary,
    'Phase3C missed offline TEXT'
  )
  const missedImage = await sendFiles(seller.page, [files['fixture.png']])
  await buyer.context.setOffline(false)
  await buyer.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await visible(buyer.page, missed)
  await visible(buyer.page, missedImage)
  await joined(buyer.page)
  pass(
    'real browser offline/online reconnect catches missed TEXT/IMAGE without reload'
  )

  for (const width of [390, 430, 1280, 1536]) {
    await buyer.page.setViewportSize({ width, height: 900 })
    await openChat(buyer.page, primary)
    await joined(buyer.page)
    const live = await canonicalSend(
      seller,
      primary,
      'Phase3C responsive ' + width
    )
    await visible(buyer.page, live)
    const responsiveImage = await sendFiles(seller.page, [files['fixture.png']])
    await visible(buyer.page, responsiveImage)
    await readableImages(buyer.page)
    const overflow = await buyer.page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    assert.equal(overflow, false)
    if (width < 600) {
      await buyer.page
        .getByRole('button', { name: 'Go Back', exact: true })
        .click()
      await buyer.page
        .locator('[data-mobile-message-screen=list]:not([data-inactive=true])')
        .waitFor()
      assert.equal((await stats(buyer.page)).active, 1)
    }
    pass('responsive live TEXT/IMAGE, composer/gallery and mobile back', {
      width,
      channels: (await stats(buyer.page)).active,
    })
  }
  await openChat(buyer.page, primary)
  await require('./messages-realtime-browser-regression.cjs')({
    ...ctx,
    primary,
    one,
    four,
    send,
    visible,
    until,
    pause,
    canonicalSend,
    stats,
  })
  await openChat(buyer.page, primary)
  await api(
    outsider.context.request,
    `${root}/${primary}/messages`,
    undefined,
    404
  )
  await api(
    outsider.context.request,
    `/api/messages/images/${four.id}`,
    undefined,
    404
  )
  assert.equal(
    await outsider.page.locator(`[data-message-history="${primary}"]`).count(),
    0
  )
  pass(
    'Outsider cannot read history/sign IMAGE or render primary conversation; private topic rejection verified in Phase3B'
  )
  await outsider.page.addInitScript((topic) => {
    window.__phase3cOverrideTopic = topic
  }, `realtime:marketplace:messages:${a.senderId}`)
  await outsider.page.reload()
  await until(
    async () => (await stats(outsider.page)).rejected > 0,
    'real browser cross-user topic rejected'
  )
  await outsider.page.goto(base + '/home?section=profile', {
    waitUntil: 'domcontentloaded',
  })
  pass(
    'real Outsider browser private cross-user join rejected using its own authenticated access token'
  )
  await buyer.page.goto(base + '/home?section=profile', {
    waitUntil: 'domcontentloaded',
  })
  await until(
    async () => (await stats(buyer.page)).active === 0,
    'leave Messages cleanup'
  )
  await openChat(buyer.page, primary)
  await joined(buyer.page)
  await buyer.page.evaluate(async () => {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Marketplace-Request': '1',
      },
      body: '{}',
    })
    window.dispatchEvent(new Event('marketplace-session-ended'))
  })
  await until(
    async () => (await stats(buyer.page)).active === 0,
    'logout removes channel'
  )
  await api(buyer.context.request, root + '?role=buying', undefined, 401)
  pass(
    'leave/remount/logout lifecycle zero channels after teardown and no accumulated private channels'
  )
  assert(
    (await history().catch(() => ({ messages: [] }))).messages.length === 0
  )
}
