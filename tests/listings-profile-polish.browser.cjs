/* global document, window, getComputedStyle */
/* eslint-disable no-inner-declarations -- Each viewport has isolated fixtures and browser helpers. */
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'listings-profile-polish')
fs.mkdirSync(output, { recursive: true })
const item = (id, owner = 'owner', sold = false, multiple = true) => ({
  id,
  title: `Camera ${id}`,
  price: 8500,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickupArea: 'On campus',
  description: 'Works well. Includes the original accessories.',
  photoUrls: multiple
    ? ['/demo/reading-chair.jpg', '/demo/reading-chair.jpg?photo=2']
    : ['/demo/reading-chair.jpg'],
  seller: {
    id: owner,
    displayName: owner === 'owner' ? 'Chris' : 'Another seller',
  },
  status: sold ? 'sold' : 'available',
  publishedAt: '2026-10-05',
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
  expectedImageCount: multiple ? 2 : 1,
})
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
      async function refresh() {
        await page.evaluate(() =>
          window.dispatchEvent(new window.Event('marketplace-listings-changed'))
        )
        await settle()
      }
      async function centered(copy) {
        const empty = main()
          .locator('[data-workspace-empty]')
          .filter({ hasText: copy })
        await empty.waitFor()
        await settle()
        const value = await empty.evaluate((el) => {
          const rect = el.getBoundingClientRect(),
            main = el.closest('main'),
            parent = main.getBoundingClientRect(),
            style = getComputedStyle(main),
            range = document.createRange()
          range.selectNodeContents(el)
          const text = range.getBoundingClientRect()
          return {
            display: getComputedStyle(el).display,
            centerError: Math.abs(
              text.top + text.height / 2 - rect.top - rect.height * 0.275
            ),
            horizontal: Math.abs(
              text.left + text.width / 2 - rect.left - rect.width / 2
            ),
            height: rect.height,
            parentLeft: parent.left,
            left: rect.left,
            widthError: Math.abs(
              rect.width -
                (main.clientWidth -
                  parseFloat(style.paddingLeft) -
                  parseFloat(style.paddingRight))
            ),
            bottomError: Math.abs(
              rect.bottom - (parent.bottom - parseFloat(style.paddingBottom))
            ),
            gridAncestor: Boolean(el.closest('[data-listing-grid]')),
          }
        })
        console.log(width, copy, JSON.stringify(value))
        assert.equal(value.gridAncestor, false)
        assert(
          value.widthError < 2,
          'Empty region fills the entire content width'
        )
        assert(
          value.bottomError < 2,
          'Empty region fills remaining body height'
        )
        assert.equal(value.display, 'flex')
        assert(value.centerError < 2)
        assert(value.horizontal < 2)
        assert(value.height > 400)
        assert(value.left >= value.parentLeft)
      }
      async function choose(form, name, label) {
        const trigger = form.getByRole('combobox', { name, exact: true })
        await trigger.click()
        const option = form.getByRole('option', { name: label, exact: true })
        await option.scrollIntoViewIfNeeded()
        await option.click()
      }
      async function sliderCheck(slider, source = false) {
        await slider
          .getByRole('button', { name: 'Next slide', exact: true })
          .click()
        await settle()
        assert(
          await slider
            .getByRole('group', { name: '2 of 2', exact: true })
            .count()
        )
        if (source) assert.equal(await page.getByRole('dialog').count(), 0)
        const next = slider.getByRole('button', {
          name: 'Next slide',
          exact: true,
        })
        await next.focus()
        await page.keyboard.press('ArrowLeft')
        await settle()
        assert(
          await slider
            .getByRole('group', { name: '1 of 2', exact: true })
            .count(),
          'keyboard changes slides'
        )
        if (source) assert.equal(await page.getByRole('dialog').count(), 0)
        await slider
          .getByRole('button', { name: 'Go to slide 1', exact: true })
          .click()
        await settle()
        if (source) assert.equal(await page.getByRole('dialog').count(), 0)
        if (!desktop) {
          const rect = await slider.boundingBox(),
            cdp = await page.context().newCDPSession(page)
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
              { x: rect.x + rect.width * 0.8, y: rect.y + rect.height * 0.25 },
            ],
          })
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              { x: rect.x + rect.width * 0.2, y: rect.y + rect.height * 0.25 },
            ],
          })
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
          })
          await settle()
          assert(
            await slider
              .getByRole('group', { name: '2 of 2', exact: true })
              .count(),
            'touch swipe advances'
          )
          if (source)
            assert.equal(
              await page.getByRole('dialog').count(),
              0,
              'swipe never opens card'
            )
        }
      }
      await page.goto('http://localhost:3100/home', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      await main().getByText('chris@uwo.ca', { exact: true }).waitFor()
      assert.equal(
        await main().getByText('Username changes', { exact: true }).count(),
        0
      )
      const badge = main().getByText('Verified', { exact: true })
      assert((await badge.getAttribute('class')).includes('verified'))
      assert.equal(await badge.getAttribute('role'), null)
      assert.equal(
        await main()
          .getByRole('button', { name: /Change|Log out/ })
          .count(),
        0
      )
      await shot('profile-overview', !desktop)
      verified = false
      await page.reload()
      await main().getByText('Read-only', { exact: true }).waitFor()
      assert.equal(
        await main().getByText('Verified', { exact: true }).count(),
        0
      )
      verified = true
      await select('Listings', 'My Listings')
      await centered('No active listings yet.')
      await shot('active-empty')
      await main().getByRole('tab', { name: 'Sold', exact: true }).click()
      await centered('No sold listings yet.')
      await shot('sold-empty')
      await select('Listings', 'Favorites')
      await centered('No favorites yet.')
      await shot('favorites-empty')
      rows = [
        item('multi'),
        item('single', 'owner', false, false),
        item('sold', 'owner', true),
      ]
      favorites = [item('favorite', 'other')]
      await select('Listings', 'My Listings')
      await main().getByRole('tab', { name: 'Active', exact: true }).click()
      await refresh()
      const card = main().getByRole('article', {
        name: 'Camera multi',
        exact: true,
      })
      assert.equal(
        await card
          .getByRole('button', { name: /Edit|Mark as sold|Delete/ })
          .count(),
        3
      )
      assert.equal(
        await card
          .getByRole('button', { name: /favorites|Contact seller/ })
          .count(),
        0
      )
      assert.equal(
        await main()
          .getByRole('article', { name: 'Camera single', exact: true })
          .locator('[data-slot="image-slider"]')
          .count(),
        0
      )
      await sliderCheck(card.locator('[data-slot="image-slider"]'), true)
      await shot('active-populated')
      await card
        .locator('[data-slot="expandable-card"]')
        .click({ position: { x: 75, y: 50 } })
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await settle()
      const reference = await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .evaluate((button) => {
          const outer = button.getBoundingClientRect(),
            surface = button.firstElementChild
          const inner = surface.getBoundingClientRect()
          return {
            outerHeight: outer.height,
            height: inner.height,
            radius: getComputedStyle(surface).borderRadius,
            inset: inner.x - outer.x,
          }
        })
      assert.deepEqual(reference, {
        outerHeight: desktop ? 64 : 48,
        height: desktop ? 48 : 40,
        radius: '8px',
        inset: desktop ? 8 : 4,
      })
      console.log(width, 'accepted ExpandedCard footer reference', reference)
      const expandedSlider = dialog.locator('[data-slot="image-slider"]')
      // The selected source photo is shared with the expanded and returning slots.
      await expandedSlider
        .getByRole('button', { name: 'Go to slide 2' })
        .click()
      await settle()
      await shot('expanded-multiple')
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      await settle()
      assert(
        await card.getByRole('group', { name: '2 of 2', exact: true }).count(),
        'selected photo survives handoff'
      )
      await card.getByRole('button', { name: 'Edit', exact: true }).click()
      const edit = main().getByRole('form', {
        name: 'Edit listing',
        exact: true,
      })
      assert.equal(await edit.locator('input[type="file"]').count(), 0)
      assert.equal(
        await edit
          .getByRole('combobox', { name: 'Category', exact: true })
          .count(),
        0
      )
      if (!desktop)
        await edit.getByRole('button', { name: 'Preview', exact: true }).click()
      const editPreview = desktop
        ? page.getByRole('region', { name: 'Listing preview', exact: true })
        : page.getByRole('dialog')
      await editPreview.locator('[data-slot="image-slider"]').waitFor()
      await settle()
      await sliderCheck(editPreview.locator('[data-slot="image-slider"]'))
      await shot('edit-multiple-preview')
      if (!desktop) {
        await editPreview
          .getByRole('button', { name: 'Close', exact: true })
          .click()
        await editPreview.waitFor({ state: 'detached' })
        await settle()
      }
      await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
      await settle()
      await main().getByRole('tab', { name: 'Sold', exact: true }).click()
      await shot('sold-populated')
      assert.equal(
        await main()
          .getByRole('article', { name: 'Camera sold' })
          .getByRole('button', { name: /Edit|Mark as sold|Delete/ })
          .count(),
        0
      )
      await select('Listings', 'Favorites')
      await sliderCheck(main().locator('[data-slot="image-slider"]'), true)
      await shot('favorites-multiple')
      await select('Listings', 'Create Listing')
      const form = main().getByRole('form', {
        name: 'Create listing',
        exact: true,
      })
      assert.equal(await form.locator('select').count(), 0)
      for (const category of [
        'Electronics',
        'Home & Dorm',
        'Textbooks & School',
        'Clothing & Accessories',
        'Sports & Outdoors',
        'Bikes & Mobility',
        'Games & Hobbies',
        'Other',
      ]) {
        await form
          .getByRole('combobox', { name: 'Category', exact: true })
          .click()
        assert(
          await form
            .getByRole('option', { name: category, exact: true })
            .count()
        )
        await page.keyboard.press('Escape')
      }
      await choose(form, 'Category', 'Electronics')
      await choose(form, 'Subcategory', 'Cameras')
      await choose(form, 'Category', 'Home & Dorm')
      assert(
        (
          await form
            .getByRole('combobox', { name: 'Subcategory' })
            .textContent()
        ).includes('Choose a subcategory')
      )
      await form
        .getByRole('combobox', { name: 'Category', exact: true })
        .click()
      await shot('create-dropdown')
      await page.keyboard.press('Escape')
      const file = (i) => ({
        name: `${i}.jpg`,
        mimeType: 'image/jpeg',
        buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
      })
      const input = form.locator('input[type="file"]')
      await input.setInputFiles({
        name: 'invalid.gif',
        mimeType: 'image/gif',
        buffer: Buffer.from('invalid'),
      })
      assert(await form.getByRole('alert').count())
      await input.setInputFiles({
        name: 'huge.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.alloc(3145729),
      })
      assert(await form.getByRole('alert').count())
      await input.setInputFiles(Array.from({ length: 7 }, (_, i) => file(i)))
      assert(await form.getByRole('alert').count())
      await input.setInputFiles([file(1), file(2)])
      await top()
      await shot('create-images', true)
      if (!desktop)
        await form.getByRole('button', { name: 'Preview', exact: true }).click()
      const preview = desktop
        ? page.getByRole('region', { name: 'Listing preview', exact: true })
        : page.getByRole('dialog')
      await preview.locator('[data-slot="image-slider"]').waitFor()
      await settle()
      await sliderCheck(preview.locator('[data-slot="image-slider"]'))
      await shot('create-multiple-preview')
      if (!desktop) {
        await preview
          .getByRole('button', { name: 'Close', exact: true })
          .click()
        await preview.waitFor({ state: 'detached' })
        await settle()
      }
      await form.getByRole('button', { name: 'Discard', exact: true }).click()
      if (desktop) {
        await preview
          .locator('[data-slot="image-slider"]')
          .waitFor({ state: 'detached' })
        assert.equal(
          await preview.locator('[data-slot="image-slider"]').count(),
          0
        )
      }
      await form.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Discard', exact: true })
        .click()
      await settle()
      rows.push(item('public', 'other'))
      if (width >= 1024)
        await page
          .getByRole('link', { name: 'Back to Market', exact: true })
          .click()
      else await page.getByRole('tab', { name: 'Market', exact: true }).click()
      await page.locator('[data-route-source]').waitFor({ state: 'detached' })

      await page.getByRole('button', { name: 'Filter', exact: true }).waitFor()
      await settle()
      const publicCard = page.getByRole('button', {
        name: /Open example listing: Camera public/,
      })
      await sliderCheck(publicCard.locator('[data-slot="image-slider"]'), true)
      await shot('market-multiple')
      await publicCard.click({ position: { x: 75, y: 50 } })
      await page.getByRole('dialog').waitFor()
      await settle()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Close', exact: true })
        .click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.deepEqual(
        writes,
        [],
        'Selection and previews never write to any backend'
      )
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: elevated Active/Sold/Favorites; actual verification; exact Profile action reuse; single/multi media; native controls/swipe isolation; selected-photo handoff; local previews; canonical dropdowns/reset; photo validation; no writes/overflow.`
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

/* eslint-enable no-inner-declarations */
