// Existing confirmed B32 outsider only. Official one-time Auth link recovery;
// no new user, password reset, verification override, privileged browser token,
// business mutation, or secret artifact. Sessions exist only in memory.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { createClient } = require('@supabase/supabase-js')
const { createServerClient } = require('@supabase/ssr')
const {
  request,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
const values = Object.fromEntries(
  fs
    .readFileSync('.env.b32.test.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=')
      return [
        line.slice(0, i).trim(),
        line
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
const url = 'https://giqdwyiupslpfhstbtqf.supabase.co'
assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, url)
const expectedId = '920643b2-8e1c-49b4-897c-71c225e84693'
const email = 'b32-outsider-20261108@example.invalid'
const anonKey = values.NEXT_PUBLIC_SUPABASE_ANON_KEY
const options = { auth: { persistSession: false, autoRefreshToken: false } }
void (async () => {
  const admin = createClient(url, values.SUPABASE_SERVICE_ROLE_KEY, options)
  const user = await admin.auth.admin.getUserById(expectedId)
  if (
    user.error ||
    user.data.user?.email !== email ||
    !user.data.user.email_confirmed_at
  )
    throw new Error('Existing confirmed B32 outsider identity mismatch')
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error || link.data.user?.id !== expectedId)
    throw new Error('B32 outsider Auth recovery unavailable')
  const auth = createClient(url, anonKey, options)
  const verified = await auth.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: 'magiclink',
  })
  if (
    verified.error ||
    verified.data.user?.id !== expectedId ||
    !verified.data.session
  )
    throw new Error('Official outsider session verification failed')
  const cookies = []
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookies,
      setAll: (entries) => {
        for (const c of entries) {
          const old = cookies.findIndex((x) => x.name === c.name)
          if (old >= 0) cookies.splice(old, 1)
          cookies.push(c)
        }
      },
    },
  })
  const session = await ssr.auth.setSession(verified.data.session)
  if (session.error) throw new Error('B32 outsider SSR session failed')
  const client = await request.newContext({
    storageState: {
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      })),
      origins: [],
    },
  })
  const output = {
    project: 'giqdwyiupslpfhstbtqf',
    outsiderId: expectedId,
    recoveredExistingConfirmedAccount: true,
    tests: [],
  }
  try {
    const sessionRead = await (
      await client.get('http://localhost:3050/api/auth/session')
    ).json()
    assert.equal(sessionRead.seller?.id, expectedId)
    const ids = (
      process.env.B32_PRIVATE_ORDER_IDS ||
      [
        'e03c06c5-dcef-4229-afe9-0ea66e343060',
        'a294b358-7834-44dc-81f0-c70ec4598df2',
        '4b4de7fb-efe2-41c4-b092-8da111085043',
      ].join(',')
    )
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    for (const id of ids) {
      for (const suffix of [
        `/api/orders/${id}`,
        `/api/order-domain/${id}/fulfillment`,
        `/api/order-domain/${id}/interac-payment`,
        `/api/interac/orders/${id}`,
      ]) {
        const response = await client.get('http://localhost:3050' + suffix)
        const body = await response.json()
        if (suffix.startsWith('/api/interac/orders/')) {
          assert.equal(response.status(), 200)
          assert.equal(
            body.receivingEmail,
            null,
            'Outsider must receive no Interac email'
          )
          output.tests.push({
            path: suffix,
            http: response.status(),
            noPrivateData: true,
            nullableEmail: true,
          })
          continue
        }
        assert.ok(
          [401, 403, 404].includes(response.status()),
          `Expected denied: ${suffix} HTTP ${response.status()}, keys=${Object.keys(
            body
          ).join(',')}`
        )
        assert.deepEqual(Object.keys(body), ['error'])
        output.tests.push({
          path: suffix,
          http: response.status(),
          noPrivateData: true,
        })
      }
    }
  } finally {
    await client.dispose()
    await auth.auth.signOut({ scope: 'local' })
    await ssr.auth.signOut({ scope: 'local' })
  }
  fs.writeFileSync(
    'tests/artifacts/b32/browser-transaction-e2e/interac-outsider-http.json',
    JSON.stringify(output, null, 2)
  )
  console.log(JSON.stringify(output))
})().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
