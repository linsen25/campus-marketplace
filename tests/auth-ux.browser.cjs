/* global document, getComputedStyle, window, fetch, Event */
// Actual local UI + intercepted transport, no Supabase/email/account mutations.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://127.0.0.1:3112'
const pendingUnavailable =
  'Unable to resume this signup. Use Create for a new signup, or return to the browser where it was started.'
const folder = path.resolve('tests/artifacts/auth-ux')
fs.mkdirSync(folder, { recursive: true })
async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      })
      const accounts = new Map()
      const requestPaths = []
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname.startsWith('/api/auth/'))
          requestPaths.push({ origin: url.origin, path: url.pathname })
      })
      let current = null,
        number = 0,
        sends = 0,
        verifies = 0,
        loginPosts = 0,
        firstFailure = true,
        bootstrapReady = false,
        bootstrapFailures = 0,
        navigations = 0
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      // Accelerate only the existing one-second resend countdown, not request/button timing.
      await page.addInitScript(() => {
        const native = window.setTimeout.bind(window)
        window.setTimeout = (fn, delay, ...args) =>
          native(fn, delay === 1000 ? 5 : delay, ...args)
      })
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === base
          ? route.continue()
          : route.abort()
      )
      await page.route('**/api/auth/**', async (route) => {
        const action = new URL(route.request().url()).pathname.split('/').pop()
        const body =
          route.request().method() === 'POST'
            ? route.request().postDataJSON()
            : {}
        const reply = (json, status = 200) =>
          route.fulfill({
            status,
            json,
            headers: { 'Cache-Control': 'private, no-store' },
          })
        if (action === 'session') {
          if (current) {
            if (bootstrapFailures > 0) {
              bootstrapFailures--
              return reply({ error: 'Controlled bootstrap failure' }, 503)
            }
            await new Promise((r) => setTimeout(r, 250))
            bootstrapReady = true
          }
          return reply({
            seller: current
              ? {
                  id: '11111111-1111-4111-8111-111111111111',
                  displayName: current.username,
                }
              : null,
          })
        }
        if (action === 'username-availability')
          return reply({
            available: ![...accounts.values()].some(
              (a) =>
                a.username.toLowerCase() ===
                new URL(route.request().url()).searchParams
                  .get('username')
                  ?.toLowerCase()
            ),
          })
        if (action === 'sign-in') {
          loginPosts++
          if (firstFailure) {
            firstFailure = false
            return reply({ error: 'Controlled login failure' }, 400)
          }
          current = {
            username:
              body.email === 'second@uwo.ca'
                ? 'Second_member'
                : 'Existing_member',
          }
          bootstrapReady = false
          return reply(null)
        }
        if (action === 'signup-code') {
          sends++
          await new Promise((r) => setTimeout(r, 250))
          if (accounts.has(body.email))
            return reply(
              { error: 'Duplicate fixture registration rejected' },
              409
            )
          accounts.set(body.email, {
            ...body,
            code: String(++number + 110000),
            confirmed: false,
          })
          return reply(null)
        }
        if (action === 'correct-signup-username') {
          const account = accounts.get(body.email)
          if (!account || account.confirmed)
            return reply({ error: pendingUnavailable }, 403)
          if (
            [...accounts.values()].some(
              (a) =>
                a !== account &&
                a.username.toLowerCase() === body.username.toLowerCase()
            )
          )
            return reply({ error: 'That username is already taken.' }, 409)
          account.username = body.username
          account.code = null
          return reply(null)
        }
        if (action === 'resend-signup') {
          const account = accounts.get(body.email)
          if (!account || account.confirmed)
            return reply({ error: pendingUnavailable }, 403)
          sends++
          account.code = String(++number + 110000)
          return reply(null)
        }
        if (action === 'verify-signup') {
          verifies++
          const account = accounts.get(body.email)
          if (!account || body.code !== account.code)
            return reply(
              {
                error:
                  'This code is incorrect or expired. Request another code.',
              },
              400
            )
          assert.equal(
            body.username.toLowerCase(),
            account.username.toLowerCase()
          )
          if (body.updateSignupPassword) account.password = body.password
          account.confirmed = true
          current = account
          bootstrapReady = false
          return reply(null)
        }
        if (action === 'sign-out') {
          current = null
          return reply(null)
        }
        if (action === 'reset-password') {
          current = { username: 'Recovered_member' }
          bootstrapReady = false
          return reply(null)
        }
        if (action === 'recover') return reply(null)
        throw Error('Unexpected mocked action')
      })
      await page.route('**/_next/data/**/listings.json*', (route) => {
        // Auth prefetch can happen before login; only a non-prefetch navigation must await bootstrap.
        if (
          current &&
          !route.request().headers()['purpose'] &&
          !route.request().headers()['x-middleware-prefetch']
        ) {
          assert(
            bootstrapReady,
            'Navigation follows the authenticated session read'
          )
          navigations++
        }
        return route.fulfill({
          json: {
            pageProps: {
              listings: [],
              values: {
                status: 'available',
                sort: 'newest',
                search: '',
                category: '',
                condition: '',
              },
              page: 1,
              hasNextPage: false,
              error: null,
            },
            __N_SSP: true,
          },
        })
      })
      const open = async () => {
        await page.goto(base, { waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: 'Log in', exact: true }).click()
        await page.locator('dialog[aria-labelledby="auth-title"]').waitFor()
      }
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      await open()
      await auth.locator('#login-email').fill('existing@uwo.ca')
      await auth.locator('#login-password').fill('Generated1!')
      await auth.getByRole('button', { name: 'Log in', exact: true }).click()
      await auth
        .getByRole('alert')
        .filter({ hasText: 'Controlled login failure' })
        .waitFor()
      await auth.getByRole('button', { name: 'Log in', exact: true }).click()
      await page.waitForURL('**/listings')
      await page
        .locator('[data-auth-success]')
        .waitFor({ state: 'detached', timeout: 40000 })
      assert.equal(loginPosts, 2)
      assert.equal(navigations, 1)
      assert.equal(
        await page
          .getByText('Controlled login failure', { exact: true })
          .count(),
        0
      )
      const session = await page.evaluate(async () =>
        (await fetch('/api/auth/session')).json()
      )
      assert(session.seller)
      await page.evaluate(async () => {
        await fetch('/api/auth/sign-out', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Marketplace-Request': '1',
          },
          body: '{}',
        })
        window.dispatchEvent(new Event('marketplace-session-ended'))
      })
      await open()
      if (width === 390) {
        bootstrapFailures = 1
        await auth.locator('#login-email').fill('second@uwo.ca')
        await auth.locator('#login-password').fill('Second2!')
        await auth.getByRole('button', { name: 'Log in', exact: true }).click()
        await page
          .getByText('You are signed in, but Market could not open.', {
            exact: true,
          })
          .waitFor()
        assert.equal(new URL(page.url()).pathname, '/')
        const beforeRetry = loginPosts
        await page
          .getByRole('button', {
            name: 'Try opening Market again',
            exact: true,
          })
          .click()
        await page.waitForURL('**/listings')
        await page
          .locator('[data-auth-success]')
          .waitFor({ state: 'detached', timeout: 40000 })
        assert.equal(
          loginPosts,
          beforeRetry,
          'Market retry never resubmits sign-in'
        )
        assert.equal(
          (
            await page.evaluate(async () =>
              (await fetch('/api/auth/session')).json()
            )
          ).seller.displayName,
          'Second_member'
        )
        await page.reload({ waitUntil: 'domcontentloaded' })
        assert(
          (
            await page.evaluate(async () =>
              (await fetch('/api/auth/session')).json()
            )
          ).seller
        )
        current = null
        await open()
      }
      await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
      await auth.locator('#signup-email:not(:disabled)').waitFor()
      await auth.locator('#signup-email').fill('first@uwo.ca')
      await auth.locator('#signup-username').fill('Signup_member')
      await auth.locator('#signup-password').fill('Original1!')
      await auth.getByRole('checkbox').check()
      await auth.getByText('Username is available.', { exact: false }).waitFor()
      const create = auth.locator('[data-auth-create]')
      const beforeCreate = requestPaths.length
      await create.dblclick()
      await auth.locator('[data-auth-create][data-state=success]').waitFor()
      assert.equal(sends, 1)
      assert.equal(
        requestPaths
          .slice(beforeCreate)
          .filter((r) => r.path === '/api/auth/signup-code').length,
        1
      )
      assert.equal(
        requestPaths
          .slice(beforeCreate)
          .filter((r) => r.path === '/api/auth/resend-signup').length,
        0
      )
      await page.waitForTimeout(2300)
      assert.equal(await create.getAttribute('data-state'), 'success')
      const surface = await create
        .locator('span')
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundColor)
      assert.equal(surface, 'rgb(37, 99, 235)')
      await page.screenshot({
        path: path.join(folder, `verification-${width}.png`),
      })
      const oldCode = accounts.get('first@uwo.ca').code
      await auth
        .getByRole('button', { name: 'Edit signup details', exact: true })
        .click()
      assert.equal(
        await auth.locator('#signup-email').inputValue(),
        'first@uwo.ca'
      )
      assert.equal(
        await auth.locator('#signup-username').inputValue(),
        'Signup_member'
      )
      assert.equal(
        await auth.locator('#signup-password').inputValue(),
        'Original1!'
      )
      assert.equal(await auth.locator('[name=code]').count(), 0)
      await auth.locator('#signup-password').fill('Changed2!')
      await auth.locator('[data-auth-create]').click()
      await auth.locator('[data-auth-create][data-state=success]').waitFor()
      assert.equal(accounts.size, 1)
      assert.equal(
        accounts.get('first@uwo.ca').password,
        'Original1!',
        'Resend does not secretly update credentials'
      )
      await auth.locator('[name=code]').fill(oldCode)
      await auth
        .getByRole('button', { name: 'Verify code', exact: true })
        .click()
      await auth
        .getByText('This code is incorrect or expired. Request another code.', {
          exact: true,
        })
        .waitFor()
      await auth
        .getByRole('button', { name: 'Edit signup details', exact: true })
        .click()
      await auth.locator('#signup-username').fill('Different_member')
      await auth.locator('[data-auth-create]').click()
      await auth.locator('[data-auth-create][data-state=success]').waitFor()
      assert.equal(accounts.size, 1)
      assert.equal(accounts.get('first@uwo.ca').username, 'Different_member')
      await auth.locator('[data-auth-create][data-state=success]').waitFor()
      await auth.locator('[name=code]').fill(accounts.get('first@uwo.ca').code)
      await auth
        .getByRole('button', { name: 'Verify code', exact: true })
        .click()
      await page.waitForURL('**/listings')
      await page
        .locator('[data-auth-success]')
        .waitFor({ state: 'detached', timeout: 40000 })
      assert.equal(accounts.get('first@uwo.ca').password, 'Changed2!')
      assert(accounts.get('first@uwo.ca').confirmed)
      assert(verifies >= 2)
      if (width === 390) {
        current = null
        await open()
        await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
        await auth.locator('#signup-email:not(:disabled)').waitFor()
        await auth.locator('#signup-email').fill('old-address@uwo.ca')
        await auth.locator('#signup-username').fill('Old_pending')
        await auth.locator('#signup-password').fill('Original1!')
        await auth.getByRole('checkbox').check()
        await auth
          .getByText('Username is available.', { exact: false })
          .waitFor()
        await auth.locator('[data-auth-create]').click()
        await auth.locator('[data-auth-create][data-state=success]').waitFor()
        const previous = accounts.get('old-address@uwo.ca').code
        await auth
          .getByRole('button', { name: 'Edit signup details', exact: true })
          .click()
        await auth.locator('#signup-email').fill('new-address@uwo.ca')
        await auth.locator('#signup-username').fill('New_pending')
        await auth
          .getByText('Username is available.', { exact: false })
          .waitFor()
        await auth.locator('[data-auth-create]').click()
        await auth.locator('[data-auth-create][data-state=success]').waitFor()
        // Pending account survives reload; credentials never persist in the form.
        await page.reload({ waitUntil: 'domcontentloaded' })
        await open()
        await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
        await auth.locator('#signup-email:not(:disabled)').waitFor()
        assert.equal(await auth.locator('#signup-password').inputValue(), '')
        await auth.locator('#signup-email').fill('new-address@uwo.ca')
        await auth.locator('#signup-username').fill('New_pending')
        await auth.locator('#signup-password').fill('Resumed3!')
        await auth.getByRole('checkbox').check()
        await auth
          .getByRole('button', { name: 'Resume verification', exact: true })
          .click()
        await auth.locator('[name=code]').waitFor()
        assert.equal(accounts.size, 3, 'Resume never creates another account')
        await auth.locator('[name=code]').fill(previous)
        await auth
          .getByRole('button', { name: 'Verify code', exact: true })
          .click()
        await auth
          .getByText(
            'This code is incorrect or expired. Request another code.',
            { exact: true }
          )
          .waitFor()
        const beforeResend = sends
        await auth
          .getByRole('button', { name: 'Resend code', exact: true })
          .dblclick()
        await auth.locator('[name=code]').waitFor()
        await page.waitForTimeout(300)
        assert.equal(sends, beforeResend + 1)
        assert.equal(await auth.locator('[name=code]').inputValue(), '')
        await auth
          .locator('[name=code]')
          .fill(accounts.get('new-address@uwo.ca').code)
        await auth
          .getByRole('button', { name: 'Verify code', exact: true })
          .click()
        await page.waitForURL('**/listings')
        await page
          .locator('[data-auth-success]')
          .waitFor({ state: 'detached', timeout: 40000 })
        assert(accounts.get('new-address@uwo.ca').confirmed)
        assert.equal(accounts.get('new-address@uwo.ca').password, 'Resumed3!')
        assert(
          !accounts.get('old-address@uwo.ca').confirmed,
          'No silent old-identity verification or deletion'
        )
        current = null
        await open()
        await auth
          .getByRole('button', { name: 'Forgot password?', exact: true })
          .click()
        await auth.locator('form[data-auth-mode=recovery]').waitFor()
        await auth.locator('[name=email]').fill('recovery@uwo.ca')
        await auth.locator('[name=password]').fill('Recovered4!')
        await auth
          .getByRole('button', { name: 'Send code', exact: true })
          .click()
        await auth
          .getByText(
            'If this account exists, a recovery code has been sent. Check your inbox.',
            { exact: true }
          )
          .waitFor()
        await auth.locator('[name=code]').fill('123456')
        await auth
          .getByRole('button', { name: 'Save password', exact: true })
          .click()
        await page.waitForURL('**/listings')
        assert.equal(
          (
            await page.evaluate(async () =>
              (await fetch('/api/auth/session')).json()
            )
          ).seller.displayName,
          'Recovered_member'
        )
        console.log(
          'PASS second account/bootstrap retry without re-login, refresh session, email-address challenge separation and duplicate Resend protection'
        )
      }
      assert.equal(errors.length, 0)
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1
        ),
        false
      )
      if (width === 390) {
        current = null
        await open()
        await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
        await auth.locator('#signup-email:not(:disabled)').waitFor()
        await auth.locator('#signup-email').fill('stale-draft@uwo.ca')
        await auth.locator('#signup-username').fill('StaleDraft')
        await auth.locator('#signup-password').fill('DraftPass1!')
        await auth.getByRole('checkbox').check()
        await auth
          .getByText('Username is available.', { exact: false })
          .waitFor()
        const beforeResume = sends
        await auth
          .getByRole('button', { name: 'Resume verification', exact: true })
          .click()
        await auth.getByText(pendingUnavailable, { exact: true }).waitFor()
        assert.equal(
          sends,
          beforeResume,
          'Fresh Resume cannot dispatch provider email'
        )
        assert.equal(await auth.locator('[name=code]').count(), 0)
        await auth.locator('[data-auth-create]').click()
        await auth.locator('[data-auth-create][data-state=success]').waitFor()
        await auth
          .getByRole('button', { name: 'Edit signup details', exact: true })
          .click()
        accounts.delete('stale-draft@uwo.ca') // Authoritative fixture gone, UI ref remains stale.
        const beforeStaleResume = sends
        await auth.locator('[data-auth-create]').click()
        await auth.getByText(pendingUnavailable, { exact: true }).waitFor()
        assert.equal(
          sends,
          beforeStaleResume,
          'Stale UI draft cannot dispatch provider resend'
        )
        await auth
          .getByText('Username is available.', { exact: false })
          .waitFor()
        const beforeFreshRetry = requestPaths.length
        await auth.locator('[data-auth-create]').dblclick()
        await auth.locator('[data-auth-create][data-state=success]').waitFor()
        assert.equal(
          requestPaths
            .slice(beforeFreshRetry)
            .filter((r) => r.path === '/api/auth/signup-code').length,
          1
        )
        assert.equal(
          requestPaths
            .slice(beforeFreshRetry)
            .filter((r) => r.path === '/api/auth/resend-signup').length,
          0
        )
        console.log(
          'PASS fresh/resume/stale-draft route counts and duplicate Create recovery'
        )
      }
      assert(
        requestPaths.every((r) => r.origin === base),
        'Auth never crosses to localhost:3000'
      )
      console.log(
        JSON.stringify({
          width,
          signInSessionBeforeNavigation: true,
          staleErrorCleared: true,
          createSuccessRetained: true,
          freshCodeAfterEdit: true,
          oldCodeRejected: true,
          passwordSavedAfterVerification: true,
          pendingUsernameCorrection: true,
          duplicateCreatePrevented: true,
          noHostedNetwork: true,
          expectedOrigin: base,
          crossOriginAuthRequests: 0,
        })
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
