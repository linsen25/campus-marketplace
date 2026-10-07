/* global Navigator, getComputedStyle, DataTransfer, File, document, innerWidth, DragEvent */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  const output = `${process.env.TEMP}/profile-avatar-qa`
  fs.mkdirSync(output, { recursive: true })
  const image = (name) => ({
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#664780"/><circle cx="50" cy="50" r="24" fill="white"/></svg>'
    ),
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
      await page.route(
        /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) => route.abort()
      )
      await page.route('**/api/**', (route) => {
        assert.equal(
          route.request().method(),
          'GET',
          'no avatar persistence request'
        )
        const path = new URL(route.request().url()).pathname
        if (path === '/api/auth/session')
          return route.fulfill({
            json: { seller: { id: 'owner', displayName: 'Fixture' } },
          })
        if (path === '/api/profile/account')
          return route.fulfill({
            json: {
              username: 'Fixture',
              email: 'fixture@uwo.ca',
              emailVerified: true,
              createdAt: '2026-10-01',
              nextUsernameChangeAt: null,
            },
          })
        return route.fulfill({ json: [] })
      })
      const select = async (name) => {
        const mobile = width < 1024
        const nav = page.locator(
          mobile ? '[data-smooth-dropdown]' : '[data-slot="sidebar-body"]'
        )
        if (mobile)
          await nav
            .getByRole('button', { name: 'Show more', exact: true })
            .click()
        else await nav.hover()
        await nav
          .getByRole(mobile ? 'button' : 'link', { name, exact: true })
          .click()
        if (mobile && name === 'Profile')
          await nav
            .getByRole('button', { name: 'Overview', exact: true })
            .click()
        if (!mobile) await page.mouse.move(width - 10, 500)
        await page.waitForTimeout(400)
      }
      const row = page.locator('[data-profile-avatar-row]')
      const capture = async (name) => {
        await page.waitForTimeout(250)
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          'no page overflow'
        )
        await page.screenshot({ path: `${output}/${width}-${name}.png` })
      }
      const checkAvatar = async () => {
        const avatar = row.locator('[data-avatar-color]')
        assert.equal(await avatar.getAttribute('data-avatar-color'), '#664780')
        const box = await avatar.boundingBox()
        assert.equal(box.width, 40)
        assert.equal(box.height, 40)
        assert.equal(
          await avatar.evaluate((node) => getComputedStyle(node).borderRadius),
          '50%'
        )
      }
      const open = async () => {
        await page
          .getByRole('button', { name: 'Set avatar', exact: true })
          .click()
        await page
          .getByRole('dialog', { name: 'Set avatar', exact: true })
          .waitFor()
        await page.waitForTimeout(250)
      }
      const dialog = page.getByRole('dialog', {
        name: 'Set avatar',
        exact: true,
      })
      const fileInput = dialog.getByLabel('Avatar image')
      const save = dialog.getByRole('button', { name: 'Save', exact: true })
      await page.goto(
        `${process.env.HOME_TEST_URL || 'http://localhost:3101'}/home`,
        { waitUntil: 'domcontentloaded' }
      )
      await row.waitFor()
      await page.getByText('fixture@uwo.ca', { exact: true }).waitFor()
      await checkAvatar()
      assert.equal(await row.locator('span').last().textContent(), 'Unset')
      assert.equal(
        await row
          .locator('span')
          .last()
          .evaluate((node) => getComputedStyle(node).color),
        'rgb(255, 255, 255)'
      )
      await capture('overview-default')
      const badgeStyles = await row.evaluate((node) => {
        const unset = getComputedStyle(node.lastElementChild)
        const verified = getComputedStyle(
          Array.from(node.parentElement.querySelectorAll('span')).find(
            (span) => span.textContent === 'Verified'
          )
        )
        const geometry = (style) => [
          style.padding,
          style.borderRadius,
          style.fontSize,
          style.fontWeight,
          style.lineHeight,
          style.borderWidth,
        ]
        return {
          unset: geometry(unset),
          verified: geometry(verified),
          background: unset.backgroundColor,
          border: unset.borderColor,
          verifiedBackground: verified.backgroundColor,
          verifiedBorder: verified.borderColor,
        }
      })
      assert.deepEqual(
        badgeStyles.unset,
        badgeStyles.verified,
        'same Verified badge geometry and typography'
      )
      assert.equal(badgeStyles.background, 'rgba(119, 45, 64, 0.09)')
      assert.equal(badgeStyles.border, 'rgba(119, 45, 64, 0.55)')
      assert.equal(badgeStyles.verifiedBackground, 'rgba(35, 90, 57, 0.22)')
      assert.equal(badgeStyles.verifiedBorder, 'rgba(104, 184, 137, 0.333)')
      await select('Settings')
      await checkAvatar()
      await capture('settings-default')
      await open()
      assert(await save.isDisabled())
      assert.equal(await fileInput.getAttribute('multiple'), null)
      await capture('modal-empty')
      await fileInput.setInputFiles({
        name: 'invalid.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('invalid'),
      })
      await dialog.getByRole('alert').waitFor()
      assert(await save.isDisabled())
      await fileInput.setInputFiles(image('first.svg'))
      await page.waitForFunction(
        () => !document.querySelector('dialog button[disabled]')
      )
      await fileInput.setInputFiles(image('replacement.svg'))
      await dialog.getByText('replacement.svg', { exact: true }).waitFor()
      assert.equal(
        await dialog.locator('img').count(),
        1,
        'selection replaces instead of appending'
      )
      await capture('modal-selected')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(
        await row.locator('img').count(),
        0,
        'Cancel discards pending selection'
      )
      await open()
      assert(await save.isDisabled())
      await dialog.locator('label').evaluate((node) => {
        const data = new DataTransfer()
        data.items.add(new File(['a'], 'a.png', { type: 'image/png' }))
        data.items.add(new File(['b'], 'b.png', { type: 'image/png' }))
        node.dispatchEvent(
          new DragEvent('drop', { bubbles: true, dataTransfer: data })
        )
      })
      await dialog.getByRole('alert').waitFor()
      assert(await save.isDisabled(), 'multiple dropped files rejected')
      await fileInput.setInputFiles(image('saved.svg'))
      await page.waitForTimeout(200)
      await save.click()
      await dialog.waitFor({ state: 'detached' })
      const savedURL = await row.locator('img').getAttribute('src')
      assert(savedURL.startsWith('blob:'))
      await capture('settings-saved')
      await select('Profile')
      assert.equal(await row.locator('img').getAttribute('src'), savedURL)
      assert.equal(await row.locator('span').last().textContent(), 'Set')
      assert.equal(
        await row
          .locator('span')
          .last()
          .evaluate((node) => getComputedStyle(node).backgroundColor),
        badgeStyles.verifiedBackground,
        'Set reuses Verified success background'
      )
      await capture('overview-saved')
      await select('Settings')
      await open()
      await fileInput.setInputFiles(image('cancel-unsaved.svg'))
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(
        await row.locator('img').getAttribute('src'),
        savedURL,
        'Cancel preserves saved avatar'
      )
      await open()
      await fileInput.setInputFiles(image('unsaved.svg'))
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(
        await row.locator('img').getAttribute('src'),
        savedURL,
        'Escape preserves saved avatar'
      )
      await open()
      await fileInput.setInputFiles(image('outside-unsaved.svg'))
      await page.mouse.click(5, 5)
      await dialog.waitFor({ state: 'detached' })
      assert.equal(
        await row.locator('img').getAttribute('src'),
        savedURL,
        'outside click preserves saved avatar'
      )
      await page
        .getByRole('button', { name: 'Change password', exact: true })
        .click()
      await page.getByRole('dialog', { name: 'Change password' }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: circular purple default, one-file replacement, Cancel/Escape/outside, local Save synchronization, existing password modal`
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
