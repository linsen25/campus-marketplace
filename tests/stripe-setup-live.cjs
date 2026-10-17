/* global document, innerWidth, location, window, getComputedStyle */
// Real Stripe test-mode + synthetic staging identities. Never creates Order money movement.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const h = require('../scripts/v2-maintenance-staging.cjs'),
  env = h.environment()
Object.assign(process.env, env)
const Stripe = require('stripe'),
  stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-09-30.endive',
    timeout: 10000,
    maxNetworkRetries: 1,
  })
const { createClient } = require('@supabase/supabase-js'),
  admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
const journal = path.resolve('tests/artifacts/stripe-live-scope.json'),
  resultFile = path.resolve(
    process.argv.includes('--presentation-only')
      ? 'tests/artifacts/stripe-presentation-live-results.json'
      : process.argv.includes('--submit-only')
      ? 'tests/artifacts/stripe-submit-live-results.json'
      : process.argv.includes('--connect-only')
      ? 'tests/artifacts/stripe-connect-live-results.json'
      : process.argv.includes('--element-only')
      ? 'tests/artifacts/stripe-element-live-results.json'
      : process.argv.includes('--buyer-only')
      ? 'tests/artifacts/stripe-buyer-live-results.json'
      : 'tests/artifacts/stripe-live-results.json'
  )
assert(
  !fs.existsSync(journal),
  'Recover the existing exact Stripe fixture journal before another run'
)
const scope = { run: crypto.randomUUID(), user: null },
  report = {
    checks: [],
    realProvider: true,
    realIframe: false,
    realHostedOnboarding: false,
    cleanup: false,
  }
const save = () => fs.writeFileSync(journal, JSON.stringify(scope))
const pass = (name) => {
  report.checks.push(name)
  console.log('PASS ' + name)
}
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  cache.set(full, m.exports)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name === '@/lib/server/marketplace-auth' ||
      name === '@/lib/supabase/server'
        ? new Proxy(
            {},
            {
              get: () => () => {
                throw Error(
                  'No request context in trusted provider qualification'
                )
              },
            }
          )
        : name.startsWith('@/')
        ? load(name.slice(2) + '.ts')
        : require(name),
    m,
    m.exports
  )
  return m.exports
}
const service = load('lib/server/stripe-setup.ts')
let latestHostedUrls
const accountLinksPrototype = Object.getPrototypeOf(stripe.v2.core.accountLinks)
const originalCreateLink = accountLinksPrototype.create
accountLinksPrototype.create = async function (params, ...args) {
  const onboarding = params.use_case.account_onboarding
  const back = new URL(onboarding.return_url),
    refresh = new URL(onboarding.refresh_url)
  assert.equal(back.origin, 'http://localhost:3000')
  assert.equal(refresh.origin, back.origin)
  assert.equal(back.pathname, '/home')
  assert.equal(back.searchParams.get('section'), 'settings')
  assert.equal(back.searchParams.get('focus'), 'payments-payouts')
  assert.equal(back.searchParams.get('stripe_return'), 'seller')
  assert.equal(refresh.pathname, '/api/stripe/connect-refresh')
  assert(/^[a-f0-9]{64}$/.test(refresh.searchParams.get('state')))
  latestHostedUrls = { back: back.href, refresh: refresh.href }
  report.hostedUrlConfiguration = {
    localOrigin: true,
    returnPath: back.pathname,
    settings: true,
    focus: 'payments-payouts',
    refreshPath: refresh.pathname,
  }
  if (process.argv.includes('--connect-only')) {
    const a = await stripe.v2.core.accounts.retrieve(params.account, {
      include: ['defaults'],
    })
    const legacy = await stripe.accounts.retrieve(params.account)
    const snapshot = {
      v2: a.defaults?.profile?.product_description ?? null,
      compatibility: legacy.business_profile?.product_description ?? null,
    }
    if (!report.initialProfileBeforeHostedLink)
      report.initialProfileBeforeHostedLink = snapshot
    report.profileBeforeHostedLink = snapshot
  }
  return originalCreateLink.call(this, params, ...args)
}
load('lib/server/stripe-environment.ts').stripeConfiguration()
const fingerprints = () =>
  h
    .query(
      'begin read only;' +
        [
          'public.listings',
          'public.orders',
          'public.order_requests',
          'public.transaction_events',
          'public.conversations',
          'public.messages',
          'public.listing_favorites',
          'auth.users',
          'public.profiles',
          'storage.objects',
          'marketplace_private.financial_capabilities',
        ]
          .map(
            (t) =>
              `select '${t}' name,count(*) n,md5(coalesce(string_agg(to_jsonb(x)::text,'' order by to_jsonb(x)::text),'')) hash from ${t} x`
          )
          .join(' union all ') +
        ';rollback;'
    )
    .sort((a, b) => a.name.localeCompare(b.name))
