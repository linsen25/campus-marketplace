// Shared-rule signup feedback regression; intercepted auth, no live email.
/* global document, getComputedStyle */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
const base = process.env.BASE_URL || 'http://localhost:3100'
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 768, 834, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const posts = []
      let verified = false
      await page.route('**/api/auth/**', (route) => {
        const action = new URL(route.request().url()).pathname.split('/').pop()
        if (route.request().method() === 'POST') posts.push(action)
        if (action === 'username-availability')
          return route.fulfill({ json: { available: true } })
        if (action === 'verify-signup') verified = true
        return route.fulfill({
          json:
            action === 'session'
              ? {
                  seller: verified
                    ? {
                        id: '11111111-1111-4111-8111-111111111111',
                        displayName: 'Test member',
                      }
                    : null,
                }
              : null,
        })
      })
      await page.goto(base + '/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      await auth.waitFor()
      assert.equal(
        await auth.locator('ul').count(),
        0,
        'Sign in has no requirements'
      )
      await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
      await auth
        .locator(
          'form[data-auth-mode="signup"] input[name="password"]:not(:disabled)'
        )
        .waitFor()
      await auth.getByLabel('Username', { exact: true }).fill('Test_member')
      const password = auth.getByLabel('Password', { exact: true })
      const field = password.locator('xpath=../..')
      const rules = field.locator('ul li')
      assert.equal(await rules.count(), 4)
      const labels = [
        '8+ characters',
        '1 uppercase letter',
        '1 number',
        '1 symbol',
      ]
      const cases = [
        ['', [false, false, false, false]],
        ['Abc', [false, true, false, false]],
        ['Abcdefgh', [true, true, false, false]],
        ['Abcdefg1', [true, true, true, false]],
        ['Abcdefg1!', [true, true, true, true]],
      ]
      await auth
        .getByLabel('Western email', { exact: true })
        .fill('password-test@uwo.ca')
      const agreement = auth.getByRole('checkbox')
      await agreement.focus()
      await page.keyboard.press('Space')
      assert(await agreement.isChecked())
      for (const [value, expected] of cases) {
        await password.fill(value)
        const states = await rules.evaluateAll((elements) =>
          elements.map((e) => ({
            text: e.textContent,
            color: getComputedStyle(e).color,
            iconColor: getComputedStyle(e.querySelector('svg')).color,
            visible: e.getBoundingClientRect().width > 0,
          }))
        )
        for (let i = 0; i < 4; i++) {
          assert(states[i].text.includes(labels[i]))
          assert(
            states[i].text.includes(
              expected[i] ? '(satisfied)' : '(required; not yet met)'
            )
          )
          assert.equal(
            states[i].color,
            expected[i] ? 'rgb(168, 216, 182)' : 'rgb(227, 160, 172)'
          )
          assert.equal(states[i].iconColor, states[i].color)
          assert(states[i].visible)
        }
        assert.equal(
          await field.locator('div[aria-hidden="true"] > span').count(),
          4,
          'Progress preserved'
        )
        if (expected.some((met) => !met)) {
          await auth.locator('form').evaluate((form) => form.requestSubmit())
          assert.equal(
            await field.getByRole('alert').innerText(),
            'Password must meet all requirements.'
          )
          assert.equal(await password.getAttribute('aria-invalid'), 'true')
          assert(
            (await password.getAttribute('aria-describedby')).includes(
              '-password-error'
            )
          )
          assert.equal(
            posts.length,
            0,
            'Invalid password sends no auth request'
          )
        }
      }
      assert.equal(
        await field.getByRole('alert').count(),
        0,
        'Correcting password clears feedback live'
      )
      assert.equal(await password.getAttribute('aria-invalid'), null)
      const columns = await field
        .locator('ul')
        .evaluate(
          (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length
        )
      assert.equal(columns, 2)
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth
        ),
        false
      )
      await auth.getByRole('button', { name: 'Show password' }).click()
      assert.equal(await password.getAttribute('type'), 'text')
      await auth.getByRole('button', { name: 'Hide password' }).click()
      assert.equal(await password.getAttribute('type'), 'password')
      await auth.getByRole('button', { name: 'Send code', exact: true }).click()
      await auth.getByRole('status').filter({ hasText: 'Verification code sent.' }).waitFor()
      assert.deepEqual(posts, ['signup-code'])
      await auth.getByLabel('Verification code', { exact: true }).fill('123456')
      await auth.locator('form').evaluate((form) => form.requestSubmit())
      await page.waitForURL('**/listings', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      assert.deepEqual(posts, ['signup-code', 'verify-signup'])
      console.log(
        `PASS ${width}: five live states, red/green text and icons, accessible inline error, two columns, progress/reveal preserved, invalid submission blocked and valid existing OTP flow allowed`
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
