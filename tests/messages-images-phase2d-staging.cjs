// Opt-in STAGING-only frontend acceptance. Secrets/sessions live only in memory.
/* global document, Navigator, window, Event */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const sharp = require('sharp')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const ref = 'pcaqxezdfxofysghssyo',
  url = `https://${ref}.supabase.co`
const base = 'http://localhost:3103'
const run = crypto.randomUUID().slice(0, 8)
const folder = path.resolve('tests/artifacts/messages-phase2d', run)
fs.mkdirSync(folder, { recursive: true })
const ids = [],
  listingIds = [],
  conversationIds = [],
  results = [],
  extraListingPaths = []
let admin,
  browser,
  server,
  queryIndex = 0,
  serverReady = false
const password = crypto.randomBytes(24).toString('hex') + 'Aa9!'
const headers = { 'X-Marketplace-Request': '1', Origin: base }
const transportFile = path.join(folder, 'transport.json')
fs.writeFileSync(transportFile, JSON.stringify({ counts: {} }))
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'"
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'cmd.exe',
      ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args],
      { windowsHide: true }
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', () => {})
    child.on('error', () => reject(new Error('Staging CLI launch failed')))
    child.on('close', (code) => {
      if (code)
        return reject(new Error('Staging CLI failed; output suppressed'))
      try {
        resolve(JSON.parse(output.slice(output.indexOf('{'))))
      } catch {
        reject(new Error('Unexpected staging CLI response'))
      }
    })
  })
}
async function query(sql) {
  const file = path.join(folder, `query-${queryIndex++}.sql`)
  fs.writeFileSync(file, sql)
  try {
    return await cli([
      'db',
      'query',
      '--linked',
      '--project-ref',
      ref,
      '--file',
      file,
    ])
  } finally {
    fs.unlinkSync(file)
  }
}
function pass(test, details = {}) {
  const entry = { test, result: 'PASS', ...details }
  results.push(entry)
  console.log(JSON.stringify(entry))
}
async function api(context, endpoint, data, expected = 200) {
  const response = await context[data === undefined ? 'get' : 'post'](
    base + endpoint,
    { headers, ...(data === undefined ? {} : { data }) }
  )
  assert.equal(
    response.status(),
    expected,
    `${endpoint}: status ${response.status()} (body suppressed)`
  )
  assert.match(response.headers()['cache-control'], /no-store/)
  return response.json()
}
const messages = '/api/messages/conversations'
async function openChat(page, id, role = 'buying') {
  await page.goto(
    `${base}/home?section=messages&destination=${role}&conversation=${id}`,
    { waitUntil: 'domcontentloaded' }
  )
  await page
    .locator(`[data-message-history="${id}"]`)
    .waitFor({ timeout: 60000 })
  await page
    .getByRole('button', { name: 'Add attachment', exact: true })
    .waitFor()
}
async function attachments(page, files) {
  await page
    .getByRole('button', { name: 'Add attachment', exact: true })
    .click()
  const panel = page.locator('[data-attachment-panel]')
  await panel.locator('input[type=file]').setInputFiles(files)
  return panel
}
async function sendFiles(page, files) {
  const panel = await attachments(page, files)
  const finished = page.waitForResponse((response) =>
    /\/api\/messages\/images\/[^/]+\/finalize$/.test(
      new URL(response.url()).pathname
    )
  )
  await panel.getByRole('button', { name: 'Send', exact: true }).click()
  const response = await finished
  assert.equal(response.status(), 200, 'Finalize HTTP (body suppressed)')
  const message = await response.json()
  await page
    .locator(`[data-message-id="${message.id}"]`)
    .waitFor({ timeout: 20000 })
  await panel.waitFor({ state: 'detached' })
  return message
}
async function readableImages(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-message-id] img').length > 0 &&
      [...document.querySelectorAll('[data-message-id] img')].every(
        (image) => image.complete && image.naturalWidth > 0
      ),
    { timeout: 30000 }
  )
}
async function main() {
  const projects = await cli(['projects', 'list'])
  const linked = projects.projects.filter((item) => item.linked)
  assert.equal(linked.length, 1)
  assert.equal(linked[0].ref, ref)
  assert.equal(linked[0].name, 'western-marketplace-staging')
  const keys = await cli(['projects', 'api-keys', '--project-ref', ref])
  const publicKey = keys.keys.find((item) => item.name === 'anon').api_key
  const privateKey = keys.keys.find(
    (item) => item.name === 'service_role'
  ).api_key
  for (const [key, role] of [
    [publicKey, 'anon'],
    [privateKey, 'service_role'],
  ]) {
    const claims = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64url').toString()
    )
    assert.equal(claims.ref, ref)
    assert.equal(claims.role, role)
  }
  admin = createClient(url, privateKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const migration = await query(
    'begin read only; select version from supabase_migrations.schema_migrations order by version; rollback;'
  )
  assert(migration.rows.some((row) => row.version === '202610070002'))
  if (process.argv.includes('--recover-fixtures')) {
    const old = (
      await query(
        "select id from auth.users where email like 'phase2d-%@uwo.ca';"
      )
    ).rows
    ids.push(...old.map((item) => item.id))
    return
  }
  pass(
    'staging identity and already-applied IMAGE migration confirmed; no schema mutation'
  )
  server = spawn(
    process.execPath,
    [
      '--require',
      path.resolve('tests/messages-phase2d-transport.cjs'),
      require.resolve('next/dist/bin/next'),
      'dev',
      '-p',
      '3103',
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        PHASE2D_TRANSPORT_FILE: transportFile,
        APP_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
        SUPABASE_SERVICE_ROLE_KEY: privateKey,
      },
    }
  )
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('started server')) serverReady = true
  })
  server.stderr.on('data', () => {})
  for (let n = 0; n < 60 && !serverReady; n++)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  assert(serverReady, 'Staging development server ready')
  const names = ['Seller', 'Buyer', 'Outsider']
  const emails = []
  for (const name of names) {
    const email = `phase2d-${run}-${name.toLowerCase()}@uwo.ca`
    emails.push(email)
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `P2D_${name[0]}_${run}` },
    })
    assert(
      !created.error && created.data.user,
      'Disposable Auth fixture created (details suppressed)'
    )
    ids.push(created.data.user.id)
  }
  const jpeg = await sharp({
    create: { width: 100, height: 80, channels: 3, background: '#8855aa' },
  })
    .jpeg()
    .toBuffer()
  const png = await sharp({
    create: { width: 110, height: 90, channels: 3, background: '#228877' },
  })
    .png()
    .toBuffer()
  const webp = await sharp({
    create: { width: 120, height: 100, channels: 3, background: '#aabb55' },
  })
    .webp()
    .toBuffer()
  const files = {}
  for (const [name, bytes] of Object.entries({
    'fixture.jpg': jpeg,
    'fixture.png': png,
    'fixture.webp': webp,
    'fourth.png': png,
    'boundary.jpg': Buffer.concat([jpeg, Buffer.alloc(3145728 - jpeg.length)]),
    'oversize.jpg': Buffer.concat([jpeg, Buffer.alloc(3145729 - jpeg.length)]),
    'unsupported.txt': Buffer.from('Phase2D unsupported file'),
  })) {
    files[name] = path.join(folder, name)
    fs.writeFileSync(files[name], bytes)
    if (!name.endsWith('.txt'))
      assert((await sharp(bytes).metadata()).width > 0)
  }
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  const sessions = [],
    errors = []
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
    })
    await api(context.request, '/api/auth/sign-in', {
      email: emails[i],
      password,
    })
    assert.equal(
      (await api(context.request, '/api/auth/session')).seller.id,
      ids[i]
    )
    const page = await context.newPage()
    page.on('pageerror', () => errors.push('Browser runtime error'))
    await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
      route.abort()
    )
    sessions.push({ context, page })
  }
  const [seller, buyer, outsider] = sessions
  pass(
    'three independent real Auth cookie sessions and decodable local JPEG/PNG/WebP/boundary fixtures'
  )
  await seller.page.goto(base + '/home?section=create-listing', {
    waitUntil: 'domcontentloaded',
  })
  const form = seller.page.getByRole('form', {
    name: 'Create listing',
    exact: true,
  })
  await form.waitFor({ timeout: 60000 })
  await form.locator('[name=title]').fill(`Phase2D TEMP staging ${run}`)
  await form.locator('[name=price]').fill('45')
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
    .fill(
      'Disposable Phase2D staging acceptance fixture; removed after testing.'
    )
  await form.locator('input[type=file]').setInputFiles(files['fixture.jpg'])
  const published = seller.page.waitForResponse((response) =>
    /\/api\/listings\/[^/]+\/finalize$/.test(new URL(response.url()).pathname)
  )
  await form.getByRole('button', { name: 'Create', exact: true }).click()
  const publishedResponse = await published
  assert.equal(publishedResponse.status(), 200)
  const listing = await publishedResponse.json()
  listingIds.push(listing.id)
  assert(listing.publishedAt)
  await buyer.page.goto(`${base}/listings/${listing.id}`, {
    waitUntil: 'domcontentloaded',
  })
  await buyer.page
    .getByRole('button', { name: 'Contact Seller', exact: true })
    .click()
  await buyer.page.waitForURL(/conversation=/)
  const conversation = new URL(buyer.page.url()).searchParams.get(
    'conversation'
  )
  assert(conversation)
  conversationIds.push(conversation)
  await buyer.page
    .locator(`[data-message-history="${conversation}"]`)
    .waitFor({ timeout: 60000 })
  assert.equal(
    (await api(buyer.context.request, `${messages}/${conversation}`))
      .imageSendingEnabled,
    true
  )
  pass(
    'Seller normal UI published listing; Buyer real listing Contact Seller opened conversation'
  )
  const history = () =>
    api(buyer.context.request, `${messages}/${conversation}/messages`)
  await openChat(buyer.page, conversation)
  const textbox = buyer.page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  })
  await textbox.fill('Phase2D TEXT before image')
  await textbox.press('End')
  await textbox.press('Enter')
  await buyer.page
    .getByText('Phase2D TEXT before image', { exact: true })
    .waitFor()
  const one = await sendFiles(buyer.page, [files['fixture.jpg']])
  assert.equal(one.type, 'IMAGE')
  assert.equal(one.sequence, 2)
  assert.equal(one.images.length, 1)
  assert(
    one.images[0].previewUrl.startsWith(
      url + '/storage/v1/object/sign/chat-images/'
    )
  )
  assert(one.images[0].expiresAt)
  await readableImages(buyer.page)
  const four = await sendFiles(
    buyer.page,
    ['fixture.jpg', 'fixture.png', 'fixture.webp', 'fourth.png'].map(
      (name) => files[name]
    )
  )
  assert.equal(four.images.length, 4)
  assert.equal(four.sequence, 3)
  const row = buyer.page.locator(`[data-message-id="${four.id}"]`)
  await row.getByRole('button', { name: 'See all 4 photos' }).click()
  await row.getByRole('button', { name: 'View photo 4 of 4' }).waitFor()
  await readableImages(buyer.page)
  const renewalResponse = buyer.page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/messages/images/' + four.id
  )
  await row
    .locator('img')
    .first()
    .evaluate((image) => image.dispatchEvent(new Event('error')))
  assert.equal((await renewalResponse).status(), 200)
  assert.equal(
    await row.locator('[data-image-gallery]').getAttribute('data-expanded'),
    'true'
  )
  await readableImages(buyer.page)
  pass(
    'frontend image-load-error renewal uses authenticated endpoint and preserves expanded gallery state'
  )
  await buyer.page.keyboard.press('Escape')
  const snapshot = await history()
  assert.deepEqual(
    snapshot.messages.map((item) => item.sequence),
    [1, 2, 3]
  )
  assert.deepEqual(
    snapshot.messages.map((item) => item.type),
    ['TEXT', 'IMAGE', 'IMAGE']
  )
  pass(
    'browser File -> attachment UI -> prepare -> private upload -> verified receipts -> finalize -> one/four durable image rendering'
  )
  await buyer.page.reload()
  await buyer.page.locator(`[data-message-id="${four.id}"]`).waitFor()
  await readableImages(buyer.page)
  await openChat(seller.page, conversation, 'selling')
  await seller.page.locator(`[data-message-id="${four.id}"]`).waitFor()
  await readableImages(seller.page)
  assert.equal(await seller.page.locator('[data-message-id]').count(), 3)
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      (await api(seller.context.request, `${messages}/${conversation}`))
        .unreadCount === 0
    )
      break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(
    (await api(seller.context.request, `${messages}/${conversation}`))
      .unreadCount,
    0
  )
  const renewed = await api(
    seller.context.request,
    `/api/messages/images/${four.id}`
  )
  assert.equal(renewed.images.length, 4)
  const token = new URL(renewed.images[0].previewUrl).searchParams.get('token')
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString()
  )
  assert.equal(claims.exp - claims.iat, 300)
  await api(
    outsider.context.request,
    `/api/messages/images/${four.id}`,
    undefined,
    404
  )
  await api(
    outsider.context.request,
    `/api/messages/images/${conversation}/prepare`,
    { clientMessageId: crypto.randomUUID(), images: [] },
    404
  )
  pass(
    'reload and independent Seller durable reads; ordered union history/read watermark; five-minute renewal; Outsider signing/prepare denied'
  )
  // UI negative selections allocate no reservation/message.
  for (const [name, pattern] of [
    ['oversize.jpg', /3 MB/],
    ['unsupported.txt', /JPEG|PNG|WebP/],
  ]) {
    const panel = await attachments(buyer.page, [files[name]])
    await panel.getByRole('alert').filter({ hasText: pattern }).waitFor()
    await panel
      .getByRole('button', { name: 'Add attachment', exact: true })
      .click()
    await panel.waitFor({ state: 'detached' })
  }
  const five = await attachments(
    buyer.page,
    [
      'fixture.jpg',
      'fixture.png',
      'fixture.webp',
      'fourth.png',
      'boundary.jpg',
    ].map((name) => files[name])
  )
  await five.getByRole('alert').filter({ hasText: 'at most 4' }).waitFor()
  await five
    .getByRole('button', { name: 'Add attachment', exact: true })
    .click()
  await five.waitFor({ state: 'detached' })
  const boundary = await sendFiles(buyer.page, [files['boundary.jpg']])
  assert.equal(boundary.images[0].size, 3145728)
  await readableImages(buyer.page)
  pass(
    'real UI rejects oversize, unsupported and five files; decodable exactly-3-MiB JPEG sends'
  )
  // Lose a committed finalize response at browser transport, then retry existing manifest.
  let lostId
  await buyer.page.route('**/api/messages/images/*/finalize', async (route) => {
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    lostId = (await response.json()).id
    await route.abort()
    await buyer.page.unroute('**/api/messages/images/*/finalize')
  })
  const lostPanel = await attachments(buyer.page, [files['fixture.webp']])
  await lostPanel.getByRole('button', { name: 'Send', exact: true }).click()
  await lostPanel.getByRole('alert').waitFor()
  const committed = await history()
  assert.equal(
    committed.messages.filter((item) => item.id === lostId).length,
    1
  )
  await lostPanel.getByRole('button', { name: 'Send', exact: true }).click()
  await buyer.page.locator(`[data-message-id="${lostId}"]`).waitFor()
  await lostPanel.waitFor({ state: 'detached' })
  assert.equal(
    (await history()).messages.filter((item) => item.id === lostId).length,
    1
  )
  pass(
    'real browser lost-finalize-response retry reconciles one canonical message without duplicate upload/sequence'
  )
  // First of two uploads succeeds; second fails before reaching server. Cancel removes orphan.
  let uploadCount = 0,
    cancelledId
  await buyer.page.route('**/api/messages/image-upload/*/*', (route) => {
    uploadCount++
    return uploadCount === 2 ? route.abort() : route.continue()
  })
  buyer.page.on('response', async (response) => {
    if (
      /\/prepare$/.test(new URL(response.url()).pathname) &&
      response.status() === 200
    )
      cancelledId = (await response.json()).id
  })
  const partial = await attachments(buyer.page, [
    files['fixture.png'],
    files['fixture.webp'],
  ])
  await partial.getByRole('button', { name: 'Send', exact: true }).click()
  await partial.getByRole('alert').waitFor()
  const beforeCancel = (await history()).messages.length
  await partial
    .getByRole('button', { name: 'Add attachment', exact: true })
    .click()
  await partial.waitFor({ state: 'detached' })
  await buyer.page.unroute('**/api/messages/image-upload/*/*')
  assert.equal((await history()).messages.length, beforeCancel)
  const abandoned = (
    await query(
      `select state,manifest from public.image_message_submissions where id=${q(
        cancelledId
      )};`
    )
  ).rows[0]
  assert.equal(abandoned.state, 'abandoned')
  for (const slot of abandoned.manifest)
    assert(
      (await admin.storage.from('chat-images').info(slot.storage_path)).error
    )
  pass(
    'partial upload failure leaves no history; UI Cancel abandons and physically removes uploaded orphan'
  )
  await openChat(seller.page, conversation, 'selling')
  const incoming = await sendFiles(seller.page, [files['fixture.png']])
  assert.equal(incoming.senderId, ids[0])
  await openChat(buyer.page, conversation)
  await buyer.page
    .locator(`[data-message-id="${incoming.id}"][data-sent="false"]`)
    .waitFor()
  await readableImages(buyer.page)
  await buyer.page.setViewportSize({ width: 390, height: 844 })
  await openChat(buyer.page, conversation)
  await readableImages(buyer.page)
  assert.equal(
    await buyer.page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  )
  pass(
    'independent Seller IMAGE send renders incoming for Buyer; mobile 390px has no horizontal overflow'
  )
  assert.equal(errors.length, 0, 'No browser runtime errors')
  pass('no browser runtime errors')
  await require('./messages-phase2d-acceptance.cjs')({
    seller,
    buyer,
    outsider,
    emails,
    password,
    ids,
    files,
    primary: conversation,
    four,
    base,
    api,
    openChat,
    attachments,
    sendFiles,
    readableImages,
    query,
    admin,
    pass,
    folder,
    q,
    listingIds,
    conversationIds,
    extraListingPaths,
    transportFile,
    run,
  })
  assert.equal(errors.length, 0, 'No extended browser runtime errors')
}
async function cleanup() {
  if (browser) await browser.close()
  if (admin && ids.length) {
    const userSet = ids.map(q).join(',')
    const imageRows = {
      data: (
        await query(
          `select manifest from public.image_message_submissions where sender_id in (${userSet});`
        )
      ).rows,
    }
    const chatPaths = imageRows.data.flatMap((item) =>
      item.manifest.map((slot) => slot.storage_path)
    )
    const listingRows = {
      data: (
        await query(
          `select li.path from public.listing_images li join public.listings l on l.id=li.listing_id where l.seller_id in (${userSet});`
        )
      ).rows,
    }
    const listingPaths = [
      ...listingRows.data.map((item) => item.path),
      ...extraListingPaths,
    ]
    // Exact fixture ownership scope; administrative conversation cascade enqueues chat paths.
    await query(
      `begin; delete from public.conversations where buyer_id in (${userSet}) or seller_id in (${userSet}); delete from public.listings where seller_id in (${userSet}); commit;`
    )
    for (const [bucket, paths] of [
      ['chat-images', chatPaths],
      ['listing-images', listingPaths],
    ]) {
      if (!paths.length) continue
      const removed = await admin.storage.from(bucket).remove(paths)
      assert(!removed.error)
      for (const item of paths)
        assert((await admin.storage.from(bucket).info(item)).error)
    }
    if (chatPaths.length) {
      // Administrative fixture clock ages only these test paths; real guarded ack follows.
      await query(
        `update marketplace_private.chat_image_cleanup set queued_at=clock_timestamp()-interval '11 minutes' where storage_path in (${chatPaths
          .map(q)
          .join(',')});`
      )
      for (const item of chatPaths) {
        const ack = await admin.rpc('marketplace_ack_chat_image_cleanup', {
          p_storage_path: item,
        })
        assert(!ack.error)
        assert.equal(ack.data, true)
      }
    }
    for (const id of ids) {
      const removed = await admin.auth.admin.deleteUser(id)
      assert(!removed.error)
    }
    const counts = await query(
      `begin read only; select (select count(*) from auth.users where id in (${userSet})) as users, (select count(*) from public.listings where seller_id in (${userSet})) as listings, (select count(*) from public.conversations where buyer_id in (${userSet}) or seller_id in (${userSet})) as conversations, (select count(*) from public.messages where sender_id in (${userSet})) as messages, (select count(*) from public.image_message_submissions where sender_id in (${userSet})) as submissions, (select count(*) from storage.objects where bucket_id='chat-images' and name in (${
        chatPaths.length ? chatPaths.map(q).join(',') : 'NULL'
      })) as objects, (select count(*) from marketplace_private.chat_image_cleanup where storage_path in (${
        chatPaths.length ? chatPaths.map(q).join(',') : 'NULL'
      })) as queue; rollback;`
    )
    assert(Object.values(counts.rows[0]).every((count) => Number(count) === 0))
    pass(
      'all disposable Auth/listing/conversation/message/submission/Storage/queue fixtures removed',
      counts.rows[0]
    )
  }
  if (server) server.kill()
  // Resolved path is an exact run UUID inside the intentionally ignored artifact root.
  assert(
    folder.startsWith(
      path.resolve('tests/artifacts/messages-phase2d') + path.sep
    )
  )
  fs.rmSync(folder, { recursive: true, force: true })
  pass(
    'generated local images and temporary SQL removed; no credential/session files created'
  )
}
async function runE2E() {
  let failed
  try {
    await main()
  } catch (error) {
    failed = error
    console.error(error.message)
  } finally {
    try {
      await cleanup()
    } catch (error) {
      console.error('CLEANUP FAILED: ' + error.message)
      failed ||= error
      if (server) server.kill()
    }
    fs.writeFileSync(
      'tests/artifacts/messages-phase2d/result-' + run + '.json',
      JSON.stringify({ run, results, passed: !failed }, null, 2)
    )
  }
  if (failed) process.exitCode = 1
}
runE2E()