const before = fingerprints()
function bindings() {
  return scope.user
    ? h.query(
        `begin read only;select id,kind,owner_ref,setup_ref,instrument_ref from marketplace_private.stripe_bindings where user_id=${h.q(
          scope.user
        )} and platform=${h.q(
          env.STRIPE_PLATFORM_ACCOUNT_ID
        )} and mode='test';rollback;`
      )
    : []
}
async function cleanup() {
  if (!scope.user) return
  const rows = bindings(),
    owners = rows.map((r) => r.owner_ref).filter(Boolean)
  for (const b of rows) {
    if (!b.owner_ref) continue
    if (b.kind === 'payment_method') {
      const c = await stripe.customers.retrieve(b.owner_ref)
      if (!c.deleted) {
        assert(
          !c.livemode && c.metadata.uu_binding === b.id,
          'Exact synthetic Customer ownership'
        )
        await stripe.customers.del(c.id)
      }
    } else {
      const a = await stripe.v2.core.accounts.retrieve(b.owner_ref)
      assert(
        !a.livemode && a.metadata.uu_binding === b.id,
        'Exact synthetic Account ownership'
      )
      if (!a.closed)
        await stripe.v2.core.accounts.close(a.id, {
          applied_configurations: a.applied_configurations,
        })
    }
  }
  h.query(`begin;delete from marketplace_private.notification_deliveries where notification_identity in(select id from public.notifications where recipient_user_id=${h.q(
    scope.user
  )});
 create temporary table fixture_events as select domain_event_id id from public.notifications where recipient_user_id=${h.q(
   scope.user
 )};
 delete from public.notifications where recipient_user_id=${h.q(scope.user)};
 delete from marketplace_private.notification_events e where e.id in(select id from fixture_events) and not exists(select 1 from public.notifications where domain_event_id=e.id);
 delete from marketplace_private.stripe_webhook_inbox where platform=${h.q(
   env.STRIPE_PLATFORM_ACCOUNT_ID
 )} and mode='test' and owner_ref in(${
    owners.length ? owners.map(h.q).join(',') : 'null'
  });
 delete from marketplace_private.financial_capabilities where user_id=${h.q(
   scope.user
 )};
 delete from auth.users where id=${h.q(
   scope.user
 )} and raw_user_meta_data->>'qualificationId'=${h.q(scope.run)};commit;`)
  assert.equal(bindings().length, 0)
  const after = fingerprints()
  report.fingerprintDifferences = after
    .filter(
      (row, index) => JSON.stringify(row) !== JSON.stringify(before[index])
    )
    .map((row) => ({
      table: row.name,
      beforeCount: before.find((old) => old.name === row.name)?.n,
      afterCount: row.n,
    }))
  assert.deepEqual(after, before, 'Manual/canonical graph unchanged')
  report.cleanup = true
  fs.unlinkSync(journal)
  pass(
    'synthetic provider/application cleanup; canonical fingerprints unchanged'
  )
}
async function main() {
  report.phase = 'platform'
  const platform = await stripe.accounts.retrieve(null)
  assert.equal(platform.id, env.STRIPE_PLATFORM_ACCOUNT_ID)
  save()
  const password = crypto.randomBytes(32).toString('base64url') + 'Aa9!',
    email = 'stripe_live_' + scope.run + '@uwo.ca'
  scope.pendingEmail = email
  save()
  report.phase = 'synthetic-auth'
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: 'SL_' + scope.run.replaceAll('-', '').slice(0, 12),
      qualificationId: scope.run,
    },
  })
  assert(!created.error, 'Synthetic Auth creation')
  scope.user = created.data.user.id
  delete scope.pendingEmail
  save()
  const {
      chromium,
    } = require('./artifacts/browser-tools/node_modules/playwright-core'),
    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
  const context = await browser.newContext({ locale: 'en-CA' }),
    headers = { Origin: 'http://localhost:3000', 'X-Marketplace-Request': '1' }
  try {
    report.phase = 'local-login'
    const login = await context.request.post(
      'http://localhost:3000/api/auth/sign-in',
      { headers, data: { email, password } }
    )
    assert(login.ok(), 'Real localhost staging session')
    const request = async (action, data = {}) => {
      const r = await context.request.post(
        'http://localhost:3000/api/stripe/' + action,
        { headers, data }
      )
      report.lastRequest = { action, status: r.status() }
      assert.equal(
        r.status(),
        200,
        'Authenticated ' + action + ' status ' + r.status()
      )
      return r.json()
    }
    const readCapabilities = async () => {
      const r = await context.request.get(
        'http://localhost:3000/api/financial-capabilities'
      )
      assert.equal(r.status(), 200, 'Read authoritative persisted capabilities')
      return { capabilities: await r.json() }
    }
    if (!process.argv.includes('--connect-only')) {
      if (!process.argv.includes('--element-only')) {
        const first = await request('card-setup'),
          again = await request('card-setup')
        assert.equal(first.clientSecret, again.clientSecret)
        pass('real authenticated Customer/SetupIntent reuse')
        let b = bindings().find((r) => r.kind === 'payment_method')
        assert(b?.owner_ref && b.setup_ref)
        const succeeded = await stripe.setupIntents.confirm(b.setup_ref, {
          payment_method: 'pm_card_visa',
        })
        assert(!succeeded.livemode && succeeded.status === 'succeeded')
        const ready = await request('reconcile', { kind: 'payment_method' })
        assert.equal(ready.setupStatus, 'succeeded')
        assert.equal(ready.capabilities.paymentMethod.status, 'set')
        assert.equal(ready.capabilities.paymentMethod.last4, '4242')
        pass('real test-card setup and authoritative safe capability')
        const oldMethod = bindings().find(
          (r) => r.kind === 'payment_method'
        ).instrument_ref
        await request('card-setup')
        b = bindings().find((r) => r.kind === 'payment_method')
        let failed = false
        try {
          await stripe.setupIntents.confirm(b.setup_ref, {
            payment_method: 'pm_card_chargeDeclined',
          })
        } catch (e) {
          assert.equal(e.type, 'StripeCardError')
          failed = true
        }
        assert(failed, 'Test card must fail')
        const afterFail = await request('reconcile', { kind: 'payment_method' })
        assert.equal(afterFail.capabilities.paymentMethod.status, 'set')
        assert.equal(
          bindings().find((r) => r.kind === 'payment_method').instrument_ref,
          oldMethod
        )
        pass('real failed replacement preserves existing card')
        const replacement = await stripe.setupIntents.confirm(b.setup_ref, {
          payment_method: 'pm_card_mastercard',
        })
        assert.equal(replacement.status, 'succeeded')
        await request('reconcile', { kind: 'payment_method' })
        assert.notEqual(
          bindings().find((r) => r.kind === 'payment_method').instrument_ref,
          oldMethod
        )
        pass('real successful replacement promotes one active card')
      }

      report.phase = 'real-payment-element'
      report.phase = 'settings-page'
      const page = await context.newPage()
      let pausePreparation = false,
        releasePreparation,
        preparationStarted
      await page.route(
        'http://localhost:3000/api/stripe/card-setup',
        async (route) => {
          if (pausePreparation) {
            pausePreparation = false
            await new Promise((resolve) => {
              releasePreparation = resolve
              preparationStarted?.()
            })
          }
          await route.continue()
        }
      )
      const measurePayment = (dialog) =>
        dialog.evaluate((element) => {
          const body = element.querySelector('[data-payment-body]'),
            footer = body.nextElementSibling
          const r = element.getBoundingClientRect(),
            f = footer.getBoundingClientRect()
          return {
            x: r.x,
            width: r.width,
            height: r.height,
            footerY: f.y,
            footerBottom: f.bottom,
            bodyWidth: body.clientWidth,
            bodyHeight: body.clientHeight,
            bodyScrollHeight: body.scrollHeight,
            bodyScrollWidth: body.scrollWidth,
            gutter: getComputedStyle(body).scrollbarGutter,
            bodyOverflow: getComputedStyle(body).overflowY,
            outerOverflow: getComputedStyle(element).overflowY,
            rootOverflow: getComputedStyle(document.documentElement).overflowY,
            bodyLocked: getComputedStyle(document.body).overflowY,
            bodyRightPadding: getComputedStyle(body).paddingRight,
            rightContentInset:
              body.getBoundingClientRect().right -
              body
                .querySelector('#stripe-payment-element-host')
                .getBoundingClientRect().right,
            scrollOwners: Array.from(element.querySelectorAll('*')).filter(
              (n) =>
                ['auto', 'scroll'].includes(getComputedStyle(n).overflowY) &&
                n.scrollHeight > n.clientHeight
            ).length,
            skeletons: body.querySelectorAll('[data-slot=skeleton]').length,
          }
        })
      report.presentation = []
      const activeStripe = new Set()
      const requestKey = (request) => request.url() + ':' + request.postData()
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/stripe/'))
          activeStripe.add(requestKey(request))
      })
      const finished = (request) => activeStripe.delete(requestKey(request))
      page.on('requestfinished', finished)
      page.on('requestfailed', finished)
      const settleStripe = async () => {
        const deadline = Date.now() + 60000
        while (activeStripe.size && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 25))
        assert.equal(
          activeStripe.size,
          0,
          'Existing setup/reconcile requests settled'
        )
      }
      report.browserApi = []
      page.on('response', (response) => {
        activeStripe.delete(requestKey(response.request()))
        const url = new URL(response.url())
        if (
          url.origin === 'http://localhost:3000' &&
          url.pathname.startsWith('/api/stripe/')
        )
          report.browserApi.push({
            path: url.pathname,
            status: response.status(),
          })
      })
      let productionRequests = 0
      await page.route(/yzvchumzyonegujucyqs[.]supabase[.]co/, (r) => {
        productionRequests++
        return r.abort()
      })
      await page.goto('http://localhost:3000/home?section=settings', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      const change = page.getByRole('button', {
        name: /^(Change|Set up) payment method$/,
      })
      report.phase = 'settings-payment-action'
      await change.waitFor({ timeout: 60000 })
      const initialChangeMode = !process.argv.includes('--element-only')
      const initialTitle = initialChangeMode
        ? 'Change payment method'
        : 'Set up payment method'
      const initialSave = initialChangeMode
        ? 'Save changes'
        : 'Save payment method'
      const widths = process.argv.includes('--submit-only')
        ? [1536]
        : [390, 430, 820, 1280, 1536]
      for (const width of widths) {
        // Navigation invalidates the old document's request lifecycle. Its
        // cancelled requests must not hold the new document's test readiness.
        activeStripe.clear()
        await page.setViewportSize({ width, height: width < 640 ? 640 : 900 })
        // Start each responsive mode with the actual hydrated Home shell.
        // Realtime connections make networkidle an inappropriate readiness gate.
        await page.reload({ waitUntil: 'domcontentloaded' })
        await change.waitFor({ timeout: 60000 })
        await settleStripe()
        const setupResponse = page.waitForResponse(
          (r) => new URL(r.url()).pathname === '/api/stripe/card-setup'
        )
        const started = new Promise((resolve) => {
          preparationStarted = resolve
        })
        pausePreparation = true
        await change.click()
        await started
        const pendingDialog = page.getByRole('dialog', {
          name: initialTitle,
          exact: true,
        })
        await pendingDialog
          .getByRole('status')
          .filter({ hasText: 'Preparing secure payment setup' })
          .waitFor()
        const loading = await measurePayment(pendingDialog)
        await page.screenshot({
          path: path.resolve(
            'tests/artifacts/stripe-real-loading-' + width + '.png'
          ),
        })
        const lockedScrollY = await page.evaluate(() => window.scrollY)
        assert(
          loading.skeletons >= 10,
          'Full form skeleton includes card header, fields, two-column row, country and legal area'
        )
        releasePreparation()
        const setupStatus = (await setupResponse).status()
        if (setupStatus === 409) {
          await settleStripe()
          await page
            .getByRole('button', { name: 'Retry setup', exact: true })
            .click()
          pass(
            'existing Retry setup recovers initialization lease conflict ' +
              width
          )
        } else assert.equal(setupStatus, 200)
        report.phase = 'open-card-dialog-' + width
        const dialog = page.getByRole('dialog', {
          name: initialTitle,
          exact: true,
        })
        await dialog.waitFor()
        report.phase = 'stripe-fields-' + width
        const frame = dialog.frameLocator('iframe').first()
        await frame
          .getByLabel('Card number', { exact: true })
          .waitFor({ timeout: 60000 })
        await dialog
          .locator('#stripe-payment-element-host[aria-busy="false"]')
          .waitFor({ timeout: 60000 })
        const geometry = await dialog.evaluate((e) => {
          const r = e.getBoundingClientRect(),
            host = e.querySelector('#stripe-payment-element-host'),
            f = host?.querySelector('iframe')
          return {
            x: r.x,
            right: r.right,
            viewport: innerWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
            iframeWidth: f?.getBoundingClientRect().width,
            hostWidth: host?.getBoundingClientRect().width,
            iframeLeft: f?.getBoundingClientRect().left,
            iframeRight: f?.getBoundingClientRect().right,
          }
        })
        report.geometry = geometry
        const ready = await measurePayment(dialog)
        assert.equal(
          ready.height,
          loading.height,
          'Dialog height stable from loading to real Element ' + width
        )
        assert.equal(ready.width, loading.width, 'Dialog width stable ' + width)
        assert.equal(
          ready.bodyWidth,
          loading.bodyWidth,
          'Scrollbar gutter preserves content width ' + width
        )
        assert(
          Math.abs(ready.bodyScrollHeight - loading.bodyScrollHeight) <= 8,
          'Loading reserves full real Card form scroll footprint ' + width
        )
        assert(
          Math.abs(ready.footerY - loading.footerY) < 1,
          'Footer stays anchored ' + width
        )
        assert(
          ready.gutter.includes('stable') &&
            ready.bodyOverflow === 'auto' &&
            ready.outerOverflow === 'hidden',
          'UU body owns the sole internal scrollbar'
        )
        assert.equal(ready.bodyRightPadding, '24px')
        assert(
          ready.rightContentInset >= 24,
          'Controls separated from native scrollbar'
        )
        assert.equal(
          ready.scrollOwners,
          ready.bodyScrollHeight > ready.bodyHeight ? 1 : 0,
          'Only the Payment body scrolls vertically'
        )
        assert.equal(ready.rootOverflow, 'hidden')
        assert.equal(ready.bodyLocked, 'hidden')
        assert(
          ready.bodyScrollWidth <= ready.bodyWidth,
          'No inner horizontal scrollbar ' + width
        )
        assert.equal(
          await frame
            .getByText(
              /Secure, fast checkout with Link|Save my information for faster checkout|\bLink\b/
            )
            .filter({ visible: true })
            .count(),
          0,
          'No visible Link UI'
        )
        const visibleLinkFields = await frame
          .locator('input[name*="link" i]')
          .evaluateAll(
            (nodes) =>
              nodes.filter((e) => e.getBoundingClientRect().height > 0).length
          )
        assert.equal(visibleLinkFields, 0, 'No visible Link signup fields')
        assert.equal(
          await frame
            .getByText('Country', { exact: true })
            .filter({ visible: true })
            .count(),
          0,
          'Stripe Country is absent'
        )
        const country = dialog.getByRole('button', {
          name: 'Country or region',
          exact: true,
        })
        await country.focus()
        await page.keyboard.press('ArrowDown')
        const selectedCountry = dialog.getByRole('button', {
          name: 'Canada',
          exact: true,
        })
        await selectedCountry.waitFor()
        assert.equal(
          await dialog.locator('[data-sort-option]').count(),
          249,
          'International ISO billing countries retained'
        )
        const menu = dialog.getByRole('region', {
          name: 'Country or region options',
          exact: true,
        })
        const menuRect = await menu.boundingBox()
        assert(
          menuRect.x >= 0 && menuRect.x + menuRect.width <= width,
          'Country menu fits viewport'
        )
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'detached' })
        assert(await dialog.isVisible())
        await country.click()
        await selectedCountry.waitFor()
        await selectedCountry.click()
        await menu.waitFor({ state: 'detached' })
        report.presentation.push({ width, loading, ready, linkAbsent: true })
        if (ready.bodyScrollHeight > ready.bodyHeight) {
          await dialog.locator('[data-payment-body]').hover()
          await page.mouse.wheel(0, 250)
          await page.waitForFunction(
            () => document.querySelector('[data-payment-body]').scrollTop > 0
          )
          assert.equal(
            await page.evaluate(() => window.scrollY),
            lockedScrollY,
            'Background does not move during body scroll'
          )
          await dialog
            .locator('[data-payment-body]')
            .evaluate((e) => (e.scrollTop = 0))
        }
        await page.screenshot({
          path: path.resolve(
            'tests/artifacts/stripe-real-card-' + width + '.png'
          ),
        })
        assert(
          geometry.x >= -1 && geometry.right <= width + 1 && !geometry.overflow,
          'Real Stripe dialog fits ' + width
        )
        assert(
          geometry.iframeWidth > 0 &&
            geometry.iframeLeft >= geometry.x &&
            geometry.iframeRight <= geometry.right,
          'Real iframe not clipped ' + width
        )
        pass('real iframe responsive geometry ' + width)
        if (width !== 1536) {
          if (width === 430) await page.keyboard.press('Escape')
          else
            await dialog
              .getByRole('button', { name: 'Cancel', exact: true })
              .click()
          await dialog.waitFor({ state: 'detached' })
          assert(
            await change.evaluate((e) => e === document.activeElement),
            'Focus returns after close'
          )
          assert.notEqual(
            await page.evaluate(
              () => getComputedStyle(document.documentElement).overflowY
            ),
            'hidden',
            'Document unlocks after close'
          )
          continue
        }
        report.frameFields = await frame.locator('input').evaluateAll((nodes) =>
          nodes.map((e) => ({
            name: e.name,
            label: e.getAttribute('aria-label'),
            placeholder: e.getAttribute('placeholder'),
          }))
        )
        await frame
          .getByLabel('Card number', { exact: true })
          .fill('4242424242424242')
        await frame.getByLabel('Expiration date', { exact: true }).fill('1234')
        await frame.getByLabel('Security code', { exact: true }).fill('123')
        const postal = frame.getByLabel('Postal code', { exact: true })
        if (await postal.count()) await postal.fill('N6A1A1')
        await dialog
          .getByRole('button', { name: initialSave, exact: true })
          .click()
        const checkStatus = dialog.getByRole('button', {
          name: 'Check status',
          exact: true,
        })
        await Promise.race([
          dialog.waitFor({ state: 'hidden', timeout: 60000 }),
          checkStatus.waitFor({ state: 'visible', timeout: 60000 }),
        ])
        if (await checkStatus.isVisible()) {
          await settleStripe()
          await checkStatus.click()
          pass('existing Check status recovery used after browser confirmation')
        }
        await dialog.waitFor({ state: 'hidden', timeout: 60000 })
      }
      report.realIframe = true
      report.widths = widths
      // The real UI already reconciled before closing. Verify via a read-only
      // capability fetch instead of starting a competing reconciliation lease.
      const afterBrowser = await readCapabilities()
      assert.equal(afterBrowser.capabilities.paymentMethod.last4, '4242')
      const savedBinding = bindings().find(
        (row) => row.kind === 'payment_method'
      )
      const savedMethod = await stripe.paymentMethods.retrieve(
        savedBinding.instrument_ref
      )
      assert.equal(savedMethod.billing_details.address.country, 'CA')
      report.savedBillingCountry = 'CA'
      report.savedBillingCountries = ['CA']
      pass('real first setup mode saved and persisted')
      for (const width of widths) {
        activeStripe.clear()
        await page.setViewportSize({ width, height: width < 640 ? 640 : 900 })
        await page.reload({ waitUntil: 'domcontentloaded' })
        const changeExisting = page.getByRole('button', {
          name: 'Change payment method',
          exact: true,
        })
        await changeExisting.waitFor({ timeout: 60000 })
        await settleStripe()
        const started = new Promise((resolve) => {
          preparationStarted = resolve
        })
        pausePreparation = true
        await changeExisting.click()
        await started
        const d = page.getByRole('dialog', {
          name: 'Change payment method',
          exact: true,
        })
        await d
          .getByRole('status')
          .filter({ hasText: 'Preparing secure payment setup' })
          .waitFor()
        assert(
          await d
            .getByRole('button', { name: 'Save changes', exact: true })
            .isDisabled()
        )
        const loading = await measurePayment(d)
        releasePreparation()
        const retry = d.getByRole('button', {
          name: 'Retry setup',
          exact: true,
        })
        await Promise.race([
          d
            .locator('#stripe-payment-element-host[aria-busy="false"]')
            .waitFor({ timeout: 60000 }),
          retry.waitFor({ state: 'visible', timeout: 60000 }),
        ])
        if (await retry.isVisible()) {
          await settleStripe()
          await retry.click()
        }
        await d
          .locator('#stripe-payment-element-host[aria-busy="false"]')
          .waitFor({ timeout: 60000 })
        const ready = await measurePayment(d)
        assert.equal(loading.width, ready.width)
        assert.equal(loading.bodyWidth, ready.bodyWidth)
        assert.equal(loading.footerY, ready.footerY)
        assert.equal(ready.bodyRightPadding, '24px')
        assert(ready.rightContentInset >= 24)
        assert.equal(
          ready.scrollOwners,
          ready.bodyScrollHeight > ready.bodyHeight ? 1 : 0
        )
        assert(ready.bodyScrollWidth <= ready.bodyWidth)
        await d.getByRole('button', { name: 'Cancel', exact: true }).click()
        await d.waitFor({ state: 'detached' })
        pass('real persisted Change mode and stable gutter ' + width)
      }
      // Replace only this isolated synthetic buyer's card using real Stripe.js.
      // Exercise country selection and confirmSetup, not a server-side shortcut.
      for (const [code, label, postalCode] of [
        ['US', 'United States', '10001'],
        ['CN', 'China', '100000'],
      ]) {
        report.phase = 'real-billing-country-' + code
        await settleStripe()
        const prepared = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/stripe/card-setup'
        )
        await change.click()
        const response = await prepared
        if (response.status() === 409) {
          await settleStripe()
          await page
            .getByRole('button', { name: 'Retry setup', exact: true })
            .click()
        } else assert.equal(response.status(), 200)
        const dialog = page.getByRole('dialog', {
          name: 'Change payment method',
          exact: true,
        })
        await dialog
          .locator('#stripe-payment-element-host[aria-busy="false"]')
          .waitFor({ timeout: 60000 })
        await dialog
          .getByRole('button', { name: 'Country or region', exact: true })
          .click()
        await dialog.getByRole('button', { name: label, exact: true }).click()
        await dialog
          .getByRole('region', {
            name: 'Country or region options',
            exact: true,
          })
          .waitFor({ state: 'detached' })
        const frame = dialog.frameLocator('iframe').first()
        const oldInstrument = bindings().find(
          (row) => row.kind === 'payment_method'
        ).instrument_ref
        if (code === 'US') {
          await frame
            .getByLabel('Card number', { exact: true })
            .fill('4000000000000002')
          await frame
            .getByLabel('Expiration date', { exact: true })
            .fill('1234')
          await frame.getByLabel('Security code', { exact: true }).fill('123')
          const zip = frame.getByLabel(/^(Postal code|ZIP code)$/)
          if (await zip.count()) await zip.fill(postalCode)
          await dialog
            .getByRole('button', { name: 'Save changes', exact: true })
            .click()
          await dialog.getByRole('alert').waitFor({ timeout: 60000 })
          const failedSetup = await stripe.setupIntents.retrieve(
            bindings().find((row) => row.kind === 'payment_method').setup_ref
          )
          assert.equal(failedSetup.status, 'requires_payment_method')
          assert.equal(failedSetup.last_setup_error?.code, 'card_declined')
          report.replacementDeclineCode = failedSetup.last_setup_error.code
          const current = await readCapabilities()
          assert.equal(current.capabilities.paymentMethod.status, 'set')
          assert.equal(current.capabilities.paymentMethod.last4, '4242')
          assert.equal(
            bindings().find((row) => row.kind === 'payment_method')
              .instrument_ref,
            oldInstrument
          )
          const customer = await stripe.customers.retrieve(
            bindings().find((row) => row.kind === 'payment_method').owner_ref
          )
          assert.equal(
            customer.invoice_settings.default_payment_method,
            oldInstrument
          )
          report.failedReplacementPreserved = true
          pass(
            'real browser-declined replacement preserves previous active/default card'
          )
          // Reopen the same Change surface for the next independent attempt.
          // Stripe may replace its fields after a decline; do not reuse a stale
          // field lifecycle or let a Check status click race the next submission.
          await dialog
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
          await dialog.waitFor({ state: 'detached' })
          await settleStripe()
          const preparedAgain = page.waitForResponse(
            (r) => new URL(r.url()).pathname === '/api/stripe/card-setup'
          )
          await change.click()
          const setupAgain = await preparedAgain
          if (setupAgain.status() === 409) {
            await settleStripe()
            await dialog
              .getByRole('button', { name: 'Retry setup', exact: true })
              .click()
          } else assert.equal(setupAgain.status(), 200)
          await dialog
            .locator('#stripe-payment-element-host[aria-busy="false"]')
            .waitFor({ timeout: 60000 })
          await dialog
            .getByRole('button', { name: 'Country or region', exact: true })
            .click()
          await dialog.getByRole('button', { name: label, exact: true }).click()
          await dialog
            .getByRole('region', {
              name: 'Country or region options',
              exact: true,
            })
            .waitFor({ state: 'detached' })
        }
        await frame
          .getByLabel('Card number', { exact: true })
          .fill(code === 'US' ? '5555555555554444' : '4242424242424242')
        await frame.getByLabel('Expiration date', { exact: true }).fill('1234')
        await frame.getByLabel('Security code', { exact: true }).fill('123')
        const postal = frame.getByLabel(/^(Postal code|ZIP code)$/)
        if (await postal.count()) await postal.fill(postalCode)
        await dialog
          .getByRole('button', { name: 'Save changes', exact: true })
          .click()
        const check = dialog.getByRole('button', {
          name: 'Check status',
          exact: true,
        })
        await Promise.race([
          dialog.waitFor({ state: 'hidden', timeout: 60000 }),
          check.waitFor({ state: 'visible', timeout: 60000 }),
        ])
        if (await check.isVisible()) {
          await settleStripe()
          await check.click()
        }
        await dialog.waitFor({ state: 'hidden', timeout: 60000 })
        assert.equal(
          (await readCapabilities()).capabilities.paymentMethod.status,
          'set'
        )
        const binding = bindings().find((row) => row.kind === 'payment_method')
        const method = await stripe.paymentMethods.retrieve(
          binding.instrument_ref
        )
        assert.equal(method.billing_details.address.country, code)
        assert.notEqual(binding.instrument_ref, oldInstrument)
        assert.equal(method.card.last4, code === 'US' ? '4444' : '4242')
        const customer = await stripe.customers.retrieve(binding.owner_ref)
        assert.equal(
          customer.invoice_settings.default_payment_method,
          binding.instrument_ref
        )
        report.savedBillingCountries.push(code)
        pass('real browser save and PaymentMethod billing country ' + code)
      }
      assert.equal(productionRequests, 0)
      pass(
        'real Payment Element/Stripe.js save, measured responsive widths and no production requests'
      )
      const initialReconcile = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/stripe/reconcile' &&
          response.request().postDataJSON()?.kind === 'payment_method',
        { timeout: 60000 }
      )
      await page.reload({ waitUntil: 'domcontentloaded' })
      assert.equal(
        (await initialReconcile).status(),
        200,
        'Initial authoritative card reconciliation'
      )
      await change.waitFor({ timeout: 60000 })
      assert((await page.getByText(/4242/).count()) > 0)
      assert(
        await page
          .getByRole('button', { name: 'Change payment method', exact: true })
          .isVisible()
      )
      await page
        .getByRole('button', { name: 'Change payment method', exact: true })
        .click()
      const persistedDialog = page.getByRole('dialog', {
        name: 'Change payment method',
        exact: true,
      })
      await persistedDialog
        .getByRole('button', { name: 'Save changes', exact: true })
        .waitFor()
      await persistedDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await persistedDialog.waitFor({ state: 'detached' })
      pass('real refresh persistence retains Change title and Save changes')
      if (process.argv.includes('--presentation-only')) {
        await context.close()
        return
      }
      // Scoped signed replay of real Stripe events; never claim another user's queue.
      report.phase = 'real-provider-event-replay'
      const own = bindings().find((r) => r.kind === 'payment_method'),
        events = await stripe.events.list({
          type: 'setup_intent.succeeded',
          created: { gte: Math.floor(Date.now() / 1000) - 1200 },
          limit: 100,
        })
      const owned = events.data.filter(
        (e) => e.data.object.customer === own.owner_ref
      )
      assert(owned.length >= 1, 'Real provider setup events available')
      for (const event of [owned[0], owned[0], owned[owned.length - 1]]) {
        const payload = JSON.stringify(event),
          signature = Stripe.webhooks.generateTestHeaderString({
            payload,
            secret: env.STRIPE_WEBHOOK_SECRET,
          })
        const delivered = await context.request.post(
          'http://localhost:3000/api/stripe/webhook',
          {
            headers: {
              'Content-Type': 'application/json',
              'Stripe-Signature': signature,
            },
            data: payload,
          }
        )
        assert.equal(delivered.status(), 200)
      }
      const inbox = h.query(
        `select count(*) n from marketplace_private.stripe_webhook_inbox where platform=${h.q(
          env.STRIPE_PLATFORM_ACCOUNT_ID
        )} and event_id in(${[owned[0].id, owned[owned.length - 1].id]
          .map(h.q)
          .join(',')})`
      )
      assert.equal(
        inbox[0].n,
        new Set([owned[0].id, owned[owned.length - 1].id]).size
      )
      const outside = h.query(
        `select count(*) n from marketplace_private.stripe_webhook_inbox where platform=${h.q(
          env.STRIPE_PLATFORM_ACCOUNT_ID
        )} and status<>'done' and owner_ref is distinct from ${h.q(
          own.owner_ref
        )}`
      )[0].n
      if (outside === 0) {
        const count = h.query(
          `select count(*) n from marketplace_private.stripe_webhook_inbox where platform=${h.q(
            env.STRIPE_PLATFORM_ACCOUNT_ID
          )} and status<>'done' and owner_ref=${h.q(own.owner_ref)}`
        )[0].n
        await service.drainStripeEvents(count)
        const final = await request('reconcile', { kind: 'payment_method' })
        assert.equal(final.capabilities.paymentMethod.last4, '4242')
        pass(
          owned.length > 1
            ? 'real-provider signed duplicate/out-of-order replay, durable inbox and worker convergence'
            : 'real-provider signed duplicate replay, durable inbox and worker convergence (one provider event)'
        )
      } else {
        report.liveWorkerDeferred =
          'Unrelated inbox rows present; left untouched'
        pass(
          'real-provider signed duplicate replay durable deduplication; unrelated queue untouched'
        )
      }
    }
    if (
      !process.argv.includes('--buyer-only') &&
      !process.argv.includes('--element-only')
    ) {
      // Direct trusted call surfaces a bounded provider code if Connect configuration is rejected.
      report.phase = 'connect-create'
      const payout = await service.startPayoutSetup(scope.user)
      assert.equal(
        report.initialProfileBeforeHostedLink.v2,
        'I sell new and pre-owned personal items through the Usual & Unusual marketplace.'
      )
      assert.equal(
        report.initialProfileBeforeHostedLink.compatibility,
        report.initialProfileBeforeHostedLink.v2
      )
      pass(
        'real Accounts v2 recipient profile prefilled before hosted link; subsequent reads are Stripe-redacted'
      )
      assert.equal(new URL(payout.url).hostname, 'connect.stripe.com')
      const account = bindings().find(
        (r) => r.kind === 'payout_account'
      ).owner_ref
      await service.startPayoutSetup(scope.user)
      assert.equal(
        bindings().find((r) => r.kind === 'payout_account').owner_ref,
        account
      )
      const incomplete = await request('reconcile', { kind: 'payout_account' })
      assert.notEqual(incomplete.capabilities.payoutAccount.status, 'ready')
      pass('real Connect Account reuse, hosted link and incomplete readiness')
      const refresh = await context.request.get(latestHostedUrls.refresh, {
        maxRedirects: 0,
      })
      assert.equal(refresh.status(), 303)
      assert.equal(
        new URL(refresh.headers().location).hostname,
        'connect.stripe.com'
      )
      assert.equal(
        bindings().find((row) => row.kind === 'payout_account').owner_ref,
        account
      )
      pass(
        'real hosted refresh endpoint reuses the same Account and returns trusted Stripe redirect'
      )
      const back = await context.newPage()
      const reconciledReturn = back.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/stripe/reconcile' &&
          response.request().postDataJSON()?.kind === 'payout_account'
      )
      await back.goto(latestHostedUrls.back, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      const returned = await reconciledReturn
      assert.equal(returned.status(), 200)
      assert.equal(
        (await returned.json()).capabilities.payoutAccount.status,
        'needs_attention'
      )
      await back.waitForFunction(
        () => !new URL(window.location.href).searchParams.has('stripe_return')
      )
      assert.equal(new URL(back.url()).searchParams.get('section'), 'settings')
      report.hostedReturn = {
        landedInSettings: true,
        focus: 'payments-payouts',
        liveReconciledStatus: 'needs_attention',
        hostedKycCompleted: false,
      }
      pass(
        'real UU hosted return route triggers live reconciliation; return does not imply Ready'
      )
      report.phase = 'connect-hosted-onboarding'
      const hosted = await context.newPage()
      await hosted.goto(payout.url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      await hosted.getByRole('button').first().waitFor({ timeout: 60000 })
      report.hostedSurface = await hosted.evaluate(() => ({
        host: location.hostname,
        headings: [...document.querySelectorAll('h1,h2')].map(
          (e) => e.textContent
        ),
        buttons: [...document.querySelectorAll('button')].map(
          (e) => e.textContent
        ),
        fields: [...document.querySelectorAll('input')].map((e) => ({
          type: e.type,
          name: e.name,
          placeholder: e.placeholder,
        })),
      }))
      report.realHostedSurface = true
      pass('real Stripe-hosted onboarding surface loaded')
      if (process.argv.includes('--hosted-interactive')) {
        await require('./artifacts/stripe-hosted-driver.cjs')(hosted)
        const reconciled = await request('reconcile', {
          kind: 'payout_account',
        })
        report.finalSellerStatus = reconciled.capabilities.payoutAccount.status
        assert.equal(
          report.finalSellerStatus,
          'ready',
          'Authoritative Seller readiness after hosted onboarding'
        )
        report.realHostedOnboarding = true
        pass('real hosted onboarding completed and authoritative Seller Ready')
      }
    }
    await context.close()
  } finally {
    if (!report.realIframe && report.phase?.startsWith('stripe-fields')) {
      report.browserDiagnostics = []
      for (const p of context.pages()) {
        const info = {
          path: new URL(p.url()).pathname,
          frames: await p.locator('iframe').evaluateAll((nodes) =>
            nodes.map((e) => ({
              title: e.title,
              host: (() => {
                try {
                  return new URL(e.src).hostname
                } catch {
                  return ''
                }
              })(),
            }))
          ),
          dialogs: await p.getByRole('dialog').evaluateAll((nodes) =>
            nodes.map((e) => ({
              label: e.getAttribute('aria-label'),
              buttons: [...e.querySelectorAll('button')].map((b) =>
                b.textContent.slice(0, 80)
              ),
            }))
          ),
        }
        report.browserDiagnostics.push(info)
      }
    } else if (!report.realIframe) {
      report.browserDiagnostics = []
      for (const p of context.pages())
        report.browserDiagnostics.push({
          path: new URL(p.url()).pathname,
          financialSections: await p
            .locator('[data-financial-capability]')
            .count(),
          dialogs: await p.getByRole('dialog').count(),
          buttonNames: await p.getByRole('button').allTextContents(),
        })
    }
    await browser.close()
  }
}
main()
  .catch((e) => {
    let detail = String(e.message || '').slice(0, 3000)
    for (const value of Object.values(env))
      if (typeof value === 'string' && value.length > 12)
        detail = detail.split(value).join('[redacted]')
    detail = detail
      .replace(/https?:\/\/[^\s]+/g, '[url]')
      .replace(/\b(?:acct|cus|seti|pm|req)_[A-Za-z0-9_]+\b/g, '[provider-id]')
    report.error = {
      type: e.type || e.name,
      code: e.code || null,
      status: e.statusCode || null,
      param: e.param || null,
      detail,
    }
    console.log('FAIL ' + JSON.stringify(report.error))
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await cleanup()
    } catch (e) {
      report.cleanupError = {
        type: e.type || e.name,
        code: e.code || null,
        status: e.statusCode || null,
      }
      console.log('Cleanup incomplete; exact fixture journal retained')
      process.exitCode = 1
    }
    fs.writeFileSync(resultFile, JSON.stringify(report, null, 2))
  })
