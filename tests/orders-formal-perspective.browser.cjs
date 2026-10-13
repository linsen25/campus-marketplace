// Existing staging identities; no signup, data mutation or perspective simulation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
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
})().catch(() => {
  console.error(
    'Formal perspective browser check failed; credentials and response details withheld.'
  )
  process.exitCode = 1
})
