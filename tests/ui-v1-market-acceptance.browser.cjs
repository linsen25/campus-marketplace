const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
// Actual local staging-backed page. All non-GET API requests are blocked.
async function main() {
  const expected = {
    project_ref: 'pcaqxezdfxofysghssyo',
    listings: [
      {
        id: '5e1234d0-0f67-4af1-a036-0c18e4a8693a',
        title: 'Desk Lamp',
        status: 'available',
      },
      {
        id: '82680659-1f93-405c-a0b6-cebe52011498',
        title: 'Books Collection',
        status: 'available',
      },
      {
        id: '90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60',
        title: 'Laptop Workspace',
        status: 'available',
      },
      {
        id: 'cbbc071e-4ea5-447e-b048-e700187234f9',
        title: 'Desktop Monitor',
        status: 'available',
      },
      {
        id: 'd5fcc2b1-2369-4757-b604-cd98f1f0e650',
        title: 'Canvas Sneakers',
        status: 'pending',
      },
      {
        id: 'f0629930-524c-452c-91e4-c47a3a231ae6',
        title: 'Game Controller',
        status: 'available',
      },
    ],
    uploads: [
      {
        new_path:
          '2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/5e1234d0-0f67-4af1-a036-0c18e4a8693a/a9df6c31-3fea-5d47-af88-fc3983e9eff3',
      },
      {
        new_path:
          'eb0fc272-b774-4253-af20-dd53713222a0/82680659-1f93-405c-a0b6-cebe52011498/566acd2e-2c35-5a9a-8d23-709cf027fc1f',
      },
      {
        new_path:
          '2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60/70b98526-6bd6-57bd-b412-aa1dbc3c64bd',
      },
      {
        new_path:
          '2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60/a5f68cb2-c6d7-5c72-985a-bff129e43700',
      },
      {
        new_path:
          'eb0fc272-b774-4253-af20-dd53713222a0/cbbc071e-4ea5-447e-b048-e700187234f9/ef1c35cf-f05f-5756-82d4-2c5c8c413fae',
      },
      {
        new_path:
          '2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/d5fcc2b1-2369-4757-b604-cd98f1f0e650/d171cd7a-e2af-5104-9f3a-50aa81da88a0',
      },
      {
        new_path:
          'eb0fc272-b774-4253-af20-dd53713222a0/f0629930-524c-452c-91e4-c47a3a231ae6/b38b1581-6bc3-5878-84b6-9bd34ec04fa5',
      },
    ],
  }
  assert.equal(expected.project_ref, 'pcaqxezdfxofysghssyo')
  const output = path.resolve('tests/artifacts/ui-v1-acceptance')
  fs.mkdirSync(output, { recursive: true })
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const evidence = []
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      })
      const blocked = []
      await page.route('**/*', (route) => {
        const r = route.request(),
          u = new URL(r.url())
        if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname))
          return route.abort()
        if (
          u.hostname !== 'localhost' &&
          u.hostname !== 'pcaqxezdfxofysghssyo.supabase.co'
        )
          return route.abort()
        if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
          blocked.push({ method: r.method(), path: u.pathname })
          return route.fulfill({
            status: 409,
            json: { error: 'Read-only UI acceptance; write blocked' },
          })
        }
        return route.continue()
      })
      await page.goto('http://localhost:3000/listings', {
        waitUntil: 'networkidle',
        timeout: 120000,
      })
      await page.waitForSelector('[data-market-ready="true"]', {
        timeout: 60000,
      })
      for (const item of expected.listings.filter(
        (x) => x.status === 'available'
      )) {
        const image = page.getByAltText(item.title, { exact: true }).first()
        await image.scrollIntoViewIfNeeded()
        await image.evaluate((i) => i.decode())
        const src = await image.getAttribute('src')
        const upload = expected.uploads.find((x) => src.endsWith(x.new_path))
        assert(upload, 'Expected migrated URL')
        await image.click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        await dialog
          .locator('img')
          .first()
          .evaluate((i) => i.decode())
        assert(
          (await dialog.locator('img').first().getAttribute('src')).endsWith(
            upload.new_path
          )
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Message Seller', exact: true })
            .count(),
          1
        )
        assert.equal(
          await dialog.getByRole('button', { name: /Make Offer/i }).count(),
          0,
          'Anonymous viewers keep the existing authenticated Offer gate'
        )
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
      }
      const geometry = await page
        .locator('[data-market-card]')
        .first()
        .evaluate((n) => ({
          columns: getComputedStyle(n.parentElement).gridTemplateColumns.split(
            ' '
          ).length,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }))
      assert.equal(geometry.columns, width >= 1024 ? 5 : width >= 640 ? 3 : 2)
      assert(!geometry.overflow)
      await page.getByRole('button', { name: 'Filter', exact: true }).click()
      await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Confirm', exact: true }).click()
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({
        path: path.join(output, 'actual-resale-' + width + '.png'),
        fullPage: true,
      })
      evidence.push({
        width,
        ...geometry,
        blockedWrites: blocked,
        verifiedTitles: expected.listings
          .filter((x) => x.status === 'available')
          .map((x) => x.title),
      })
      console.log(
        'PASS actual localhost Market ' +
          width +
          ': persisted migrated photos, expanded buyer actions, ' +
          geometry.columns +
          ' columns, Filter, no overflow; writes blocked'
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(
    path.join(output, 'actual-market-evidence.json'),
    JSON.stringify(evidence, null, 2)
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
