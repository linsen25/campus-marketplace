/* global document, window, getComputedStyle */
/* eslint-disable no-inner-declarations -- Each viewport has isolated fixtures and browser helpers. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'listings-v1-validation')
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
      await select('My Listings')
      await page
        .getByText('No active listings yet.', { exact: true })
        .last()
        .waitFor()
      assert.equal(
        await page
          .getByRole('article', { name: 'Camera', exact: true })
          .count(),
        0,
        'Internal unpublished listing is never a draft card'
      )
      await select('Create Listing')
      const form = page.getByRole('form', {
        name: 'Create listing',
        exact: true,
      })
      const create = () =>
        page.getByRole('button', {
          name: /^Create$/,
        })
      assert(await create().isDisabled())
      await form.locator('[name="title"]').fill('Free desk')
      await form.locator('[name="price"]').fill('0')
      await choose(form, 'Category', 'Electronics')
      await choose(form, 'Subcategory', 'Cameras')
      await choose(form, 'Category', 'Home & Dorm')
      assert(
        (
          await form
            .getByRole('combobox', { name: 'Subcategory', exact: true })
            .textContent()
        ).includes('Choose a subcategory')
      )
      await choose(form, 'Subcategory', 'Furniture')
      await choose(form, 'Condition', 'Good')
      await choose(form, 'Place', 'On campus')
      await form
        .locator('[name="description"]')
        .fill('A clean desk for another student.')
      assert(await create().isDisabled(), 'No photos rejects creation')
      await form
        .locator('input[type="file"]')
        .setInputFiles(Array.from({ length: 7 }, (_, i) => photo(i)))
      assert(await create().isDisabled())
      await form.locator('input[type="file"]').setInputFiles(photo(1))
      assert(await create().isEnabled())
      await form
        .locator('input[type="file"]')
        .setInputFiles(Array.from({ length: 5 }, (_, i) => photo(i + 2)))
      assert(await create().isEnabled(), '6 valid photos accepted')
      const previewBefore = calls.filter((call) => call[0] !== 'GET').length
      if (width < 1024) {
        await form.getByRole('button', { name: 'Preview', exact: true }).click()
        const dialog = page
          .getByRole('dialog')
          .filter({ has: page.locator('[data-slot="expanded-price"]') })
        await dialog.waitFor()
        await page.waitForTimeout(900)
        assert.equal(
          await dialog.locator('[data-slot="expanded-price"]').textContent(),
          'Free'
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: /favorites|Contact seller/ })
            .count(),
          0
        )
        await page.screenshot({
          path: path.join(output, `${width}-preview.png`),
        })
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
      } else {
        const preview = page.getByRole('region', {
          name: 'Listing preview',
          exact: true,
        })
        await preview
          .getByRole('heading', { name: 'Free desk', exact: true })
          .waitFor()
        await form.locator('[name="title"]').fill('Live free desk')
        await preview
          .getByRole('heading', { name: 'Live free desk', exact: true })
          .waitFor()
      }
      assert.equal(
        calls.filter((call) => call[0] !== 'GET').length,
        previewBefore,
        'Preview is entirely local'
      )
      assert.equal(await form.locator('[name="price"]').inputValue(), '0')
      assert.equal(await form.locator('[data-active-photo] img').count(), 1)
      await page.screenshot({ path: path.join(output, `${width}-create.png`) })
      const geometry = await page
        .locator('[data-listing-builder]')
        .evaluate((el) => {
          const form = el.querySelector('form').getBoundingClientRect(),
            aside = el.querySelector('aside').getBoundingClientRect()
          return {
            columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
            formRight: form.right,
            asideLeft: aside.left,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
          }
        })
      assert.equal(geometry.overflow, false)
      assert.equal(geometry.columns, width < 1024 ? 1 : 2)
      if (width >= 1024) assert(geometry.formRight < geometry.asideLeft)
      assert.equal(await form.getByRole('button', { name: /Hold/ }).count(), 0)
      async function clickCreate() {
        await create().scrollIntoViewIfNeeded()
        const before = creates
        if (before === 0) {
          await create().focus()
          await page.keyboard.press('Enter')
          await create().evaluate((el) => el.click())
        } else
          await create().evaluate((el) => {
            el.click()
            el.click()
          })
        assert.equal(await create().getAttribute('aria-busy'), 'true')
        await page.waitForTimeout(100)
        assert.equal(creates, before, 'Publication waits for the 200ms buffer')
      }
      await clickCreate()
      await form
        .getByText('Upload failed. Please retry.', { exact: true })
        .waitFor()
      assert.equal(creates, 1)
      assert.equal(await form.locator('[data-active-photo] img').count(), 1)
      assert.equal(await form.locator('[name="price"]').inputValue(), '0')
      await page.waitForTimeout(1400)
      await clickCreate()
      await form.getByText(/Publication state is unknown/).waitFor()
      assert.equal(await page.locator('[data-create-success-phase]').count(), 0)
      assert.equal(await page.locator('[data-create-confetti]').count(), 0)
      assert.notEqual(
        await form.locator('[data-state]').getAttribute('data-state'),
        'success'
      )
      assert.equal(creates, 2)
      assert.equal(uploads, 7)
      assert(
        await form.locator('[name="title"]').isDisabled(),
        'Pending identity freezes the original payload'
      )
      const sameId = rows.find((item) => item.id === 'created-2').id
      unknown = false
      finalizeFailure = false
      await page.waitForTimeout(1400)
      await clickCreate()
      await page
        .getByText('Listing created', { exact: true })
        .waitFor()
        .catch(async (e) => {
          console.log(JSON.stringify(calls.slice(-20)))
          console.log(await page.locator('body').innerText())
          await page.screenshot({ path: path.join(output, 'failure.png') })
          throw e
        })
      const createdDialog = page.getByRole('dialog', {
        name: 'Listing created',
        exact: true,
      })
      await createdDialog
        .getByRole('button', { name: 'Back to My Listings', exact: true })
        .click()
      await createdDialog.waitFor({ state: 'detached' })
      await page
        .locator('[data-create-success-phase]')
        .waitFor({ state: 'detached' })
      assert.equal(
        creates,
        2,
        'Continue finalizes same listing, never creates a replacement'
      )
      assert(rows.find((item) => item.id === sameId).publishedAt)
      assert(
        (await page
          .getByRole('tab', { name: 'Active', exact: true })
          .getAttribute('aria-selected')) === 'true'
      )
      let article = page.locator('article').filter({
        has: page.getByRole('button', { name: 'Edit', exact: true }),
      })
      assert.equal(await article.count(), 1)
      assert.equal(
        await article
          .getByRole('button', { name: /favorites|Contact seller/ })
          .count(),
        0
      )
      await article.getByRole('button', { name: 'Edit', exact: true }).click()
      const edit = page.getByRole('form', { name: 'Edit listing', exact: true })
      assert.equal(
        await edit
          .locator(
            'input[type="file"], [name="category"], [name="subcategory"]'
          )
          .count(),
        0
      )
      await edit
        .getByText('Photos cannot be changed after publishing.', {
          exact: true,
        })
        .waitFor()
      for (const [name, value] of [
        ['title', 'Edited desk'],
        ['price', '12.50'],
        ['description', 'Edited details'],
      ])
        await edit.locator(`[name="${name}"]`).fill(value)
      await choose(edit, 'Condition', 'Fair')
      await choose(edit, 'Place', 'Other')
      await page.screenshot({ path: path.join(output, `${width}-edit.png`) })
      assert.equal(await edit.getByRole('button', { name: /Hold/ }).count(), 0)
      await edit
        .getByRole('button', { name: 'Save changes', exact: true })
        .click()
      await page.getByText('Changes saved', { exact: true }).waitFor()
      article = page.locator('article').filter({
        has: page.getByRole('button', { name: 'Edit', exact: true }),
      })
      await article
        .getByRole('button', { name: 'Mark as sold', exact: true })
        .click()
      const soldDialog = page.getByRole('dialog', {
        name: 'Mark this listing as sold?',
        exact: true,
      })
      await soldDialog
        .getByText(
          'It will be removed from Marketplace and can no longer be edited.',
          { exact: true }
        )
        .waitFor()
      await soldDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      assert.equal(rows.find((item) => item.id === sameId).status, 'available')
      await article
        .getByRole('button', { name: 'Mark as sold', exact: true })
        .click()
      await soldDialog
        .getByRole('button', { name: 'Mark as sold', exact: true })
        .click()
      await page.getByText('Listing marked as sold', { exact: true }).waitFor()
      await page.getByRole('tab', { name: 'Sold', exact: true }).click()
      await page.getByText('Sold · Read-only', { exact: true }).waitFor()
      assert.equal(
        await page.getByRole('button', { name: 'Edit', exact: true }).count(),
        0
      )
      await page.screenshot({ path: path.join(output, `${width}-sold.png`) })
      // Seed only mocked API memory, including a stale sold favorite relationship.
      rows.push(baseListing('delete-me'))
      favorites.add(sameId)
      favorites.add('other')
      await select('Favorites')
      let favoriteCard = page.locator('section[aria-label="Favorites"] article')
      await favoriteCard.first().waitFor()
      assert.equal(
        await favoriteCard.count(),
        1,
        'Sold relationship is filtered out'
      )
      await favoriteCard.getByRole('button').click()
      const realDialog = page.locator(
        '[data-slot="listing-overlay"] [role="dialog"]'
      )
      await realDialog
        .getByRole('button', { name: 'Contact seller', exact: true })
        .waitFor()
      await realDialog
        .getByRole('button', { name: 'Remove from favorites', exact: true })
        .click()
      await page.getByText('No favorites yet.', { exact: true }).waitFor()
      assert(!favorites.has('other'))
      favorites.add('other')
      await page.evaluate(() =>
        window.dispatchEvent(new window.Event('marketplace-listings-changed'))
      )
      await favoriteCard.first().waitFor()
      await page.getByRole('button', { name: 'Sort', exact: true }).click()
      await page
        .getByRole('button', { name: 'Price: Low to High', exact: true })
        .click()
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      assert(favoriteQueries.some((q) => q.sort === 'price-asc'))
      await page.getByRole('button', { name: 'Filter', exact: true }).click()
      await page
        .getByRole('combobox', { name: 'Category', exact: true })
        .click()
      await page
        .getByRole('option', { name: 'Electronics', exact: true })
        .click()
      await page
        .getByRole('combobox', { name: 'Subcategory', exact: true })
        .click()
      await page.getByRole('option', { name: 'Cameras', exact: true }).click()
      await page
        .getByRole('combobox', { name: 'Condition', exact: true })
        .click()
      await page.getByRole('option', { name: 'Good', exact: true }).click()
      await page
        .getByRole('radio', { name: 'On campus', exact: true })
        .check({ force: true })
      await page.getByRole('button', { name: 'Confirm', exact: true }).click()
      await page.waitForTimeout(450)
      assert(
        favoriteQueries.some(
          (q) =>
            q.category === 'Electronics' &&
            q.subcategory === 'Cameras' &&
            q.condition === 'good' &&
            q.place === 'On campus'
        )
      )
      await page.screenshot({
        path: path.join(output, `${width}-favorites.png`),
      })
      rows.find((item) => item.id === 'other').status = 'sold'
      await page.evaluate(() =>
        window.dispatchEvent(new window.Event('marketplace-listings-changed'))
      )
      await page
        .getByText('No listings match your filters.', { exact: false })
        .waitFor()
      assert(favorites.has('other'), 'Sold relationship does not need deletion')
      await select('My Listings')
      await page.getByRole('tab', { name: 'Active', exact: true }).click()
      article = page.locator('article').filter({
        has: page.getByRole('button', { name: 'Delete', exact: true }),
      })
      await article.getByRole('button', { name: 'Delete', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Delete this listing?', exact: true })
        .getByRole('button', { name: 'Delete', exact: true })
        .click()
      await page.getByText('Listing deleted', { exact: true }).waitFor()
      assert(!rows.some((item) => item.id === 'delete-me'))
      await select('Create Listing')
      await page
        .getByRole('form', { name: 'Create listing', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await page.getByRole('tab', { name: 'Active', exact: true }).waitFor()
      await select('Create Listing')
      await page
        .getByRole('form', { name: 'Create listing', exact: true })
        .locator('[name="title"]')
        .fill('Unsaved')
      await page
        .getByRole('form', { name: 'Create listing', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      const discard = page.getByRole('dialog', {
        name: 'Discard this listing?',
        exact: true,
      })
      await discard.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.equal(await page.locator('[name="title"]').inputValue(), 'Unsaved')
      await page
        .getByRole('form', { name: 'Create listing', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await discard
        .getByRole('button', { name: 'Discard', exact: true })
        .click()
      await page.getByRole('tab', { name: 'Active', exact: true }).waitFor()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        ),
        false
      )
      rows.push({
        ...baseListing('public', 'other'),
        title: 'Public free desk',
        price: 0,
      })
      if (width >= 1024)
        await page
          .getByRole('link', { name: 'Back to Market', exact: true })
          .click()
      else await page.getByRole('tab', { name: 'Market', exact: true }).click()
      await page.locator('[data-route-source]').waitFor({ state: 'detached' })

      const publicCard = page.getByRole('button', {
        name: /Open example listing: Public free desk/,
      })
      await publicCard.waitFor()
      assert.equal(
        await page.locator('[data-slot="expandable-card"]').count(),
        1,
        'Public Market excludes sold and unpublished rows'
      )
      await publicCard.click()
      const publicDialog = page.locator(
        '[data-slot="listing-overlay"] [role="dialog"]'
      )
      await publicDialog
        .getByRole('button', { name: 'Add to favorites', exact: true })
        .click()
      await publicDialog
        .getByRole('button', { name: 'Remove from favorites', exact: true })
        .waitFor()
      assert(
        favorites.has('public'),
        'Real Market favorite uses persistent API'
      )
      await publicDialog
        .getByRole('button', { name: 'Close', exact: true })
        .click()
      await publicDialog.waitFor({ state: 'detached' })
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(output, `${width}-market.png`) })
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: Profile family, responsive create/edit/preview, 0/1/6/7 images, 200ms normal-click buffer/one submission, upload failure preserves files, uncertain finalize same-ID retry, create success, locked edit, sold history, physical delete, persistent/scoped Favorites, clean/dirty Cancel, no overflow.`
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
/* eslint-enable no-inner-declarations */
