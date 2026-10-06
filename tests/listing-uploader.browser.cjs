/* global document, window, getComputedStyle, DataTransfer, File */
/* eslint-disable no-inner-declarations -- Each viewport has isolated fixtures and browser helpers. */
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'listing-uploader')
fs.mkdirSync(output, { recursive: true })
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of (process.env.POLISH_WIDTHS || '390,430,1280,1536')
      .split(',')
      .map(Number)) {
      const desktop = width >= 1024,
        errors = []
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      let rows = [],
        favorites = [],
        verified = true
      const writes = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route(
        /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) => route.abort()
      )
      await page.route('**/api/**', (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          p = url.pathname
        const send = (json) => route.fulfill({ json })
        if (request.method() !== 'GET') {
          writes.push(p)
          return route.fulfill({
            status: 501,
            json: { error: 'Writes prohibited in visual verification' },
          })
        }
        if (p === '/api/auth/session')
          return send({ seller: { id: 'owner', displayName: 'Chris' } })
        if (p === '/api/profile/account')
          return send({
            username: 'Chris',
            email: 'chris@uwo.ca',
            emailVerified: verified,
            createdAt: '2026-10-01',
            nextUsernameChangeAt: null,
          })
        if (p === '/api/profile/categories') return send([])
        if (p === '/api/listings')
          return send(
            url.searchParams.get('mine') === 'true'
              ? rows.filter((x) => x.seller.id === 'owner')
              : rows.filter((x) => x.status === 'available')
          )
        if (p === '/api/favorites') return send(favorites)
        if (p.startsWith('/api/favorites/'))
          return send({
            favorited: favorites.some((x) => x.id === p.split('/').pop()),
          })
        return route.fulfill({
          status: 501,
          json: { error: `Unexpected read ${p}` },
        })
      })
      await page.route('**/_next/data/**/listings.json*', (route) =>
        route.fulfill({
          json: { pageProps: { listings: rows, error: null }, __N_SSP: true },
        })
      )
      const main = () =>
        desktop
          ? page.locator('[data-home-main]')
          : page.locator('[data-slot="home-sidebar-demo"] main').first()
      async function settle() {
        await page.waitForTimeout(1050)
      }
      async function top() {
        if (desktop) await main().evaluate((el) => (el.scrollTop = 0))
        else await page.evaluate(() => window.scrollTo(0, 0))
      }
      async function shot(name, fullPage = false) {
        await settle()
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          name + ' overflow'
        )
        await page.screenshot({
          path: path.join(output, `${width}-${name}.png`),
          fullPage,
        })
      }
      async function select(group, child) {
        if (!desktop) {
          await page
            .getByRole('button', { name: 'Show more', exact: true })
            .click()
          const menu = page.locator('[data-smooth-menu]')
          if (
            child &&
            !(await menu
              .getByRole('button', { name: child, exact: true })
              .count())
          )
            await menu.getByRole('button', { name: group, exact: true }).click()
          await menu
            .getByRole('button', { name: child || group, exact: true })
            .click()
        } else {
          const rail = page.locator('[data-slot="sidebar-body"]')
          await rail.hover()
          await page.waitForTimeout(350)
          if (child) {
            if (
              !(await rail
                .getByRole('button', { name: child, exact: true })
                .isVisible())
            )
              await rail.getByRole('link', { name: group, exact: true }).click()
            await rail.getByRole('button', { name: child, exact: true }).click()
          } else
            await rail.getByRole('link', { name: group, exact: true }).click()
          await page.mouse.move(width - 20, 450)
        }
        await settle()
        await top()
      }
      await page.goto('http://localhost:3100/home', {
        waitUntil: 'networkidle',
      })
      await select('Listings', 'Create Listing')
      const form = main().getByRole('form', {
        name: 'Create listing',
        exact: true,
      })
      const zone = form.locator('[data-slot="file-drop"] > label')
      const action = form.locator('[data-active-photo]')
      const input = form.locator('input[type="file"]')
      const thumbnails = {
        count: async () => Number(await form.getAttribute('data-photo-count')),
      }
      const photo = (name) => ({
        name,
        mimeType: 'image/jpeg',
        buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
      })
      async function chooser(target, keyboard = false) {
        if (keyboard) await target.focus()
        const event = page.waitForEvent('filechooser')
        if (keyboard) await page.keyboard.press('Space')
        else await target.click()
        return event
      }
      await shot('empty')
      let bounds = await Promise.all([zone.boundingBox(), action.boundingBox()])
      assert(bounds[1].y >= bounds[0].y + bounds[0].height)
      const first = await chooser(zone)
      await first.setFiles(photo('first.jpg'))
      await settle()
      assert.equal(await thumbnails.count(), 1)
      assert.equal(await form.locator('[data-slot="file-drop"] li').count(), 0)
      const second = await chooser(input, true)
      await second.setFiles(photo('second.jpg'))
      await settle()
      assert.equal(await thumbnails.count(), 2)
      await input.focus()
      assert(
        await zone.evaluate(
          (el) => getComputedStyle(el).outlineStyle !== 'none'
        )
      )
      const drop = await page.evaluateHandle((bytes) => {
        const dt = new DataTransfer()
        dt.items.add(
          new File([new Uint8Array(bytes)], 'dropped.jpg', {
            type: 'image/jpeg',
          })
        )
        return dt
      }, Array.from(photo('drop.jpg').buffer))
      await zone.dispatchEvent('dragover', { dataTransfer: drop })
      assert.equal(await zone.getAttribute('data-over'), 'true')
      await zone.dispatchEvent('drop', { dataTransfer: drop })
      await settle()
      assert.equal(await thumbnails.count(), 3)
      assert.equal(await zone.getAttribute('data-over'), 'false')
      for (const invalid of [
        { name: 'bad.gif', mimeType: 'image/gif', buffer: Buffer.from('bad') },
        {
          name: 'huge.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.alloc(3145729),
        },
        Array.from({ length: 4 }, (_, i) => photo(`excess-${i}.jpg`)),
      ]) {
        await input.setInputFiles(invalid)
        assert.equal(await form.getByRole('alert').count(), 1)
        assert.equal(await thumbnails.count(), 3)
      }
      const third = await chooser(zone)
      await third.setFiles(
        Array.from({ length: 3 }, (_, i) => photo(`last-${i}.jpg`))
      )
      await settle()
      assert.equal(await thumbnails.count(), 6)
      assert.equal(await form.getByRole('alert').count(), 0)
      assert.equal(await form.locator('[data-slot="file-drop"] li').count(), 0)
      await top()
      await shot('selected', true)
      const selectedRect = await form
        .locator('[data-selected-photos]')
        .boundingBox()
      const actionRect = await action.boundingBox()
      assert(selectedRect.y <= actionRect.y, 'no selected UI collision')
      if (!desktop)
        await form.getByRole('button', { name: 'Preview', exact: true }).click()
      const preview = desktop
        ? page.getByRole('region', { name: 'Listing preview', exact: true })
        : page.getByRole('dialog')
      await preview.locator('[data-slot="image-slider"]').waitFor()
      await shot('preview')
      if (!desktop) {
        await preview
          .getByRole('button', { name: 'Close', exact: true })
          .click()
        await preview.waitFor({ state: 'detached' })
      }
      await form.getByRole('button', { name: 'Discard', exact: true }).click()
      assert.equal(await thumbnails.count(), 5)
      await input.setInputFiles(photo('first.jpg'))
      assert.equal(await thumbnails.count(), 6)
      for (let remaining = 6; remaining > 0; remaining--) {
        await form.getByRole('button', { name: 'Discard', exact: true }).click()
        await page.waitForFunction(
          (count) =>
            Number(
              document
                .querySelector('[data-photo-count]')
                .getAttribute('data-photo-count')
            ) === count,
          remaining - 1
        )
      }
      const formats = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        canvas.getContext('2d').fillRect(0, 0, 8, 8)
        return ['image/png', 'image/webp'].map((type) => ({
          type,
          data: canvas.toDataURL(type).split(',')[1],
        }))
      })
      const keyboardDrop = await chooser(input, true)
      await keyboardDrop.setFiles({
        name: 'local.png',
        mimeType: 'image/png',
        buffer: Buffer.from(formats[0].data, 'base64'),
      })
      await settle()
      assert.equal(await thumbnails.count(), 1)
      if (desktop)
        assert.equal(
          await preview.locator('[data-slot="image-slider"]').count(),
          0
        )
      await input.setInputFiles({
        name: 'local.webp',
        mimeType: 'image/webp',
        buffer: Buffer.from(formats[1].data, 'base64'),
      })
      await settle()
      assert.equal(await thumbnails.count(), 2)
      assert.equal(await form.getByRole('alert').count(), 0)
      assert.deepEqual(writes, [])
      assert.deepEqual(errors, [])
      console.log(
        `${width}: uploader hierarchy, chooser click/keyboard, focus, drag/drop, validation, six local photos, removal, preview, no overflow/writes PASS`
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
