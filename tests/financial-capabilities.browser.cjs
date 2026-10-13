// Read-only capability requests in independent real staging cookie sessions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000'
;(async () => {
  const html = await (await fetch(base + '/home')).text()
  let stagingUrl = false,
    stagingEnvironment = false
  const secrets = ['.env.local', '.env.staging.local']
    .flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((l) =>
          /^(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|.*PASSWORD)=/.test(
            l
          )
        )
        .map((l) =>
          l
            .slice(l.indexOf('=') + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '')
        )
    )
    .filter((v) => v.length > 12)
  for (const match of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const raw = await (await fetch(new URL(match[1], base))).text()
    for (const secret of secrets)
      assert(!raw.includes(secret), 'Privileged secret in browser bundle')
    const code = raw
      .replaceAll(String.fromCharCode(92, 34), '"')
      .replaceAll(String.fromCharCode(92, 110), '\n')
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs\.supabase\.co"/.test(
        code
      )
    )
    stagingUrl ||=
      /(?:const|let|var)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo\.supabase\.co"/.test(
        code
      )
    stagingEnvironment ||=
      /(?:const|let|var)\s+designation\s*=\s*"staging"/.test(code)
  }
  assert(
    stagingUrl && stagingEnvironment,
    'Staging running app required before authentication'
  )
  assert.equal((await fetch(base + '/api/financial-capabilities')).status, 401)
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  try {
    for (const identity of ['buyer-a', 'buyer-b', 'seller-a', 'seller-b']) {
      const context = await browser.newContext({ serviceWorkers: 'block' })
      const account = credentials[identity]
      assert.equal(
        (
          await context.request.post(base + '/api/auth/sign-in', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: { email: account.email, password: account.password },
          })
        ).status(),
        200
      )
      for (const suffix of [
        '',
        '?userId=22222222-2222-4222-8222-222222222222',
      ]) {
        const r = await context.request.get(
          base + '/api/financial-capabilities' + suffix
        )
        assert.equal(r.status(), 200)
        assert(r.headers()['cache-control'].includes('no-store'))
        assert.deepEqual(await r.json(), {
          paymentMethod: { status: 'unset', brand: null, last4: null },
          payoutAccount: { status: 'unset', institution: null, last4: null },
        })
      }
      console.log(
        'PASS ' +
          identity +
          ': real cookie session, Unset/Unset, safe exact fields, no-store, query cannot impersonate'
      )
      await context.close()
    }
    console.log(
      'PASS staging runtime and browser privileged-secret scan; no Order/Request/financial mutations'
    )
  } finally {
    await browser.close()
  }
})().catch(() => {
  console.error(
    'Financial staging browser verification failed (credentials not logged)'
  )
  process.exitCode = 1
})
