/* global document, window, getComputedStyle, requestAnimationFrame, performance, MutationObserver */
/* eslint-disable no-inner-declarations -- Each viewport has isolated fixtures and browser helpers. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'create-success-validation')
fs.mkdirSync(output, { recursive: true })
const jpeg = fs.readFileSync('public/demo/reading-chair.jpg')
const photo = (index) => ({
  name: `photo-${index}.jpg`,
  mimeType: 'image/jpeg',
  buffer: jpeg,
})
const baseListing = (id, seller = 'owner') => ({
  id,
  title: 'Camera',
  price: 1000,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickupArea: 'On campus',
  description: 'Works well.',
  photoUrls: ['/demo/reading-chair.jpg'],
  seller: {
    id: seller,
    displayName: seller === 'owner' ? 'Chris' : 'Another seller',
  },
  status: 'available',
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
  publishedAt: '2026-10-05',
  expectedImageCount: 1,
})
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of (process.env.V1_WIDTHS || '390,430,1280,1536')
      .split(',')
      .map(Number)) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = [],
        calls = [],
        favoriteQueries = []
      let rows = [
        baseListing('other', 'other'),
        { ...baseListing('hidden'), publishedAt: null },
      ]
      let favorites = new Set(),
        creates = 0,
        uploads = 0,
        uploadFailure = true,
        finalizeFailure = true,
        unknown = true
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      // Every browser API request is intercepted; unexpected requests fail closed.
      await page.route('**/api/**', async (r) => {
        const request = r.request(),
          url = new URL(request.url()),
          method = request.method(),
          body =
            request.headers()['content-type'] === 'application/json'
              ? request.postDataJSON()
              : null
        const send = (json, status = 200) => r.fulfill({ status, json })
        const p = url.pathname
        calls.push([method, p])
        if (p === '/api/auth/session')
          return send({ seller: { id: 'owner', displayName: 'Chris' } })
        if (p === '/api/profile/account')
          return send({
            username: 'Chris',
            email: 'chris@uwo.ca',
            emailVerified: true,
            createdAt: '2026-10-01',
            nextUsernameChangeAt: null,
          })
        if (p === '/api/profile/categories') return send([])
        if (p === '/api/auth/username-availability')
          return send({ available: true })
        if (p.startsWith('/api/listing-images/')) {
          uploads++
          if (uploadFailure) {
            uploadFailure = false
            return send({ error: 'Upload failed. Please retry.' }, 503)
          }
          const listing = rows.find((item) => item.id === p.split('/').pop())
          listing.photoUrls.push('/demo/reading-chair.jpg')
          return send(listing)
        }
        if (p === '/api/listings') {
          if (method === 'GET')
            return send(
              rows.filter((item) =>
                url.searchParams.get('mine') === 'true'
                  ? item.seller.id === 'owner'
                  : item.publishedAt && item.status === 'available'
              )
            )
          creates++
          await new Promise((resolve) => setTimeout(resolve, 250))
          const listing = {
            ...baseListing(`created-${creates}`),
            ...body,
            photoUrls: [],
            publishedAt: null,
          }
          rows.push(listing)
          return send(listing, 201)
        }
        if (p.startsWith('/api/listings/')) {
          const [, , , id, action] = p.split('/')
          const listing = rows.find((item) => item.id === id)
          assert(listing, `${method} ${p} references existing same-ID listing`)
          if (action === 'creation')
            return unknown && creates > 1
              ? send({ error: 'Connection unavailable' }, 503)
              : send(listing)
          if (action === 'abandon' || method === 'DELETE') {
            rows = rows.filter((item) => item.id !== id)
            favorites.delete(id)
            return send(null)
          }
          if (action === 'finalize') {
            if (finalizeFailure)
              return send({ error: 'Finalize response lost' }, 503)
            listing.publishedAt = '2026-10-05T16:00:00Z'
            return send(listing)
          }
          if (action === 'sold') {
            listing.status = 'sold'
            return send(listing)
          }
          if (method === 'PATCH') {
            assert.deepEqual(Object.keys(body).sort(), [
              'condition',
              'description',
              'pickupArea',
              'price',
              'title',
            ])
            Object.assign(listing, body)
            return send(listing)
          }
          return send(listing)
        }
        if (p === '/api/favorites') {
          favoriteQueries.push(Object.fromEntries(url.searchParams))
          let selected = rows.filter(
            (item) =>
              favorites.has(item.id) &&
              item.publishedAt &&
              item.status === 'available'
          )
          for (const [key, prop] of [
            ['category', 'category'],
            ['subcategory', 'subcategory'],
            ['condition', 'condition'],
            ['place', 'pickupArea'],
          ])
            if (url.searchParams.get(key))
              selected = selected.filter(
                (item) => item[prop] === url.searchParams.get(key)
              )
          if (url.searchParams.get('sort') === 'price-asc')
            selected.sort((a, b) => a.price - b.price)
          return send(selected)
        }
        if (p.startsWith('/api/favorites/')) {
          const id = p.split('/').pop()
          if (method === 'POST') favorites.add(id)
          if (method === 'DELETE') favorites.delete(id)
          return send({ favorited: favorites.has(id) })
        }
        return send(
          { error: `Unexpected fixture request: ${method} ${p}` },
          501
        )
      })
      await page.route('**/_next/data/**/listings.json*', (r) =>
        r.fulfill({
          json: {
            pageProps: {
              listings: rows.filter(
                (item) => item.publishedAt && item.status === 'available'
              ),
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
      )
      await page.goto('http://localhost:3100/home', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      const main =
        width < 1024
          ? page
              .locator('main')
              .filter({ has: page.locator('h2', { hasText: /^Overview$/ }) })
          : page.locator('[data-home-main]')
      await main.getByText('Chris', { exact: true }).waitFor()
      assert.equal(
        await main.getByRole('button', { name: /Change|Log out/ }).count(),
        0,
        'Overview is display only'
      )
      async function select(child) {
        if (width < 1024) {
          await page
            .getByRole('button', { name: 'Show more', exact: true })
            .click()
          const menu = page.locator('[data-smooth-menu]')
          if (
            (await menu
              .getByRole('button', { name: child, exact: true })
              .count()) === 0
          )
            await menu
              .getByRole('button', { name: 'Listings', exact: true })
              .click()
          await menu.getByRole('button', { name: child, exact: true }).click()
        } else {
          const nav = page.locator('[data-slot="sidebar-body"]')
          await nav.hover()
          if (
            !(await nav
              .getByRole('button', { name: child, exact: true })
              .isVisible())
          )
            await nav
              .getByRole('link', { name: 'Listings', exact: true })
              .click()
          await nav.getByRole('button', { name: child, exact: true }).click()
          await page.mouse.move(width - 20, 450)
          await page.waitForTimeout(350)
        }
      }
      async function choose(scope, name, label) {
        const trigger = scope.getByRole('combobox', { name, exact: true })
        await trigger.click()
        const option = scope.getByRole('option', { name: label, exact: true })
        await option.scrollIntoViewIfNeeded()
        await option.click()
      }

      await select('Create Listing')
      const form = page.getByRole('form', {
        name: 'Create listing',
        exact: true,
        includeHidden: true,
      })
      const create = form.getByRole('button', { name: 'Create', exact: true })
      const layer = page.locator('[data-create-success-phase]')
      const backdrop = page.locator('[data-create-success-backdrop]')
      const dialog = page.getByRole('dialog', {
        name: 'Listing created',
        exact: true,
      })
      async function fill(title) {
        await form.locator('[name=title]').fill(title)
        await form.locator('[name=price]').fill('0')
        await choose(form, 'Category', 'Home & Dorm')
        await choose(form, 'Subcategory', 'Furniture')
        await choose(form, 'Condition', 'Good')
        await choose(form, 'Place', 'On campus')
        await form
          .locator('[name=description]')
          .fill('A clean desk for another student.')
        await form.locator('input[type=file]').setInputFiles(photo(1))
        await create.scrollIntoViewIfNeeded()
      }
      async function shot(name) {
        await page.screenshot({
          path: path.join(output, `${width}-${name}.png`),
        })
      }
      async function phase(name) {
        await page.waitForFunction(
          (n) =>
            document.querySelector('[data-create-success-phase]')?.dataset
              .createSuccessPhase === n,
          name
        )
      }
      async function observe() {
        await page.evaluate(() => {
          window.successFrames = []
          const record = () => {
            const layer = document.querySelector('[data-create-success-phase]'),
              button = document.querySelector('form [data-state]'),
              backdrop = document.querySelector(
                '[data-create-success-backdrop]'
              )
            window.successFrames.push({
              time: performance.now(),
              state: button?.dataset.state,
              phase: layer?.dataset.createSuccessPhase,
              opacity: backdrop
                ? Number(getComputedStyle(backdrop).opacity)
                : 0,
              canvas: !!document.querySelector('[data-create-confetti]'),
              dialog: !!document.querySelector(
                'dialog[aria-labelledby="listing-created-title"]'
              ),
            })
          }
          if (!window.successSampling) {
            window.successSampling = true
            new MutationObserver(record).observe(document.body, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: ['data-create-success-phase', 'data-state'],
            })
            const sample = () => {
              record()
              requestAnimationFrame(sample)
            }
            sample()
          }
        })
      }
      await fill('Sequence desk')
      await observe()
      await create.click()
      await page.waitForTimeout(80)
      assert.equal(await create.getAttribute('data-state'), 'loading')
      await shot('loading')
      await form
        .getByText('Upload failed. Please retry.', { exact: true })
        .waitFor()
      await page.waitForFunction(
        () =>
          document.querySelector('form [data-state]')?.dataset.state === 'error'
      )
      assert.equal(await layer.count(), 0)
      assert.equal(await page.locator('[data-create-confetti]').count(), 0)
      assert.equal(
        await form.locator('[name=title]').inputValue(),
        'Sequence desk'
      )
      assert.equal(await form.locator('[data-active-photo] img').count(), 1)
      await shot('failure-preserved')
      assert.equal(uploads, 1)
      finalizeFailure = false
      unknown = false
      await page.waitForTimeout(2100)
      await observe()
      await create.focus()
      await page.keyboard.press('Space')
      await create.evaluate((el) => el.click())
      await phase('checkmark')
      assert.equal(
        await form.locator('[data-state]').getAttribute('data-state'),
        'success'
      )
      assert.equal(await dialog.count(), 0)
      await shot('checkmark')
      await phase('darkening')
      await page.waitForTimeout(55)
      const initialOpacity = Number(
        await backdrop.evaluate((el) => getComputedStyle(el).opacity)
      )
      assert(initialOpacity > 0 && initialOpacity < 1)
      await shot('darkening')
      await phase('celebrating')
      assert.equal(
        await backdrop.evaluate((el) => getComputedStyle(el).opacity),
        '1'
      )
      assert.equal(await dialog.count(), 0)
      await shot('dark-established')
      await page.locator('[data-create-confetti]').waitFor()
      await page.waitForTimeout(100)
      const canvas = await page.locator('[data-create-confetti]').boundingBox()
      assert(canvas.width > 0 && canvas.height > 0)
      assert(
        Math.abs(canvas.x + canvas.width / 2 - width / 2) < 2 || width >= 1024
      )
      if (width >= 1024)
        assert(canvas.x > 100, 'Sidebar excluded from celebration area')
      else
        assert(
          canvas.y + canvas.height <= 820,
          'Fixed bottom navigation excluded'
        )
      await shot('fireworks')
      await dialog.waitFor()
      await page.waitForTimeout(35)
      assert(
        Number(await dialog.evaluate((el) => getComputedStyle(el).opacity)) < 1
      )
      await shot('dialog-entering')
      await page.waitForTimeout(200)
      await shot('dialog-open')
      const frames = await page.evaluate(() => window.successFrames)
      const first = (p) => frames.find((f) => f.phase === p)
      console.log(`${width} observed success phase intervals`, {
        checkmark: first('darkening').time - first('checkmark').time,
        darkening: first('celebrating').time - first('darkening').time,
        fireworksBeforeDialog:
          first('decision').time - first('celebrating').time,
      })
      assert(first('darkening').time - first('checkmark').time >= 230)
      assert(first('celebrating').time - first('darkening').time >= 180)
      // Browser sampling may trail a commit under load; require a distinct visible celebration.
      assert(first('decision').time - first('celebrating').time >= 400)
      assert(
        frames.filter((f) => f.dialog).every((f) => f.opacity === 1),
        'Dialog only appears over established darkness'
      )
      assert(
        frames
          .filter((f) => f.canvas)
          .every((f) => ['celebrating', 'decision'].includes(f.phase))
      )
      assert.equal(
        creates,
        2,
        'Duplicate activation did not create a third listing'
      )
      const another = dialog.getByRole('button', {
        name: 'Create another',
        exact: true,
      })
      await another.click()
      assert.equal(await another.getAttribute('aria-busy'), 'true')
      await page.waitForTimeout(100)
      assert.equal(await dialog.getAttribute('data-exiting'), null)
      await page.waitForFunction(
        () =>
          document.querySelector(
            'dialog[aria-labelledby="listing-created-title"]'
          )?.dataset.exiting === 'true'
      )
      assert.equal(
        await form.locator('[name=title]').inputValue(),
        'Sequence desk',
        'No reset before dialog exit'
      )
      await shot('another-dialog-exit')
      await phase('exit')
      assert.equal(await form.locator('[name=title]').inputValue(), '')
      await page.waitForTimeout(50)
      await shot('another-backdrop-exit-reset')
      await layer.waitFor({ state: 'detached' })
      assert.equal(await form.locator('[data-active-photo] img').count(), 0)
      assert.equal(await form.getAttribute('data-photo-count'), '0')
      assert.equal(await form.locator('[name=price]').inputValue(), '')
      assert.equal(await create.getAttribute('data-state'), 'idle')
      assert(
        (
          await form
            .getByRole('combobox', { name: 'Category', exact: true })
            .textContent()
        ).includes('Choose')
      )
      assert(
        (
          await form
            .getByRole('combobox', { name: 'Subcategory', exact: true })
            .textContent()
        ).includes('Choose')
      )
      assert.equal(creates, 2, 'Reset never creates a new listing')
      assert.equal(await page.locator('#__next').getAttribute('inert'), null)
      await shot('clean-create')
      await fill('Back sequence desk')
      await create.click()
      await dialog.waitFor()
      await page.waitForTimeout(220)
      await dialog
        .getByRole('button', { name: 'Back to My Listings', exact: true })
        .click()
      await page.waitForFunction(
        () =>
          document.querySelector(
            'dialog[aria-labelledby="listing-created-title"]'
          )?.dataset.exiting === 'true'
      )
      assert.equal(await form.count(), 1, 'Navigation waits for dialog exit')
      await shot('back-dialog-exit')
      await phase('exit')
      assert.equal(await form.count(), 1, 'Navigation waits for backdrop exit')
      await page.waitForTimeout(55)
      await shot('back-backdrop-exit')
      await layer.waitFor({ state: 'detached' })
      await page.getByRole('tab', { name: 'Active', exact: true }).waitFor()
      assert.equal(
        await page
          .getByRole('tab', { name: 'Active', exact: true })
          .getAttribute('aria-selected'),
        'true'
      )
      await page
        .getByRole('article', { name: 'Back sequence desk', exact: true })
        .waitFor()
      await shot('back-active')
      if (width === 390) {
        await select('Create Listing')
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await fill('Reduced-motion desk')
        await observe()
        await create.click()
        await dialog.waitFor()
        assert.equal(await page.locator('[data-create-confetti]').count(), 0)
        const reduced = await page.evaluate(() => window.successFrames)
        const check = reduced.find((f) => f.phase === 'checkmark'),
          decision = reduced.find((f) => f.phase === 'decision')
        assert(
          decision.time - check.time < 650,
          'Reduced motion skips celebration delay'
        )
        assert(
          !reduced.some((f) => f.canvas),
          'Reduced motion does not fire confetti'
        )
        await shot('reduced-motion-dialog')
        await dialog
          .getByRole('button', { name: 'Create another', exact: true })
          .click()
        await layer.waitFor({ state: 'detached' })
      }
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: real publication fixtures, failure preserves form, 250ms checkmark, 200ms dark fade, bounded centered confetti, delayed dialog, both fade-out choices/reset, duplicate prevention${
          width === 390 ? ', reduced motion' : ''
        }`
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
