// Broader final acceptance over real browser/Auth/API/Storage contexts.
/* global document, window, Event, CompositionEvent */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
module.exports = async function acceptance(ctx) {
  const {
    seller,
    buyer,
    outsider,
    emails,
    password,
    ids,
    files,
    primary,
    base,
    api,
    openChat,
    attachments,
    sendFiles,
    readableImages,
    query,
    admin,
    pass,
    q,
    listingIds,
    conversationIds,
    extraListingPaths,
    transportFile,
  } = ctx
  const root = '/api/messages/conversations',
    images = '/api/messages/images'
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const history = () =>
    api(buyer.context.request, `${root}/${primary}/messages`)
  const detail = (session, id = primary) =>
    api(session.context.request, `${root}/${id}`)
  const wait = async (check, label) => {
    for (let n = 0; n < 60; n++) {
      if (await check()) return
      await sleep(100)
    }
    throw new Error('Timed out: ' + label)
  }
  const text = async (page, content) => {
    const input = page.getByRole('textbox', { name: 'Message', exact: true })
    await input.fill(content)
    await input.press('End')
    await input.press('Enter')
    await page
      .locator('[data-message-history]')
      .getByText(content.trim(), { exact: true })
      .waitFor()
    await page.locator('[data-chat-send][data-state=idle]').waitFor()
  }
  await buyer.page.setViewportSize({ width: 1280, height: 900 })
  await seller.page.reload()
  await openChat(buyer.page, primary)
  const beforeSeller = await detail(seller)
  // A fresh Buyer send while Seller is outside Messages must produce unread.
  await seller.page.goto(base + '/home', { waitUntil: 'domcontentloaded' })
  await text(buyer.page, 'Phase2D Buyer TEXT')
  await sendFiles(buyer.page, [files['fixture.jpg']])
  await seller.page.reload()
  assert((await detail(seller)).unreadCount >= 2)
  await openChat(seller.page, primary, 'selling')
  await readableImages(seller.page)
  await wait(
    async () => (await detail(seller)).unreadCount === 0,
    'Seller rendered read'
  )
  await buyer.page.goto(base + '/home', { waitUntil: 'domcontentloaded' })
  await text(seller.page, 'Phase2D Seller reply')
  const sellerFour = await sendFiles(
    seller.page,
    ['fixture.jpg', 'fixture.png', 'fixture.webp', 'fourth.png'].map(
      (name) => files[name]
    )
  )
  assert.equal((await detail(buyer)).lastMessage, '4 photos')
  assert((await detail(buyer)).unreadCount >= 2)
  await buyer.page.reload()
  await openChat(buyer.page, primary)
  await buyer.page.locator(`[data-message-id="${sellerFour.id}"]`).waitFor()
  await readableImages(buyer.page)
  await wait(
    async () => (await detail(buyer)).unreadCount === 0,
    'Buyer rendered read'
  )
  const mixed = await history()
  assert(
    mixed.messages.some(
      (item) => item.type === 'TEXT' && item.senderId === ids[0]
    )
  )
  assert(
    mixed.messages.some(
      (item) => item.type === 'IMAGE' && item.senderId === ids[1]
    )
  )
  assert.deepEqual(
    mixed.messages.map((item) => item.sequence),
    mixed.messages.map((_, n) => n + 1)
  )
  pass(
    'complete two-user TEXT/one-image/four-image workflow, unread/read, ordered history and 4 photos preview',
    {
      messages: mixed.messages.length,
      priorSellerWatermark: beforeSeller.lastReadSequence,
    }
  )
  // Refresh, logout/login and leaving Messages retain only server-backed messages.
  await buyer.page.reload()
  await buyer.page.locator(`[data-message-id="${sellerFour.id}"]`).waitFor()
  await readableImages(buyer.page)
  await api(buyer.context.request, '/api/auth/sign-out', {})
  await buyer.page.reload()
  await buyer.page
    .getByText('Sign in with your Western account to view Messages.')
    .waitFor()
  assert.equal(await buyer.page.locator('[data-message-id]').count(), 0)
  await api(buyer.context.request, '/api/auth/sign-in', {
    email: emails[1],
    password,
  })
  await openChat(buyer.page, primary)
  await buyer.page.locator(`[data-message-id="${sellerFour.id}"]`).waitFor()
  await readableImages(buyer.page)
  await buyer.page.goto(base + '/home', { waitUntil: 'domcontentloaded' })
  await openChat(buyer.page, primary)
  await readableImages(buyer.page)
  pass(
    'hard refresh, sign-out clears history, relogin and leave/return preserve durable images'
  )
  // Force invalid display URL and a failing renewal, without touching DB metadata.
  let renewalCalls = 0,
    historyInjected = false
  await buyer.page.route(`**${root}/${primary}/messages`, async (route) => {
    if (route.request().method() !== 'GET' || historyInjected)
      return route.continue()
    historyInjected = true
    const response = await route.fetch()
    const body = await response.json()
    const target = body.messages.find((item) => item.id === sellerFour.id)
    target.images = target.images.map((image) => ({
      ...image,
      previewUrl: image.previewUrl.replace(/token=[^&]+/, 'token=invalid'),
    }))
    await route.fulfill({ response, json: body })
  })
  await buyer.page.route(`**${images}/${sellerFour.id}`, async (route) => {
    renewalCalls++
    if (renewalCalls === 1)
      return route.fulfill({
        status: 503,
        json: { error: 'Disposable staging renewal failure' },
      })
    return route.continue()
  })
  await openChat(buyer.page, primary)
  const badRow = buyer.page.locator(`[data-message-id="${sellerFour.id}"]`)
  await badRow
    .getByRole('button', { name: 'Retry loading photos', exact: true })
    .waitFor()
  await sleep(3500)
  assert.equal(renewalCalls, 1, 'No automatic infinite renewal loop')
  const retryResponse = buyer.page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${images}/${sellerFour.id}` &&
      response.status() === 200
  )
  await badRow
    .getByRole('button', { name: 'Retry loading photos', exact: true })
    .click()
  await retryResponse
  await readableImages(buyer.page)
  await badRow
    .locator('img')
    .first()
    .evaluate((image) => {
      for (let n = 0; n < 10; n++) image.dispatchEvent(new Event('error'))
    })
  await sleep(600)
  assert.equal(renewalCalls, 2, 'Burst image errors are throttled')
  await buyer.page.unroute(`**${root}/${primary}/messages`)
  await buyer.page.unroute(`**${images}/${sellerFour.id}`)
  for (const session of [buyer, seller])
    assert.equal(
      (await api(session.context.request, `${images}/${sellerFour.id}`)).images
        .length,
      4
    )
  await api(
    outsider.context.request,
    `${images}/${sellerFour.id}`,
    undefined,
    404
  )
  const persisted = (
    await query(
      "select count(*) as urls from public.message_images where storage_path ~ '^(https?:|blob:)' or original_name like '%token=%';"
    )
  ).rows[0]
  assert.equal(Number(persisted.urls), 0)
  pass(
    'invalid signed display URL, renewal failure/retry, Buyer/Seller renewal and Outsider denial; no URL persistence or request loop',
    { renewalRequests: renewalCalls }
  )
  // Prepare, upload, partial upload and finalize HTTP failures preserve selection and retry identity.
  for (const stage of ['prepare', 'upload', 'partial', 'finalize']) {
    await openChat(buyer.page, primary)
    const before = (await history()).messages.length
    let seen = 0,
      nonce,
      submissionId
    const pattern =
      stage === 'prepare'
        ? `${images}/${primary}/prepare`
        : stage === 'finalize'
        ? '**/api/messages/images/*/finalize'
        : '**/api/messages/image-upload/*/*'
    const routePattern = pattern.startsWith('**') ? pattern : '**' + pattern
    const filter = async (route) => {
      seen++
      if (stage === 'prepare') {
        const payload = route.request().postDataJSON()
        if (nonce) assert.equal(payload.clientMessageId, nonce)
        else nonce = payload.clientMessageId
      }
      const pathname = new URL(route.request().url()).pathname
      if (stage === 'finalize') {
        const current = pathname.split('/').at(-2)
        if (submissionId) assert.equal(current, submissionId)
        else submissionId = current
      }
      if (seen === (stage === 'partial' ? 2 : 1))
        return route.fulfill({
          status: 503,
          json: { error: 'Disposable staging ' + stage + ' failure' },
        })
      return route.continue()
    }
    await buyer.page.route(routePattern, filter)
    const selected =
      stage === 'partial'
        ? [files['fixture.png'], files['fixture.webp']]
        : [files['fixture.png']]
    const panel = await attachments(buyer.page, selected)
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await panel.getByRole('alert').waitFor()
    assert.equal((await history()).messages.length, before)
    assert.equal(await panel.locator('input[type=file]').isDisabled(), true)
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await panel.waitFor({ state: 'detached' })
    const after = await history()
    assert.equal(after.messages.length, before + 1)
    assert.equal(after.messages.at(-1).images.length, selected.length)
    await buyer.page.unroute(routePattern)
    pass(
      'real UI ' +
        stage +
        ' failure preserves selected files and retries one canonical message',
      { routeRequests: seen }
    )
  }
  // Cancel A/B/C/D/E. B holds first upload; D holds finalize after all receipts.
  for (const stage of [
    'before-prepare',
    'reserved',
    'partial',
    'before-finalize',
    'after-finalize',
  ]) {
    await openChat(buyer.page, primary)
    const before = (await history()).messages.length
    const panel = await attachments(buyer.page, [
      files['fixture.png'],
      files['fixture.webp'],
    ])
    if (stage === 'before-prepare') {
      await panel
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      await panel.waitFor({ state: 'detached' })
      assert.equal((await history()).messages.length, before)
      pass('cancel before prepare remains local')
      continue
    }
    let release, held, submissionId
    const heldPromise = new Promise((resolve) => {
      held = resolve
    })
    const pattern =
      stage === 'before-finalize' || stage === 'after-finalize'
        ? '**/api/messages/images/*/finalize'
        : '**/api/messages/image-upload/*/*'
    let seen = 0
    await buyer.page.route(pattern, async (route) => {
      seen++
      const pathname = new URL(route.request().url()).pathname
      submissionId = pathname.split('/').at(-2)
      if (stage === 'after-finalize') {
        const response = await route.fetch()
        assert.equal(response.status(), 200)
        await route.abort()
        held()
        return
      }
      if (stage === 'partial' && seen === 1) return route.continue()
      if (seen === 1 || (stage === 'partial' && seen === 2)) {
        release = () => route.abort()
        held()
        return new Promise((resolve) => {
          const original = release
          release = async () => {
            await original()
            resolve()
          }
        })
      }
      return route.continue()
    })
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await heldPromise
    if (stage === 'after-finalize') {
      await panel.getByRole('alert').waitFor()
      await panel
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      await panel
        .getByRole('alert')
        .filter({ hasText: 'already have completed' })
        .waitFor()
      assert.equal(
        await panel.isVisible(),
        true,
        'Cannot visually cancel durable send'
      )
      assert.equal((await history()).messages.length, before + 1)
      await buyer.page.unroute(pattern)
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await panel.waitFor({ state: 'detached' })
      assert.equal((await history()).messages.length, before + 1)
    } else {
      const abandoned = buyer.page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `${images}/${submissionId}/cancel` && response.status() === 200
      )
      await panel
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      await abandoned
      await release()
      await panel.waitFor({ state: 'detached' })
      assert.equal((await history()).messages.length, before)
      const reservation = (
        await query(
          `select state,manifest from public.image_message_submissions where id=${q(
            submissionId
          )};`
        )
      ).rows[0]
      assert.equal(reservation.state, 'abandoned')
      for (const slot of reservation.manifest)
        assert(
          (await admin.storage.from('chat-images').info(slot.storage_path))
            .error
        )
      await buyer.page.unroute(pattern)
    }
    pass(
      'cancel ' +
        stage +
        ' follows real terminal state and preserves durable history'
    )
  }
  // Physical cleanup failure through test-only server transport; queue retains provenance.
  await openChat(buyer.page, primary)
  let cleanupSubmission,
    uploads = 0
  await buyer.page.route('**/api/messages/image-upload/*/*', async (route) => {
    uploads++
    cleanupSubmission = new URL(route.request().url()).pathname
      .split('/')
      .at(-2)
    if (uploads === 2)
      return route.fulfill({
        status: 503,
        json: { error: 'Disposable partial upload failure' },
      })
    return route.continue()
  })
  const cleanupPanel = await attachments(buyer.page, [
    files['fixture.png'],
    files['fixture.webp'],
  ])
  await cleanupPanel.getByRole('button', { name: 'Send', exact: true }).click()
  await cleanupPanel.getByRole('alert').waitFor()
  fs.writeFileSync(
    transportFile,
    JSON.stringify({
      counts: {},
      cleanupFailures: 20,
      namespace: `${primary}/${cleanupSubmission}/`,
    })
  )
  await cleanupPanel
    .getByRole('button', { name: 'Add attachment', exact: true })
    .click()
  await cleanupPanel.waitFor({ state: 'detached' })
  await buyer.page.unroute('**/api/messages/image-upload/*/*')
  const cleanupPlan = JSON.parse(fs.readFileSync(transportFile, 'utf8'))
  assert(cleanupPlan.cleanupFailureHits >= 2)
  const cleanupReservation = (
    await query(
      `select state,manifest from public.image_message_submissions where id=${q(
        cleanupSubmission
      )};`
    )
  ).rows[0]
  assert.equal(cleanupReservation.state, 'abandoned')
  assert(
    !(
      await admin.storage
        .from('chat-images')
        .info(cleanupReservation.manifest[0].storage_path)
    ).error
  )
  const queue = (
    await query(
      `select count(*) as count from marketplace_private.chat_image_cleanup where storage_path like ${q(
        `${primary}/${cleanupSubmission}/%`
      )};`
    )
  ).rows[0]
  assert.equal(Number(queue.count), 2)
  const removed = await admin.storage
    .from('chat-images')
    .remove(cleanupReservation.manifest.map((slot) => slot.storage_path))
  assert(!removed.error)
  pass(
    'server Storage remove failure after real UI cancel retains abandoned queue; supported operator retry removes orphan'
  )
  // TEXT keyboard/IME/trim/idempotency regression.
  await openChat(buyer.page, primary)
  const input = buyer.page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  })
  await input.fill('  Phase2D trim')
  await input.press('Shift+Enter')
  await input.pressSequentially('line  ')
  await input.press('Enter')
  await buyer.page.getByText('Phase2D trim\nline', { exact: true }).waitFor()
  await buyer.page.locator('[data-chat-send][data-state=idle]').waitFor()
  const beforeIme = (await history()).messages.length
  await input.fill('Phase2D IME')
  await input.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    )
  )
  await input.press('Enter')
  assert.equal((await history()).messages.length, beforeIme)
  await input.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true })
    )
  )
  await input.press('Enter')
  await buyer.page.getByText('Phase2D IME', { exact: true }).waitFor()
  await buyer.page.locator('[data-chat-send][data-state=idle]').waitFor()
  let lostTextId
  await buyer.page.route(`**${root}/${primary}/messages`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    lostTextId = (await response.json()).id
    await route.abort()
    await buyer.page.unroute(`**${root}/${primary}/messages`)
  })
  await input.fill('Phase2D TEXT retry')
  await input.press('Enter')
  await buyer.page.getByRole('alert').waitFor()
  await buyer.page.locator('[data-chat-send][data-state=idle]').waitFor()
  await input.press('Enter')
  await buyer.page.locator(`[data-message-id="${lostTextId}"]`).waitFor()
  assert.equal(
    (await history()).messages.filter((item) => item.id === lostTextId).length,
    1
  )
  await buyer.page.reload()
  await buyer.page.getByText('Phase2D TEXT retry', { exact: true }).waitFor()
  pass(
    'TEXT Enter, Shift+Enter, IME, trim, refresh and lost-response same-ID retry preserved'
  )
  // More real published listings provide conversation switching and expanded recent rail.
  async function createListing(index) {
    await seller.page.goto(base + '/home?section=create-listing', {
      waitUntil: 'domcontentloaded',
    })
    const form = seller.page.getByRole('form', {
      name: 'Create listing',
      exact: true,
    })
    await form.waitFor({ timeout: 60000 })
    await form
      .locator('[name=title]')
      .fill(`Phase2D TEMP secondary ${index} ${ctx.run}`)
    await form.locator('[name=price]').fill('12')
    for (const [name, label] of [
      ['Category', 'Home & Dorm'],
      ['Subcategory', 'Furniture'],
      ['Condition', 'Good'],
      ['Place', 'On campus'],
    ]) {
      await form.getByRole('combobox', { name, exact: true }).click()
      const option = form.getByRole('option', { name: label, exact: true })
      await option.scrollIntoViewIfNeeded()
      await option.click()
    }
    await form
      .locator('[name=description]')
      .fill('Disposable final staging acceptance fixture')
    await form.locator('input[type=file]').setInputFiles(files['fixture.jpg'])
    const response = seller.page.waitForResponse((result) =>
      /\/api\/listings\/[^/]+\/finalize$/.test(new URL(result.url()).pathname)
    )
    await form.getByRole('button', { name: 'Create', exact: true }).click()
    const published = await response
    assert.equal(published.status(), 200)
    const listing = await published.json()
    listingIds.push(listing.id)
    await buyer.page.goto(`${base}/listings/${listing.id}`, {
      waitUntil: 'domcontentloaded',
    })
    await buyer.page
      .getByRole('button', { name: 'Contact Seller', exact: true })
      .click()
    await buyer.page.waitForURL(/conversation=/)
    const id = new URL(buyer.page.url()).searchParams.get('conversation')
    conversationIds.push(id)
    return { listing: listing.id, id }
  }
  const secondary = []
  for (let index = 0; index < 4; index++)
    secondary.push(await createListing(index))
  await buyer.page.setViewportSize({ width: 1280, height: 900 })
  await openChat(buyer.page, primary)
  await buyer.page
    .locator('[data-conversation-id="' + secondary[3].id + '"]')
    .click()
  await buyer.page
    .locator('[data-message-history="' + secondary[3].id + '"]')
    .waitFor()
  await buyer.page
    .getByRole('button', { name: 'Expand conversations', exact: true })
    .click()
  await buyer.page
    .locator(
      '[data-conversation-list] [data-conversation-id="' + primary + '"]'
    )
    .click()
  await buyer.page.locator(`[data-message-id="${sellerFour.id}"]`).waitFor()
  await readableImages(buyer.page)
  await text(buyer.page, 'Phase2D recent ordering')
  const list = await api(buyer.context.request, root + '?role=buying')
  assert.equal(list.conversations[0].id, primary)
  pass(
    'switching conversations preserves IMAGE history and new activity moves correct conversation first'
  )
  const two = await sendFiles(buyer.page, [
    files['fixture.png'],
    files['fixture.webp'],
  ])
  const three = await sendFiles(buyer.page, [
    files['fixture.jpg'],
    files['fixture.png'],
    files['fixture.webp'],
  ])
  for (const width of [390, 430, 1280, 1536]) {
    await buyer.page.setViewportSize({ width, height: 900 })
    await openChat(buyer.page, primary)
    await buyer.page.locator(`[data-message-id="${three.id}"]`).waitFor()
    await readableImages(buyer.page)
    assert.equal(
      await buyer.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      ),
      true
    )
    const viewport = buyer.page.locator('[data-message-history]')
    const scroll = await viewport.evaluate((element) => {
      element.scrollTop = Math.min(
        120,
        element.scrollHeight - element.clientHeight
      )
      return element.scrollTop
    })
    const panel = await attachments(buyer.page, [files['fixture.png']])
    assert(await panel.isVisible())
    await panel
      .getByRole('button', { name: 'Add attachment', exact: true })
      .click()
    await panel.waitFor({ state: 'detached' })
    assert(
      Math.abs(
        (await viewport.evaluate((element) => element.scrollTop)) - scroll
      ) < 3,
      'Cancel preserves chat scroll'
    )
    for (const message of [two, three, sellerFour]) {
      const row = buyer.page.locator(`[data-message-id="${message.id}"]`)
      await row
        .getByRole('button', {
          name: new RegExp('See all ' + message.images.length + ' photos'),
        })
        .click()
      assert.equal(
        await row.locator('[data-image-gallery]').getAttribute('data-expanded'),
        'true'
      )
      await readableImages(buyer.page)
      await buyer.page.keyboard.press('Escape')
      await wait(
        async () =>
          (await row
            .locator('[data-image-gallery]')
            .getAttribute('data-expanded')) === 'false',
        'gallery close'
      )
    }
    assert.equal(
      await buyer.page
        .locator(`[data-message-id="${two.id}"]`)
        .getAttribute('data-sent'),
      'true'
    )
    assert.equal(
      await buyer.page
        .locator(`[data-message-id="${sellerFour.id}"]`)
        .getAttribute('data-sent'),
      'false'
    )
    if (width < 1024) {
      await buyer.page
        .getByRole('button', { name: 'Go Back', exact: true })
        .click()
      const screen = buyer.page.locator('[data-mobile-message-screen=list]')
      await screen.getByRole('button').first().waitFor()
      await screen.locator(`[data-conversation-id="${primary}"]`).click()
      await buyer.page
        .getByRole('textbox', { name: 'Message', exact: true })
        .waitFor()
    } else {
      await buyer.page
        .getByRole('button', { name: 'Expand conversations', exact: true })
        .click()
      assert.equal(
        await buyer.page
          .locator('[data-client-card]')
          .getAttribute('data-contacts-expanded'),
        'true'
      )
      await buyer.page
        .getByRole('button', { name: 'Go Back', exact: true })
        .click()
      await wait(
        async () =>
          (await buyer.page
            .locator('[data-client-card]')
            .getAttribute('data-contacts-expanded')) === 'false',
        'rail collapse'
      )
    }
    pass('responsive real mixed IMAGE acceptance', {
      width,
      scrollPreserved: true,
      galleries: [2, 3, 4],
      alignment: true,
    })
  }
  await outsider.page.goto(base + '/home?section=messages&destination=buying', {
    waitUntil: 'domcontentloaded',
  })
  await outsider.page
    .getByText('No conversations yet.', { exact: true })
    .waitFor()
  assert.equal(await outsider.page.locator('[data-client-card]').count(), 0)
  pass('zero-conversation empty state remains clean')
  // Lifecycle through normal owner API, with real signed renders after both changes.
  await buyer.page.setViewportSize({ width: 1280, height: 900 })
  await openChat(buyer.page, primary)
  await api(seller.context.request, `/api/listings/${listingIds[0]}/sold`, {})
  assert.equal((await detail(seller)).listing.availability, 'sold')
  assert.equal((await detail(buyer)).listing.availability, 'unavailable')
  assert.equal(
    (
      await query(
        `select status from public.listings where id=${q(listingIds[0])};`
      )
    ).rows[0].status,
    'sold'
  )
  await buyer.page.reload()
  await readableImages(buyer.page)
  await sendFiles(buyer.page, [files['fixture.webp']])
  const deletedCase = secondary[0]
  await openChat(buyer.page, deletedCase.id)
  const retained = await sendFiles(buyer.page, [files['fixture.png']])
  const paths = (
    await query(
      `select path from public.listing_images where listing_id=${q(
        deletedCase.listing
      )};`
    )
  ).rows.map((item) => item.path)
  extraListingPaths.push(...paths)
  const deleted = await seller.context.request.delete(
    base + '/api/listings/' + deletedCase.listing,
    { headers: { 'X-Marketplace-Request': '1', Origin: base } }
  )
  assert.equal(deleted.status(), 200)
  await buyer.page.reload()
  await buyer.page.locator(`[data-message-id="${retained.id}"]`).waitFor()
  await readableImages(buyer.page)
  assert.equal(
    (await detail(buyer, deletedCase.id)).listing.availability,
    'deleted'
  )
  await buyer.page
    .getByRole('button', { name: 'View listing', exact: true })
    .click()
  const listingDialog = buyer.page.getByRole('dialog', {
    name: 'Listing preview',
    exact: true,
  })
  await listingDialog.waitFor()
  assert(/no longer|deleted|unavailable/i.test(await listingDialog.innerText()))
  await buyer.page.keyboard.press('Escape')
  await sendFiles(buyer.page, [files['fixture.webp']])
  pass(
    'sold/deleted listing retains snapshots, IMAGE signed reads and sends; View Listing degrades gracefully'
  )
  // Outsider identity, endpoints, namespace and client field tampering.
  const owned = (
    await query(
      `select id,manifest from public.image_message_submissions where id=${q(
        sellerFour.id
      )};`
    )
  ).rows[0]
  for (const endpoint of [
    `${root}/${primary}`,
    `${root}/${primary}/messages`,
    `${images}/${sellerFour.id}`,
  ])
    await api(outsider.context.request, endpoint, undefined, 404)
  for (const action of ['finalize', 'cancel'])
    await api(
      outsider.context.request,
      `${images}/${owned.id}/${action}`,
      {},
      404
    )
  const upload = await outsider.context.request.post(
    `${base}/api/messages/image-upload/${owned.id}/${owned.manifest[0].id}`,
    {
      headers: {
        'X-Marketplace-Request': '1',
        'Content-Type': 'image/jpeg',
        Origin: base,
      },
      data: fs.readFileSync(files['fixture.jpg']),
    }
  )
  assert.equal(upload.status(), 404)
  await api(
    buyer.context.request,
    `${images}/${primary}/prepare`,
    { clientMessageId: crypto.randomUUID(), images: [], senderId: ids[2] },
    400
  )
  await api(outsider.context.request, `${images}/not-a-uuid`, undefined, 400)
  const publicUrl = admin.storage
    .from('chat-images')
    .getPublicUrl(owned.manifest[0].storage_path).data.publicUrl
  assert.notEqual((await buyer.context.request.get(publicUrl)).status(), 200)
  const settings = (
    await query(
      "select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='chat-images';"
    )
  ).rows[0]
  assert.equal(settings.public, false)
  assert.equal(Number(settings.file_size_limit), 3145728)
  pass(
    'Outsider conversation/history/upload/finalize/cancel/signing denied; UUID/sender tampering rejected; public chat URL unavailable'
  )
  // Single bounded history query/signing batch measured through test-only server transport.
  await openChat(buyer.page, primary)
  await buyer.page.locator(`[data-message-id="${sellerFour.id}"]`).waitFor()
  await sleep(500)
  fs.writeFileSync(transportFile, JSON.stringify({ counts: {} }))
  const began = Date.now()
  await history()
  const counts = JSON.parse(fs.readFileSync(transportFile, 'utf8')).counts
  assert.equal(counts.messageQueries, 1)
  assert.equal(counts.imageMetadataQueries, 1)
  assert.equal(counts.signBatches, 1)
  pass('representative history HTTP/server request-count observation', {
    milliseconds: Date.now() - began,
    counts,
  })
  fs.writeFileSync(transportFile, JSON.stringify({ counts: {} }))
  let start = Date.now()
  await sendFiles(buyer.page, [files['fixture.png']])
  pass('one-image send performance observation', {
    milliseconds: Date.now() - start,
    counts: JSON.parse(fs.readFileSync(transportFile, 'utf8')).counts,
  })
  fs.writeFileSync(transportFile, JSON.stringify({ counts: {} }))
  start = Date.now()
  await sendFiles(
    buyer.page,
    ['fixture.jpg', 'fixture.png', 'fixture.webp', 'fourth.png'].map(
      (name) => files[name]
    )
  )
  pass('four-image send performance observation', {
    milliseconds: Date.now() - start,
    counts: JSON.parse(fs.readFileSync(transportFile, 'utf8')).counts,
  })
  const final = await history()
  assert.deepEqual(
    final.messages.map((item) => item.sequence),
    final.messages.map((_, n) => n + 1)
  )
  pass('all failure/cancel and mixed-history sequences remain gap-free', {
    messages: final.messages.length,
  })
}
