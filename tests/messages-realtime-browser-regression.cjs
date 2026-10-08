/* global CompositionEvent */
const assert = require('node:assert/strict')

module.exports = async function regression(ctx) {
  const {
    buyer,
    seller,
    primary,
    one,
    four,
    files,
    base,
    api,
    attachments,
    readableImages,
    send,
    visible,
    until,
    pause,
    canonicalSend,
    stats,
    pass,
  } = ctx
  const root = '/api/messages/conversations'
  const input = buyer.page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  })
  const enterText = async (content) => {
    await input.click()
    await input.press('ControlOrMeta+A')
    await input.press('Backspace')
    await input.pressSequentially(content, { delay: 10 })
  }
  const guardedResponse = (predicate) => {
    const promise = buyer.page.waitForResponse(predicate)
    promise.catch(() => {})
    return promise
  }
  const historyURL = `${base}${root}/${primary}/messages`
  let failedReads = 0
  const historyFailure = (route) => {
    if (route.request().method() === 'GET') {
      failedReads++
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'private, no-store' },
        body: JSON.stringify({
          error: 'Temporary fixture presentation failure.',
        }),
      })
    }
    return route.continue()
  }
  await buyer.page.route(historyURL, historyFailure)
  const previous = await buyer.page.locator('[data-message-id]').count()
  const missed = await canonicalSend(
    seller,
    primary,
    'Phase3C failed history reconciliation'
  )
  await until(() => failedReads > 0, 'canonical history failure')
  assert((await buyer.page.locator('[data-message-id]').count()) >= previous)
  await buyer.page.unroute(historyURL, historyFailure)
  const restored = await send(seller.page, 'Phase3C history recovery')
  await visible(buyer.page, missed)
  await visible(buyer.page, restored)
  pass(
    'canonical refresh failure retains displayed history and future invalidation heals it'
  )

  const signingURL = `${base}/api/messages/images/${one.id}`
  const signingFailure = (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store' },
      body: JSON.stringify({ error: 'Temporary fixture signing failure.' }),
    })
  await buyer.page.route(signingURL, signingFailure)
  await buyer.page
    .locator(`[data-message-id="${one.id}"] img`)
    .evaluate((image) => {
      const url = new URL(image.src)
      url.searchParams.set('token', 'invalid-staging-fixture')
      image.src = url.toString()
    })
  await buyer.page
    .getByRole('button', { name: 'Retry loading photos', exact: true })
    .waitFor()
  await buyer.page.unroute(signingURL, signingFailure)
  await pause(3100)
  await buyer.page
    .getByRole('button', { name: 'Retry loading photos', exact: true })
    .click()
  await readableImages(buyer.page)
  await buyer.page
    .getByRole('button', { name: 'Retry loading photos', exact: true })
    .waitFor({ state: 'detached' })
  pass(
    'signed IMAGE renewal failure is recoverable without changing durable data or messaging authority'
  )

  let ambiguousId,
    intercepted = false
  const textFailure = async (route) => {
    if (route.request().method() !== 'POST' || intercepted)
      return route.continue()
    intercepted = true
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    ambiguousId = (await response.json()).id
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store' },
      body: JSON.stringify({
        error: 'Temporary staging response loss. Retry.',
      }),
    })
  }
  await buyer.page.route(historyURL, textFailure)
  await enterText('Phase3C ambiguous TEXT retry')
  const failed = guardedResponse(
    (response) =>
      response.url() === historyURL && response.request().method() === 'POST'
  )
  await input.press('End')
  await input.press('Enter')
  assert.equal((await failed).status(), 502)
  await buyer.page.locator('[data-chat-send][data-state=idle]').waitFor()
  await buyer.page.unroute(historyURL, textFailure)
  const retried = await send(buyer.page, 'Phase3C ambiguous TEXT retry')
  assert.equal(retried.id, ambiguousId)
  await visible(seller.page, retried)
  assert.equal(
    await buyer.page.locator(`[data-message-id="${ambiguousId}"]`).count(),
    1
  )
  pass(
    'ambiguous TEXT response retry reuses durable identity despite Realtime echo; keyboard send preserved'
  )

  let imageId,
    firstFinalize = true
  const finalizePattern = `${base}/api/messages/images/*/finalize`
  const imageFailure = async (route) => {
    if (!firstFinalize) return route.continue()
    firstFinalize = false
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    imageId = (await response.json()).id
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store' },
      body: JSON.stringify({
        error: 'Temporary staging response loss. Retry.',
      }),
    })
  }
  await buyer.page.route(finalizePattern, imageFailure)
  const panel = await attachments(buyer.page, [files['fixture.webp']])
  const failedImage = guardedResponse((response) =>
    response.url().endsWith('/finalize')
  )
  await panel.getByRole('button', { name: 'Send', exact: true }).click()
  assert.equal((await failedImage).status(), 502)
  await panel.locator('button[data-state=idle]').waitFor()
  await buyer.page.unroute(finalizePattern, imageFailure)
  const confirmedImage = guardedResponse((response) =>
    response.url().endsWith('/finalize')
  )
  await panel.getByRole('button', { name: 'Send', exact: true }).click()
  const confirmation = await confirmedImage
  assert.equal(confirmation.status(), 200)
  assert.equal((await confirmation.json()).id, imageId)
  await panel.waitFor({ state: 'detached' })
  await visible(seller.page, { id: imageId })
  assert.equal(
    await buyer.page.locator(`[data-message-id="${imageId}"]`).count(),
    1
  )
  pass(
    'ambiguous IMAGE finalize retry preserves nonce/manifest and one visible durable IMAGE through echo'
  )

  const beforeCancel = (await api(buyer.context.request, `${root}/${primary}`))
    .lastMessageSequence
  const canceled = await attachments(buyer.page, [files['fixture.png']])
  await canceled
    .getByRole('button', { name: 'Add attachment', exact: true })
    .click()
  await canceled.waitFor({ state: 'detached' })
  assert.equal(
    (await api(buyer.context.request, `${root}/${primary}`))
      .lastMessageSequence,
    beforeCancel
  )
  const gallery = buyer.page.locator(
    `[data-message-id="${four.id}"] [data-image-gallery]`
  )
  await gallery.getByRole('button', { name: /See all 4 photos/ }).click()
  await gallery.locator('button[aria-label="View photo 4 of 4"]').waitFor()
  assert.deepEqual(
    await gallery
      .locator('img')
      .evaluateAll((images) => images.map((image) => image.alt)),
    ['fixture.jpg', 'fixture.png', 'fixture.webp', 'fourth.png']
  )
  await gallery.getByRole('button', { name: /Go back to chat/ }).click()
  pass(
    'attachment cancel creates no message; four-image gallery order/expand/collapse survives reconciliation'
  )

  let imePosts = 0
  const countPosts = (request) => {
    if (request.method() === 'POST' && request.url() === historyURL) imePosts++
  }
  buyer.page.on('request', countPosts)
  await enterText('Phase3C IME guarded TEXT')
  await input.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    )
  )
  await input.press('Enter')
  await pause(200)
  assert.equal(imePosts, 0)
  await input.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true })
    )
  )
  const imeResult = guardedResponse(
    (response) =>
      response.url() === historyURL && response.request().method() === 'POST'
  )
  await input.press('Enter')
  assert.equal((await imeResult).status(), 200)
  await buyer.page.locator('[data-chat-send][data-state=idle]').waitFor()
  buyer.page.off('request', countPosts)
  pass(
    'IME Enter does not send while composing; normal Enter sends once after composition'
  )
  await buyer.page.reload()
  await seller.page.reload()
  for (const page of [buyer.page, seller.page]) {
    await page.locator(`[data-message-id="${imageId}"]`).waitFor()
    await readableImages(page)
    assert.equal(
      await page.locator(`[data-message-id="${ambiguousId}"]`).count(),
      1
    )
    assert.equal((await stats(page)).active, 1)
  }
  pass(
    'TEXT/IMAGE persistence, signed read, nonce retry and gallery survive full browser refresh'
  )
}
