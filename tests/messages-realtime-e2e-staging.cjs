// Opt-in STAGING-only frontend acceptance. Secrets/sessions live only in memory.
/* global document, Navigator, window */
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
const base = 'http://localhost:3108'
const run = crypto.randomUUID().slice(0, 8)
const folder = path.resolve('tests/artifacts/messages-phase3c', run)
fs.mkdirSync(folder, { recursive: true })
const ids = [],
  listingIds = [],
  conversationIds = [],
  results = []
const extraListingPaths = []
let admin,
  browser,
  server,
  queryIndex = 0,
  serverReady = false
const password = crypto.randomBytes(24).toString('hex') + 'Aa9!'
const headers = { 'X-Marketplace-Request': '1', Origin: base }
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
  await page
    .locator('[data-message-history] [role=status]')
    .waitFor({ state: 'detached' })
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
  finished.catch(() => {})
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
  assert(migration.rows.some((row) => row.version === '202610080001'))
  const recoverAt = process.argv.indexOf('--recover-run')
  if (recoverAt >= 0) {
    const previous = process.argv[recoverAt + 1]
    assert(/^[a-f0-9]{8}$/.test(previous), 'Exact run ID required')
    ids.push(
      ...(
        await query(
          `select id from auth.users where email like ${q(
            'phase3c-' + previous + '-%@uwo.ca'
          )};`
        )
      ).rows.map((row) => row.id)
    )
    pass('recover exact interrupted staging fixture run', {
      run: previous,
      users: ids.length,
    })
    return
  }

  // Credentials only enter the child environment; launch code is memory-only.
  const launch = async () => {
    const expected = 'https://pcaqxezdfxofysghssyo.supabase.co'
    if (
      process.env.APP_ENV !== 'staging' ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== expected
    )
      throw Error('Wrong staging environment')
    const original = global.fetch
    global.fetch = (input, options) => {
      const target = new URL(
        typeof input === 'string' ? input : input.url || String(input)
      )
      if (target.origin !== expected) throw Error('Non-staging network blocked')
      return original(input, options)
    }
    process.env.NODE_ENV = 'development'
    process.env.NEXT_TELEMETRY_DISABLED = '1'
    const config = await require('next/dist/server/config').default(
      require('next/constants').PHASE_DEVELOPMENT_SERVER,
      process.cwd()
    )
    config.distDir = process.env.PHASE3C_DIST
    const app = require('next')({
      dev: true,
      dir: process.cwd(),
      conf: config,
      hostname: 'localhost',
      port: 3108,
    })
    await app.prepare()
    require('node:http')
      .createServer(app.getRequestHandler())
      .listen(3108, () => console.log('PHASE3C_READY'))
  }
  server = spawn(
    process.execPath,
    [
      '-e',
      `(${launch.toString()})().catch(()=>{console.error('STAGING_SERVER_FAILED');process.exit(1)})`,
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        APP_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
        SUPABASE_SERVICE_ROLE_KEY: privateKey,
        PHASE3C_DIST: path
          .relative(
            process.cwd(),
            path.resolve('tests/artifacts/messages-phase3c/server-next')
          )
          .replaceAll('\\', '/'),
      },
    }
  )
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('PHASE3C_READY')) serverReady = true
  })
  server.stderr.on('data', () => {})
  for (let n = 0; n < 60 && !serverReady; n++)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  assert(serverReady, 'Isolated staging server ready')
  const names = ['Seller', 'Buyer', 'Outsider']
  const emails = []
  for (const name of names) {
    const email = `phase3c-${run}-${name.toLowerCase()}@uwo.ca`
    emails.push(email)
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `P3C_${name[0]}_${run}` },
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
    'unsupported.txt': Buffer.from('Phase3C unsupported file'),
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
    await page.addInitScript(() => {
      delete Navigator.prototype.serviceWorker
      const Native = window.WebSocket,
        topics = new Map()
      const stats = (window.__phase3c = {
        joins: 0,
        leaves: 0,
        active: 0,
        maximum: 0,
        rejected: 0,
        blocked: false,
      })
      const update = () => {
        stats.active = [...topics.values()].reduce((n, set) => n + set.size, 0)
        stats.maximum = Math.max(stats.maximum, stats.active)
      }
      window.WebSocket = class extends Native {
        constructor(address, protocols) {
          super(address, protocols)
          if (
            stats.blocked &&
            String(address).includes(
              'pcaqxezdfxofysghssyo.supabase.co/realtime/'
            )
          )
            this.addEventListener('open', () => this.close())
          this.addEventListener('message', (event) => {
            if (typeof event.data !== 'string') return
            const raw = JSON.parse(event.data),
              frame = Array.isArray(raw)
                ? { event: raw[3], payload: raw[4] }
                : raw
            if (
              frame.event === 'phx_reply' &&
              frame.payload?.status === 'error'
            )
              stats.rejected++
          })
          this.addEventListener('close', () => {
            topics.delete(this)
            update()
          })
        }
        send(value) {
          const raw = JSON.parse(value)
          const frame = Array.isArray(raw)
            ? { topic: raw[2], event: raw[3] }
            : raw
          if (window.__phase3cOverrideTopic && frame.event === 'phx_join') {
            if (Array.isArray(raw)) raw[2] = window.__phase3cOverrideTopic
            else raw.topic = window.__phase3cOverrideTopic
            frame.topic = window.__phase3cOverrideTopic
          }
          if (
            frame.event === 'phx_join' &&
            frame.topic.startsWith('realtime:marketplace:messages:')
          ) {
            if (!topics.has(this)) topics.set(this, new Set())
            topics.get(this).add(frame.topic)
            stats.joins++
            update()
          }
          if (frame.event === 'phx_leave') {
            topics.get(this)?.delete(frame.topic)
            stats.leaves++
            update()
          }
          super.send(
            window.__phase3cOverrideTopic ? JSON.stringify(raw) : value
          )
        }
      }
      window.__phase3cDisconnect = () => {
        for (const socket of topics.keys()) socket.close()
      }
    })
    await page.route('**/*', (route) =>
      [base, url].includes(new URL(route.request().url()).origin)
        ? route.continue()
        : route.abort()
    )
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
  await form.locator('[name=title]').fill(`Phase3C TEMP staging ${run}`)
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
      'Disposable Phase3C staging acceptance fixture; removed after testing.'
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
  await require(process.argv.includes('--release-candidate')
    ? './messages-realtime-browser-release-candidate.cjs'
    : './messages-realtime-browser-acceptance.cjs')({
    seller,
    buyer,
    outsider,
    conversation,
    files,
    base,
    api,
    openChat,
    attachments,
    sendFiles,
    readableImages,
    query,
    q,
    listingIds,
    conversationIds,
    pass,
    extraListingPaths,
  })
  assert.equal(errors.length, 0, 'No browser runtime errors')
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
      path.resolve('tests/artifacts/messages-phase3c') + path.sep
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
      'tests/artifacts/messages-phase3c/result-' + run + '.json',
      JSON.stringify({ run, results, passed: !failed }, null, 2)
    )
  }
  if (failed) process.exitCode = 1
}
runE2E()
