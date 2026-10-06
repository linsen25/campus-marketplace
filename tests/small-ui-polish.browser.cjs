/* global document, window, getComputedStyle, Navigator */
/* eslint-disable no-inner-declarations -- Each viewport has isolated fixtures and browser helpers. */
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'small-ui-polish')
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
      const favoriteQueries = []
      let failSave = true,
        saves = 0
      let rows = [
          {
            id: 'active',
            title: 'Camera active',
            price: 8500,
            currency: 'CAD',
            category: 'Electronics',
            subcategory: 'Cameras',
            condition: 'good',
            pickupArea: 'On campus',
            description: 'Working camera',
            photoUrls: ['/demo/reading-chair.jpg'],
            seller: { id: 'owner', displayName: 'Chris' },
            status: 'available',
            publishedAt: '2026-10-05',
            createdAt: '2026-10-05',
            updatedAt: '2026-10-05',
          },
        ],
        favorites = [],
        verified = true
      const writes = []
      await page.addInitScript(() => {
        delete Navigator.prototype.serviceWorker
      })
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
        if (p === '/api/auth/username-availability')
          return send({ available: true })
        if (p === '/api/listings/active' && request.method() === 'PATCH') {
          saves++
          if (failSave)
            return route.fulfill({
              status: 500,
              json: { error: 'Save test failed' },
            })
          const updated = { ...rows[0], ...request.postDataJSON() }
          rows[0] = updated
          return send(updated)
        }
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
        if (p === '/api/favorites') {
          favoriteQueries.push(url.searchParams.toString())
          return send(favorites)
        }
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
              listings: rows,
              values: {
                status: 'available',
                sort: 'newest',
                search: '',
                category: '',
                condition: '',
              },
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
      await page.goto('http://localhost:3100/home', {
        waitUntil: 'networkidle',
      })
      const overview = main().getByRole('region', {
        name: 'Overview',
        exact: true,
      })
      assert.equal(await overview.getByRole('button').count(), 0)
      assert.equal(
        await main()
          .getByRole('button', { name: 'Log out', exact: true })
          .count(),
        0
      )
      for (const name of [
        'Username',
        'Western Email',
        'Member since',
        'Verified',
      ])
        assert(await overview.getByText(name, { exact: true }).count())
      await shot('overview')
      await select('Settings')
      const settings = main().getByRole('region', {
        name: 'Account & Security',
        exact: true,
      })
      assert.equal(
        await settings
          .getByRole('button', { name: 'Log out', exact: true })
          .count(),
        1
      )
      async function surfaces(scope, label) {
        const values = await scope
          .locator('[data-action-row] button')
          .evaluateAll((buttons) =>
            buttons
              .filter((button) => button.getBoundingClientRect().width > 0)
              .map((button) => {
                const surface =
                  button.querySelector('.shining-button__body') ||
                  button.firstElementChild
                const r = surface.getBoundingClientRect(),
                  style = getComputedStyle(surface)
                return {
                  width: r.width,
                  height: r.height,
                  y: r.y,
                  radius: style.borderRadius,
                  color: style.backgroundColor,
                }
              })
          )
        assert(values.length >= 2, label)
        for (const value of values) {
          assert(
            Math.abs(value.width - values[0].width) < 0.02,
            label + ' visible widths'
          )
          assert.equal(
            value.height,
            values[0].height,
            label + ' visible heights'
          )
          assert.equal(value.y, values[0].y, label + ' vertical alignment')
          assert.equal(
            value.radius,
            values[0].radius,
            label + ' surface radius'
          )
          assert.equal(
            value.height,
            desktop ? 48 : 40,
            label + ' accepted card-footer surface height'
          )
        }
        console.log(width, label, JSON.stringify(values))
        return values
      }
      async function color(button, expected) {
        assert.equal(
          await button.evaluate(
            (el) =>
              getComputedStyle(el.querySelector('.shining-button__body'))
                .backgroundColor
          ),
          expected
        )
        assert.equal(await button.locator('.shining-button__arrow').count(), 1)
      }
      await color(
        settings.getByRole('button', { name: 'Change username', exact: true }),
        'rgb(119, 45, 64)'
      )
      await color(
        settings.getByRole('button', { name: 'Change password', exact: true }),
        'rgb(119, 45, 64)'
      )
      await color(
        settings.getByRole('button', { name: 'Log out', exact: true }),
        'rgb(119, 45, 64)'
      )
      const dimensions = await settings
        .getByRole('button')
        .evaluateAll((nodes) =>
          nodes.map((el) => {
            const r = el.getBoundingClientRect(),
              s = getComputedStyle(el)
            return [
              r.width,
              r.height,
              s.padding,
              s.borderRadius,
              s.font,
              getComputedStyle(el.querySelector('.shining-button__arrow'))
                .width,
            ]
          })
        )
      assert.deepEqual(dimensions[0], dimensions[1])
      assert.deepEqual(dimensions[0], dimensions[2])
      assert.equal(dimensions[0][0], 200)
      assert.equal(dimensions[0][1], desktop ? 64 : 48)
      const aligned = await settings
        .getByRole('button')
        .evaluateAll((nodes) => nodes.map((el) => el.getBoundingClientRect().x))
      assert(
        aligned.every((x) => x === aligned[0]),
        'Settings action columns align'
      )
      const canonicalHeader = await main()
        .locator('[data-home-section-header]')
        .boundingBox()
      const canonicalTitle = await main()
        .locator('[data-home-section-header] h2')
        .boundingBox()
      await shot('settings')
      let opener
      async function modalOpen(button, name) {
        opener = await button.elementHandle()
        await button.click()
        const dialog = page.getByRole('dialog', { name, exact: true })
        await dialog.waitFor()
        const opacity = await dialog.evaluate(
          (el) => getComputedStyle(el).opacity
        )
        assert(Number(opacity) < 1, 'enter starts transparent')
        await page.screenshot({
          path: path.join(
            output,
            `${width}-${name.replace(/[^a-zA-Z0-9-]/g, '_')}-entering.png`
          ),
        })
        await page.waitForTimeout(200)
        assert.equal(
          await dialog.evaluate((el) => getComputedStyle(el).opacity),
          '1'
        )
        assert.equal(
          await dialog.evaluate(
            (el) => getComputedStyle(el, '::backdrop').animationDuration
          ),
          '0.16s'
        )
        await page.screenshot({
          path: path.join(
            output,
            `${width}-${name.replace(/[^a-zA-Z0-9-]/g, '_')}-open.png`
          ),
        })
        return dialog
      }
      async function modalClose(dialog, name, escape = false) {
        if (escape === 'backdrop') await page.mouse.click(4, 4)
        else if (escape) await page.keyboard.press('Escape')
        else
          await dialog
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
        await page.waitForTimeout(65)
        assert.equal(await dialog.count(), 1, 'exit retains native modal')
        assert.equal(await dialog.getAttribute('data-exiting'), 'true')
        const opacity = Number(
          await dialog.evaluate((el) => getComputedStyle(el).opacity)
        )
        assert(opacity > 0 && opacity < 1, 'exit fades')
        await page.screenshot({
          path: path.join(output, `${width}-${name}-exiting.png`),
        })
        await dialog.waitFor({ state: 'detached' })
        assert(
          await opener.evaluate((el) => el === document.activeElement),
          'native modal restores opener focus'
        )
        await page.screenshot({
          path: path.join(output, `${width}-${name}-closed.png`),
        })
      }
      let dialog = await modalOpen(
        settings.getByRole('button', { name: 'Change username', exact: true }),
        'Change username'
      )
      await dialog
        .getByRole('textbox', { name: 'Username', exact: true })
        .fill('AnotherName')
      await page.waitForTimeout(500)
      assert(
        await dialog
          .getByRole('button', { name: 'Save', exact: true })
          .isEnabled()
      )
      await color(
        dialog.getByRole('button', { name: 'Save', exact: true }),
        'rgb(22, 101, 52)'
      )
      await surfaces(dialog, 'Username surfaces')
      await modalClose(dialog, 'username', true)
      dialog = await modalOpen(
        settings.getByRole('button', { name: 'Change password', exact: true }),
        'Change password'
      )
      for (const name of [
        'Current password',
        'New password',
        'Confirm new password',
      ])
        assert(await dialog.getByLabel(name, { exact: true }).count())
      assert(
        await dialog
          .getByRole('button', { name: 'Save', exact: true })
          .isDisabled()
      )
      await surfaces(dialog, 'Password surfaces')
      await modalClose(dialog, 'password', 'backdrop')
      dialog = await modalOpen(
        settings.getByRole('button', { name: 'Log out', exact: true }),
        'Log out?'
      )
      const logoutSurfaces = await surfaces(dialog, 'Logout surfaces')
      assert.equal(logoutSurfaces[0].color, 'rgb(118, 46, 60)')
      assert.equal(logoutSurfaces[1].color, 'rgb(119, 45, 64)')
      await modalClose(dialog, 'logout', true)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await settings
        .getByRole('button', { name: 'Change username', exact: true })
        .click()
      dialog = page.getByRole('dialog', {
        name: 'Change username',
        exact: true,
      })
      await dialog.waitFor()
      assert.equal(
        await dialog.evaluate((el) => getComputedStyle(el).animationName),
        'none'
      )
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await select('Listings', 'Favorites')
      const header = main().locator('[data-home-section-header]')
      assert.equal(
        (await header.boundingBox()).height,
        canonicalHeader.height,
        'Identical section header height'
      )
      const favoritesTitle = await header
        .getByRole('heading', { name: 'Favorites' })
        .boundingBox()
      assert.deepEqual(
        favoritesTitle && {
          x: favoritesTitle.x,
          y: favoritesTitle.y,
          height: favoritesTitle.height,
        },
        {
          x: canonicalTitle.x,
          y: canonicalTitle.y,
          height: canonicalTitle.height,
        },
        'Favorites uses the canonical title position'
      )
      const rects = await Promise.all([
        header.getByRole('heading', { name: 'Favorites' }).boundingBox(),
        header.getByRole('button', { name: 'Sort', exact: true }).boundingBox(),
        header
          .getByRole('button', { name: 'Filter', exact: true })
          .boundingBox(),
      ])
      assert(
        rects.every(
          (r) =>
            r.y < rects[0].y + rects[0].height && r.y + r.height > rects[0].y
        ),
        'one row'
      )
      await header.getByRole('button', { name: 'Sort', exact: true }).click()
      await page
        .getByRole('button', { name: 'Price: Low to High', exact: true })
        .click()
      await shot('favorites-header')
      assert(
        favoriteQueries.some((query) => query.includes('sort=price-asc')),
        'Sort stays inside Favorites endpoint'
      )
      await page.keyboard.press('Escape')
      await page
        .getByRole('region', { name: 'Sort options', exact: true })
        .waitFor({ state: 'detached' })
      await header.getByRole('button', { name: 'Filter', exact: true }).click()
      await page
        .getByRole('combobox', { name: 'Category', exact: true })
        .click()
      await page
        .getByRole('option', { name: 'Electronics', exact: true })
        .click()
      await page.getByRole('button', { name: 'Confirm', exact: true }).click()
      await settle()
      const filteredEmpty = main().locator('[data-workspace-empty]')
      assert(
        (await filteredEmpty.textContent()).includes(
          'No listings match your filters.'
        )
      )
      const centered = await filteredEmpty.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          range = document.createRange()
        range.selectNodeContents(el)
        const text = range.getBoundingClientRect()
        return [
          Math.abs(text.x + text.width / 2 - r.x - r.width / 2),
          Math.abs(text.y + text.height / 2 - r.y - r.height * 0.275),
        ]
      })
      assert(
        centered.every((error) => error < 2),
        'filtered message is 27.5% down remaining workspace'
      )
      await shot('filtered-empty')
      await select('Listings', 'Create Listing')
      const form = main().getByRole('form', {
        name: 'Create listing',
        exact: true,
      })
      const actionRow = form.locator('[data-action-row="three"]')
      assert.deepEqual(
        await actionRow
          .getByRole('button')
          .evaluateAll((buttons) =>
            buttons.map((button) =>
              button.dataset.state
                ? button.querySelector(':scope > span:not([aria-hidden])')
                    .textContent
                : button.textContent
            )
          ),
        desktop ? ['Cancel', 'Create'] : ['Cancel', 'Preview', 'Create']
      )
      assert.equal(await form.getByRole('button', { name: /Hold/ }).count(), 0)
      await surfaces(form, 'Create surfaces')
      const actionGeometry = await actionRow
        .getByRole('button')
        .evaluateAll((nodes) =>
          nodes.map((el) => {
            const r = el.getBoundingClientRect(),
              s = getComputedStyle(el)
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              radius: s.borderRadius,
              boxSizing: s.boxSizing,
              padding: s.padding,
              font: s.font,
            }
          })
        )
      console.log(
        width,
        'Create action geometry',
        JSON.stringify(actionGeometry)
      )
      for (const r of actionGeometry) {
        assert.equal(r.width, actionGeometry[0].width)
        assert.equal(r.y, actionGeometry[0].y)
        assert.equal(r.height, desktop ? 64 : 48)
        assert.equal(r.radius, actionGeometry[0].radius)
        assert.equal(r.boxSizing, 'border-box')
        assert.equal(r.padding, actionGeometry[0].padding)
        assert.equal(r.font, actionGeometry[0].font)
      }
      assert.equal(
        await actionRow
          .getByRole('button', { name: 'Create', exact: true })
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue('--surface').trim()
          ),
        '#166534'
      )
      if (desktop) {
        const allocation = await page
          .locator('[data-listing-builder="create"]')
          .evaluate((el) => {
            const left = el.querySelector('form').getBoundingClientRect()
            const right = el.querySelector('aside').getBoundingClientRect()
            return {
              left: left.width,
              right: right.width,
              transform: getComputedStyle(el.querySelector('form')).transform,
            }
          })
        assert(Math.abs(allocation.left / allocation.right - 9 / 11) < 0.01)
        assert.equal(allocation.transform, 'none')
        assert.equal(
          await form
            .getByRole('button', { name: 'Preview', exact: true })
            .count(),
          0
        )
        console.log(width, 'Form/Preview allocation', allocation)
      }
      await actionRow.scrollIntoViewIfNeeded()
      await shot('create-actions')
      const input = form.locator('input[type=file]'),
        action = form.locator('[data-slot="file-drop"] > label')
      let chooserCount = 0
      page.on('filechooser', () => chooserCount++)
      await form.getByText('Photos', { exact: true }).click()
      await form.locator('[data-active-photo]').click()
      await page.waitForTimeout(250)
      assert.equal(chooserCount, 0, 'presentation does not choose files')
      const picker = page.waitForEvent('filechooser')
      await action.click()
      await (
        await picker
      ).setFiles({
        name: 'first.jpg',
        mimeType: 'image/jpeg',
        buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
      })
      await settle()
      assert.equal(await form.locator('[data-selected-photos] img').count(), 1)
      assert.equal(
        await form.getByRole('button', { name: /Remove photo/ }).count(),
        0
      )
      const selected = form.locator('[data-selected-photos]')
      assert(
        await selected
          .getByRole('button', { name: 'Previous selected photo' })
          .isDisabled()
      )
      assert(
        await selected
          .getByRole('button', { name: 'Next selected photo' })
          .isDisabled()
      )
      const requirements = await form
          .locator('[data-photo-requirements]')
          .boundingBox(),
        selectedRect = await selected.boundingBox(),
        uploadRect = await action.boundingBox()
      assert(
        requirements.y >= uploadRect.y + uploadRect.height &&
          requirements.y + requirements.height <= selectedRect.y
      )
      assert.equal(
        await selected.locator('img[alt^="Selected"] ').getAttribute('alt'),
        'Selected photo 1'
      )
      await shot('one-photo', true)
      await input.setInputFiles([
        {
          name: 'second.jpg',
          mimeType: 'image/jpeg',
          buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
        },
        {
          name: 'extremely-long-selected-file-name-that-must-truncate-in-the-local-photo-viewer-and-not-overflow.jpg',
          mimeType: 'image/jpeg',
          buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
        },
      ])
      await selected
        .getByRole('button', { name: 'Next selected photo' })
        .click()
      assert.equal(
        await selected.locator('img[alt^="Selected"] ').getAttribute('alt'),
        'Selected photo 2'
      )
      await selected
        .getByRole('button', { name: 'Previous selected photo' })
        .click()
      assert.equal(
        await selected.locator('img[alt^="Selected"] ').getAttribute('alt'),
        'Selected photo 1'
      )
      await selected
        .getByRole('button', { name: 'Next selected photo' })
        .click()
      await selected
        .getByRole('button', { name: 'Discard', exact: true })
        .click()
      await settle()
      assert.equal(
        await selected.locator('img[alt^="Selected"] ').getAttribute('alt'),
        'Selected photo 2'
      )
      assert(!(await form.textContent()).includes('first.jpg'))
      assert.equal(await selected.locator(':scope > img').count(), 0)
      const discardButton = selected.getByRole('button', {
        name: 'Discard',
        exact: true,
      })
      assert((await discardButton.boundingBox()).width < 160)
      assert.equal(
        await discardButton.evaluate(
          (el) => getComputedStyle(el.parentElement).flexGrow
        ),
        '0'
      )
      assert(
        await selected
          .getByRole('button', { name: 'Next selected photo' })
          .isDisabled()
      )
      await selected
        .getByRole('button', { name: 'Previous selected photo' })
        .click()
      await shot('multi-photo', true)
      if (!desktop) {
        const previewAction = form.getByRole('button', {
          name: 'Preview',
          exact: true,
        })
        await color(previewAction, 'rgb(23, 59, 103)')
        await previewAction.evaluate((el) => {
          el.click()
          el.click()
        })
        assert.equal(await previewAction.getAttribute('aria-busy'), 'true')
        await page.waitForTimeout(100)
        assert.equal(
          await page.getByRole('dialog').count(),
          0,
          'callback waits 200ms'
        )
        const preview = page.getByRole('dialog')
        await preview.waitFor()
        assert.equal(await preview.count(), 1, 'duplicate activation blocked')
        await preview.locator('[data-slot="image-slider"]').waitFor()
        await shot('shared-preview')
        await preview
          .getByRole('button', { name: 'Close', exact: true })
          .click()
        await preview.waitFor({ state: 'detached' })
      }
      await selected
        .getByRole('button', { name: 'Discard', exact: true })
        .click()
      await settle()
      await selected
        .getByRole('button', { name: 'Discard', exact: true })
        .click()
      await settle()
      assert.equal(await selected.locator('img').count(), 0)
      assert.equal(await selected.getByText('No photos selected').count(), 1)
      assert(await form.getByRole('button', { name: /^Create$/ }).isDisabled())
      await form.locator('[name=title]').fill('Dirty local create')
      dialog = await modalOpen(
        form.getByRole('button', { name: 'Cancel', exact: true }),
        'Discard this listing?'
      )
      assert.equal(
        await dialog.getByRole('button', { name: 'Save', exact: true }).count(),
        0
      )
      await modalClose(dialog, 'create-discard')
      await form.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Discard', exact: true })
        .click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await select('Listings', 'My Listings')
      const article = main().getByRole('article', {
        name: 'Camera active',
        exact: true,
      })
      for (const pair of [
        ['Mark as sold', 'Mark this listing as sold?'],
        ['Delete', 'Delete this listing?'],
      ]) {
        dialog = await modalOpen(
          article.getByRole('button', { name: pair[0], exact: true }),
          pair[1]
        )
        await modalClose(dialog, pair[0])
      }
      await article.getByRole('button', { name: 'Edit', exact: true }).click()
      const edit = main().getByRole('form', {
        name: 'Edit listing',
        exact: true,
      })
      assert.equal(
        await edit
          .getByRole('button', { name: /Discard|selected photo/ })
          .count(),
        0
      )
      await edit.locator('[name=title]').fill('Updated title')
      dialog = await modalOpen(
        edit.getByRole('button', { name: 'Cancel', exact: true }),
        'Discard changes?'
      )
      for (const name of ['Cancel', 'Discard', 'Save'])
        assert.equal(
          await dialog.getByRole('button', { name, exact: true }).count(),
          1
        )
      await color(
        dialog.getByRole('button', { name: 'Save', exact: true }),
        'rgb(22, 101, 52)'
      )
      await surfaces(dialog, 'Dirty confirmation surfaces')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await dialog
        .getByRole('alert')
        .getByText('Save test failed', { exact: true })
        .waitFor()
      assert.equal(
        await edit.locator('[name=title]').inputValue(),
        'Updated title'
      )
      assert.equal(saves, 1)
      failSave = false
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      await main()
        .getByRole('article', { name: 'Updated title', exact: true })
        .waitFor()
      assert.equal(saves, 2)
      rows = []
      if (desktop)
        await page
          .getByRole('link', { name: 'Back to Market', exact: true })
          .click()
      else await page.getByRole('tab', { name: 'Market', exact: true }).click()
      await page.locator('[data-market-ready="true"]').waitFor()
      await page.locator('[data-route-source]').waitFor({ state: 'detached' })
      const marketEmpty = page.locator('[data-workspace-empty]')
      await marketEmpty.waitFor()
      assert(
        (await marketEmpty.textContent()).includes(
          'No listings match your filters.'
        )
      )
      const marketCenter = await marketEmpty.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          range = document.createRange()
        range.selectNodeContents(el)
        const text = range.getBoundingClientRect()
        return [
          Math.abs(text.x + text.width / 2 - r.x - r.width / 2),
          Math.abs(text.y + text.height / 2 - r.y - r.height * 0.275),
        ]
      })
      assert(marketCenter.every((error) => error < 2))
      await shot('market-filtered-empty')

      assert.deepEqual(writes, [])
      assert.deepEqual(errors, [])
      console.log(
        `${width} PASS photo manager, local chooser, shared preview, Favorites row/scope, Overview/Settings, native modal enter/exit/reduced motion, Edit real save failure/retry, Create no Draft`
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
