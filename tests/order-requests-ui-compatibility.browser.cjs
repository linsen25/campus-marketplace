// Real staging identities; read-only responsive/selection checks, no email or Request writes.
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
    const loggedOut = await browser.newContext({ serviceWorkers: 'block' })
    await loggedOut.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== base || url.pathname.startsWith('/api/auth/'))
        return route.abort()
      return route.continue()
    })
    const login = await loggedOut.newPage()
    await login.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await login.getByRole('button', { name: 'Log in', exact: true }).click()
    for (const width of [1280, 1536, 390, 430]) {
      stage = 'login selection ' + width
      await login.setViewportSize({ width, height: 900 })
      for (const type of ['email', 'password']) {
        const field = login.locator('input[type=' + type + ']').first()
        await field.fill('selection-test-value')
        await field.scrollIntoViewIfNeeded()
        const r = await field.boundingBox()
        await login.mouse.move(r.x + 12, r.y + r.height / 2)
        await login.mouse.down()
        await login.mouse.move(r.x + 130, r.y + r.height / 2, { steps: 12 })
        await login.mouse.up()
        assert(
          await field.evaluate(
            (e) => window.getSelection().toString().length > 0
          )
        )
        assert.equal(
          await field.evaluate(
            (e) => getComputedStyle(e, '::selection').backgroundColor
          ),
          'rgb(0, 122, 255)'
        )
        await login.keyboard.type('X')
        assert((await field.inputValue()).length < 20)
        await login.keyboard.press('Control+a')
        await login.keyboard.type('replacement')
        assert.equal(await field.inputValue(), 'replacement')
        assert.equal(await field.getAttribute('type'), type)
      }
      console.log(
        JSON.stringify({
          width,
          loginMouseAndKeyboardSelection: true,
          passwordMasked: true,
          authEmails: 0,
        })
      )
    }
    await loggedOut.close()
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
      for (const width of [1280, 1536, 390, 430]) {
        stage = 'responsive ' + role + ' ' + width
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(500)
        if (
          !(await page
            .getByRole('button', { name: 'Add to conversation', exact: true })
            .count())
        ) {
          await entry.click()
          await page
            .getByRole('button', { name: 'Add to conversation', exact: true })
            .waitFor()
        }
        const add = page.getByRole('button', {
          name: 'Add to conversation',
          exact: true,
        })
        stage += ' buttons'
        const send = page
          .getByRole('button', { name: 'Send', exact: true })
          .first()
        const a = await add.boundingBox(),
          b = await send.boundingBox()
        assert.equal(a.height, b.height)
        assert.equal(a.width, a.height)
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        const field = page.getByRole('textbox', {
          name: 'Message',
          exact: true,
        })
        await field.fill('selection-test-value')
        const rect = await field.boundingBox()
        await page.mouse.move(rect.x + 12, rect.y + rect.height / 2)
        await page.mouse.down()
        await page.mouse.move(rect.x + 130, rect.y + rect.height / 2, {
          steps: 12,
        })
        await page.mouse.up()
        assert(await field.evaluate((e) => e.selectionEnd > e.selectionStart))
        await page.keyboard.press('Control+a')
        assert.equal(
          await field.evaluate((e) => e.selectionEnd - e.selectionStart),
          20
        )
        await page.keyboard.type('local replacement')
        assert.equal(await field.inputValue(), 'local replacement')
        await field.fill('')
        await page
          .getByRole('button', { name: 'View listing', exact: true })
          .click()
        stage += ' listing'
        const dialog = page.getByRole('dialog', {
          name: 'Listing preview',
          exact: true,
        })
        await dialog.waitFor()
        const cancel = dialog.getByRole('button', {
          name: 'Cancel',
          exact: true,
        })
        assert.equal(
          await cancel
            .locator('span')
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          'rgb(118, 46, 60)'
        )
        await cancel.click()
        await dialog.waitFor({ state: 'hidden' })
        await add.click()
        assert.equal(
          await page
            .getByRole('button', { name: 'Send Order Request', exact: true })
            .count(),
          role === 'selling' && conversation.listing.availability === 'available' ? 1 : 0
        )
        if (role === 'selling' && conversation.listing.availability === 'available') {
          await page
            .getByRole('button', { name: 'Send Order Request', exact: true })
            .click()
          stage += ' editor'
          const editor = page.getByRole('dialog', {
            name: 'Order Request editor',
            exact: true,
          })
          await editor.waitFor()
          const location = editor.getByLabel('Pickup location', { exact: true })
          await location.fill('selection-test-location')
          const r = await location.boundingBox()
          await page.mouse.move(r.x + 12, r.y + r.height / 2)
          await page.mouse.down()
          await page.mouse.move(r.x + 130, r.y + r.height / 2, { steps: 12 })
          await page.mouse.up()
          assert(
            await location.evaluate((e) => e.selectionEnd > e.selectionStart)
          )
          await page.keyboard.press('Control+a')
          await page.keyboard.type('local replacement')
          assert.equal(await location.inputValue(), 'local replacement')
          await editor
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
          await editor.waitFor({ state: 'hidden' })
        } else await add.click()
        await page.screenshot({
          path:
            'tests/artifacts/order-requests-phase1/ui-' +
            role +
            '-' +
            width +
            '.png',
        })
        console.log(
          JSON.stringify({
            role,
            width,
            equalActionHeight: a.height,
            redCancel: true,
            nativeSelection: true,
            overflow: false,
          })
        )
      }
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
