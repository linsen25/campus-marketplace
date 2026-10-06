/* eslint-disable no-inner-declarations -- Each viewport owns isolated navigation fixtures. */
/* global document, window, MutationObserver, getComputedStyle */
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  const output = path.join(process.env.TEMP, 'profile-polish-checks')
  fs.mkdirSync(output, { recursive: true })
  try {
    for (const width of (process.env.PROFILE_WIDTHS || '390,430,1280,1536')
      .split(',')
      .map(Number)) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      let signedIn = true,
        failure = width === 1280,
        signouts = 0,
        categoryState = 'empty'
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route('**/api/**', (r) =>
        r.fulfill({
          status: 501,
          json: { error: 'Unexpected verification request' },
        })
      )
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      await page.route('**/api/auth/session', (r) =>
        r.fulfill({
          json: {
            seller: signedIn ? { id: 'fixture', displayName: 'Chris' } : null,
          },
        })
      )
      await page.route('**/api/auth/sign-out', async (r) => {
        assert.equal(r.request().method(), 'POST')
        assert.equal(r.request().headers()['x-marketplace-request'], '1')
        signouts++
        await new Promise((resolve) =>
          setTimeout(resolve, width === 430 ? 50 : 3000)
        )
        if (failure) {
          failure = false
          return r.fulfill({
            status: 503,
            json: { error: 'Unable to sign out. Please retry.' },
          })
        }
        signedIn = false
        return r.fulfill({ json: null })
      })
      await page.route('**/api/profile/account', (r) =>
        r.fulfill({
          json: {
            username: 'Chris',
            email: 'chris@uwo.ca',
            createdAt: '2026-10-01T12:00:00Z',
            emailVerified: true,
            nextUsernameChangeAt: null,
          },
        })
      )
      await page.route('**/api/profile/categories', (r) =>
        r.fulfill({
          status: categoryState === 'error' ? 503 : 200,
          json:
            categoryState === 'error'
              ? { error: 'Counts unavailable' }
              : [{ category: 'Electronics', count: 0 }],
        })
      )
      await page.route('**/api/auth/username-availability?*', (r) =>
        r.fulfill({ json: { available: r.request().url().includes('Chris2') } })
      )
      await page.route('**/api/profile/username', (r) =>
        r.fulfill({
          json: {
            username: 'Chris2',
            next_change_allowed_at: '2099-10-12T00:00:00Z',
          },
        })
      )
      await page.route('**/_next/data/**/index.json*', (r) =>
        r.fulfill({
          json: { pageProps: { listings: [], error: null }, __N_SSP: true },
        })
      )
      await page.goto('http://localhost:3100/home', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      async function destination(name) {
        if (width < 1024) {
          await page
            .getByRole('button', { name: 'Show more', exact: true })
            .click()
          await page
            .locator('[data-smooth-menu]')
            .getByRole('button', { name, exact: true })
            .click()
        } else {
          const rail = page.locator('[data-slot="sidebar-body"]')
          await rail.hover()
          await page.waitForTimeout(350)
          await rail.getByRole('link', { name, exact: true }).click()
          await page.mouse.move(width - 20, 450)
        }
        await page.waitForTimeout(400)
      }
      await destination('Settings')
      const content = page.getByRole('region', {
        name: 'Account & Security',
        exact: true,
      })
      await content.getByText('Chris', { exact: true }).waitFor()
      // Mutation is tested against a safe mocked authoritative response.
      await content
        .getByRole('button', { name: 'Change username', exact: true })
        .first()
        .click()
      const dialog = page.getByRole('dialog', { name: 'Change username' })
      await dialog.getByLabel('Username', { exact: true }).fill('Chris2')
      await dialog
        .getByText('Username available (case-insensitive)', { exact: true })
        .waitFor()
      assert(
        await dialog
          .getByRole('button', { name: 'Save', exact: true })
          .isEnabled()
      )
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await content.getByText('Chris2', { exact: true }).waitFor()
      await dialog.waitFor({ state: 'detached' })
      await content
        .getByRole('button', { name: 'Change username', exact: true })
        .first()
        .click()
      assert(
        await dialog
          .getByRole('button', { name: 'Save', exact: true })
          .isDisabled()
      )
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      if (width >= 1024) {
        await destination('Profile')
        await page
          .getByText('No active listings yet.', { exact: true })
          .waitFor()
        categoryState = 'error'
        await page.reload()
        await page.getByText('Counts unavailable', { exact: false }).waitFor()
        categoryState = 'empty'
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
        await page
          .getByText('No active listings yet.', { exact: true })
          .waitFor()
      }
      await destination('Settings')
      await page.evaluate(() => {
        window.logoutFrames = []
        const observe = () => {
          const el = document.querySelector('[data-logout-phase]')
          if (el)
            window.logoutFrames.push({
              phase: el.dataset.logoutPhase,
              steps: Array.from(el.querySelectorAll('[data-state]')).map(
                (n) => ({ text: n.textContent, state: n.dataset.state })
              ),
              welcome: !!document.getElementById('welcome-title'),
            })
        }
        new MutationObserver(observe).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
        })
        observe()
      })
      await page
        .getByRole('button', { name: 'Log out', exact: true })
        .filter({ visible: true })
        .click()
      const confirmation = page.getByRole('dialog', {
        name: 'Log out?',
        exact: true,
      })
      await confirmation.waitFor()
      await page.waitForTimeout(200)
      const geometry = await confirmation
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const rect = button.getBoundingClientRect()
            const css = getComputedStyle(button)
            return {
              width: rect.width,
              height: rect.height,
              y: rect.y,
              radius: css.borderRadius,
              boxSizing: css.boxSizing,
            }
          })
        )
      assert.deepEqual(
        geometry[0],
        geometry[1],
        'Confirmation action slots remain equal'
      )
      console.log(width, 'Logout outer geometry', geometry)
      await page.screenshot({
        path: path.join(output, `${width}-logout-confirmation.png`),
      })
      const signoutsBefore = signouts
      await confirmation
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await page.waitForTimeout(65)
      assert.equal(await confirmation.getAttribute('data-exiting'), 'true')
      await confirmation.waitFor({ state: 'detached' })
      assert.equal(signouts, signoutsBefore, 'Cancel leaves session intact')
      for (const dismiss of ['Escape', 'backdrop']) {
        await page
          .getByRole('button', { name: 'Log out', exact: true })
          .filter({ visible: true })
          .click()
        await confirmation.waitFor()
        await page.waitForTimeout(200)
        if (dismiss === 'Escape') await page.keyboard.press('Escape')
        else await page.mouse.click(4, 4)
        await page.waitForTimeout(65)
        assert.equal(await confirmation.getAttribute('data-exiting'), 'true')
        await confirmation.waitFor({ state: 'detached' })
        assert.equal(signouts, signoutsBefore)
      }
      await page
        .getByRole('button', { name: 'Log out', exact: true })
        .filter({ visible: true })
        .click()
      await confirmation.waitFor()
      await page.waitForTimeout(200)
      const confirmLogout = confirmation.getByRole('button', {
        name: 'Log out',
        exact: true,
      })
      await confirmLogout.focus()
      await page.keyboard.press('Enter')
      await confirmLogout.evaluate((el) => el.click())
      assert.equal(await confirmLogout.getAttribute('aria-busy'), 'true')
      await page.waitForTimeout(20)
      assert.equal(
        signouts,
        signoutsBefore + 1,
        'Only one real sign-out request'
      )
      const overlay = page.getByRole('dialog', { name: 'Signing out' })
      if (width !== 430) {
        assert.equal(await confirmLogout.getAttribute('data-state'), 'loading')
        assert(signedIn)
        assert.equal(
          await overlay.count(),
          0,
          'No reveal while sign-out is pending'
        )
        await page.screenshot({
          path: path.join(output, `${width}-logout-loading.png`),
        })
      }
      if (width === 1280) {
        await confirmation.getByRole('alert').waitFor()
        assert(signedIn)
        assert.equal(await overlay.count(), 0)
        await page.waitForFunction(
          () =>
            document.querySelector(
              'dialog[aria-labelledby="logout-confirm-title"] button[data-state]'
            )?.dataset.state === 'error'
        )
        await page.screenshot({
          path: path.join(output, `${width}-logout-error.png`),
        })
        await confirmLogout.click()
      }
      await page.waitForFunction(
        () =>
          document.querySelector(
            'dialog[aria-labelledby="logout-confirm-title"] button[data-state]'
          )?.dataset.state === 'success'
      )
      assert.equal(signedIn, false, 'Checkmark requires confirmed sign-out')
      assert.equal(await overlay.count(), 0)
      await page.waitForTimeout(340)
      await page.screenshot({
        path: path.join(output, `${width}-logout-checkmark.png`),
      })
      await confirmation.waitFor({ state: 'detached' })
      await overlay.waitFor()
      await overlay.getByRole('status', { name: /Goodbye, Chris/ }).waitFor()
      await page.waitForTimeout(550)
      await page.screenshot({ path: path.join(output, `${width}-goodbye.png`) })
      await overlay.waitFor({ state: 'detached', timeout: 45000 })
      assert.equal(new URL(page.url()).pathname, '/')
      assert.equal(signedIn, false)
      assert(await page.locator('#welcome-title').isVisible())
      const frames = await page.evaluate(() => window.logoutFrames)
      assert(
        frames.some((f) => f.steps.some((s) => s.text === 'Signing you out'))
      )
      assert(
        frames.some((f) =>
          f.steps.some((s) => s.text === 'Returning to Welcome')
        )
      )
      assert(
        frames.filter((f) => f.phase === 'cover').every((f) => !f.welcome),
        'Fast sign-out cannot expose Welcome before the panels close'
      )
      assert(
        frames.filter((f) => f.phase === 'reveal').every((f) => f.welcome),
        'No reveal before Welcome mounted'
      )
      await page.screenshot({ path: path.join(output, `${width}-welcome.png`) })
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: username save/canonical cooldown fixture, category empty/error retry, Goodbye progressive logout${
          width === 1280 ? ' with failure/retry' : ''
        }, session cleared and Welcome ready before reveal (${signouts} sign-outs)`
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
