const { TEST_PICTURES } = require('../scripts/lib/test-pictures.cjs')
/* global window,document,getComputedStyle */
// Local Welcome prototypes only; real expandable Listing and PulseHeart primitives.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  cp = require('node:child_process')

async function checkOverlay(heart) {
  const actual = await heart.evaluate((el) => {
    const style = getComputedStyle(el),
      svg = getComputedStyle(el.querySelector('svg'))
    return {
      background: style.backgroundColor,
      blur: style.backdropFilter,
      stroke: svg.stroke,
      fill: svg.fill,
      liked: el.dataset.liked,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }
  })
  assert(
    ['rgba(25, 25, 25, 0.6)', 'rgba(25, 25, 25, 0.72)'].includes(
      actual.background
    )
  )
  assert.equal(actual.blur, 'blur(4px)')
  assert.equal(
    actual.stroke,
    actual.liked === 'true' ? 'rgb(217, 121, 145)' : 'rgb(250, 250, 250)'
  )
  assert.equal(actual.fill, actual.liked === 'true' ? actual.stroke : 'none')
  assert(actual.width >= 41 && actual.height >= 41)
}

const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'landing-link.tsx'),
  `import React from 'react';export const Link=props=><a {...props}/>;`
)
aliases['@ui/link/link'] = path.join(root, 'landing-link.tsx')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {HomepageListingDemo} from '@/components/listings/homepage-listing-demo';import {HomepageShopDemo} from '@/components/listings/homepage-shop-demo';window.actions=[];window.requests=[];createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation}><HomepageListingDemo/><HomepageShopDemo/></LazyMotion>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#fff;font-family:Arial}html{scrollbar-gutter:stable}</style><div id="root"></div><script src="bundle.js"></script>'
)
const head = (file) =>
  cp.execFileSync('git', ['show', 'HEAD:' + file]).toString()
for (const file of [
  'components/listings/market-listing-feed.tsx',
  'components/listings/homepage-listing-demo.module.css',
])
  assert.equal(
    fs.readFileSync(file, 'utf8').replaceAll('\r', ''),
    head(file).replaceAll('\r', ''),
    'shared component/layout untouched ' + file
  )
for (const file of ['components/listings/homepage-listing-demo.tsx']) {
  const extract = (s) =>
    s.slice(
      s.indexOf(
        '        <motion.div\n          ',
        s.indexOf('data-demo-enter="card"')
      )
    )
  assert.equal(
    extract(fs.readFileSync(file, 'utf8').replaceAll('\r', '')),
    extract(head(file).replaceAll('\r', '')),
    'right video JSX byte-equivalent ' + file
  )
}
const shopVideo = (s) =>
  s
    .replaceAll('\r', '')
    .match(/<div\s+className=\{styles.videoSlot\}[\s\S]*?<\/div>/)[0]
assert.equal(
  shopVideo(
    fs.readFileSync('components/listings/homepage-shop-demo.tsx', 'utf8')
  ),
  shopVideo(head('components/listings/homepage-shop-demo.tsx')),
  'Shop video surface unchanged'
)
async function run() {
  await build(aliases)
  fs.unlinkSync(path.join(root, 'entry.tsx'))
  fs.unlinkSync(path.join(root, 'landing-link.tsx'))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reducedMotion of ['reduce', 'no-preference']) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion,
        })
        p.setDefaultTimeout(7000)
        let network = 0
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (r) => {
          const u = new URL(r.request().url())
          if (u.origin === 'http://localhost:4177') {
            if (u.pathname === '/')
              return r.fulfill({
                path: path.join(root, 'index.html'),
                contentType: 'text/html',
              })
            if (u.pathname === '/bundle.js')
              return r.fulfill({
                path: path.join(root, 'bundle.js'),
                contentType: 'application/javascript',
              })
            if (
              [TEST_PICTURES.chair, TEST_PICTURES.jewelry].includes(u.pathname)
            )
              return r.fulfill({
                path: 'public' + u.pathname,
                contentType: 'image/webp',
              })
          }
          network++
          return r.abort()
        })
        await p.goto('http://localhost:4177/')
        const listing = p.locator('[data-home-section="listing-demo"]'),
          shop = p.locator('[data-home-section="shop-demo"]')
        await listing.scrollIntoViewIfNeeded()
        await p.waitForTimeout(850)
        const trigger = listing.getByRole('button', {
          name: /Open example listing/,
        })
        await trigger.waitFor()
        assert((await trigger.textContent()).includes('CA$45'))
        assert((await trigger.textContent()).includes('Wooden accent chair'))
        assert((await trigger.textContent()).includes('Good'))
        assert((await trigger.textContent()).includes('Home & Living'))
        assert(!(await listing.textContent()).includes('Used for about a year'))
        const heart = listing.getByRole('button', {
          name: /demo listing$/,
        })
        await checkOverlay(heart)
        await heart.click()
        assert.equal(await heart.getAttribute('aria-pressed'), 'true')
        assert.equal(
          await p.getByRole('dialog').count(),
          0,
          'heart never opens Listing'
        )
        await p.waitForTimeout(650)
        await checkOverlay(heart)
        await listing
          .getByRole('button', {
            name: 'Unfavorite demo listing',
            exact: true,
          })
          .click()
        assert.equal(await heart.getAttribute('aria-pressed'), 'false')
        const typography = await trigger.evaluate((el) => {
          const rows = el.querySelectorAll('span:last-child > span > span')
          return [...rows].map((e) => ({
            text: e.textContent,
            font: getComputedStyle(e).fontSize,
            weight: getComputedStyle(e).fontWeight,
          }))
        })
        assert(
          typography.some(
            (x) => x.text === 'CA$45' && x.font === '30px' && x.weight === '750'
          )
        )
        assert(
          typography.some(
            (x) => x.text === 'Wooden accent chair' && x.font === '23px'
          )
        )
        assert(
          typography.some((x) => x.text.includes('Good') && x.font === '18px')
        )
        const collapsed = await trigger.evaluate((el) => {
          const image = el.firstElementChild,
            summary = el.querySelector('span:last-child')
          return {
            background: getComputedStyle(el).backgroundColor,
            border: getComputedStyle(el).borderWidth,
            color: getComputedStyle(el).color,
            radius: getComputedStyle(image).borderTopLeftRadius,
            summaryBackground: getComputedStyle(summary).backgroundColor,
          }
        })
        assert.equal(collapsed.background, 'rgba(0, 0, 0, 0)')
        assert.equal(collapsed.border, '0px')
        assert.equal(collapsed.radius, '16px')
        assert.equal(collapsed.summaryBackground, 'rgba(0, 0, 0, 0)')
        await p.evaluate(() => {
          window.radiusFrames = []
          window.trackRadius = true
          const sample = () => {
            if (!window.trackRadius) return
            for (const el of document.querySelectorAll(
              '[data-slot="listing-overlay"] [role="dialog"] > div:first-child > div:first-child,[data-slot="returning-media"]'
            )) {
              const r = el.getBoundingClientRect(),
                css = getComputedStyle(el),
                parts = css.borderTopLeftRadius.split(' '),
                x = parts[0],
                y = parts[1] || x
              if (r.width > 0 && r.height > 0)
                window.radiusFrames.push({
                  x: x.endsWith('%')
                    ? (parseFloat(x) * r.width) / 100
                    : (parseFloat(x) * r.width) / el.offsetWidth,
                  y: y.endsWith('%')
                    ? (parseFloat(y) * r.height) / 100
                    : (parseFloat(y) * r.height) / el.offsetHeight,
                  css: css.borderTopLeftRadius,
                  transform: css.transform,
                })
            }
            window.requestAnimationFrame(sample)
          }
          window.requestAnimationFrame(sample)
        })
        await trigger.click()
        const dialog = p.getByRole('dialog', {
          name: 'Wooden accent chair',
          exact: true,
        })
        await dialog.waitFor()
        await p.waitForTimeout(600)
        assert((await dialog.textContent()).includes('Used for about a year'))
        const groups = await dialog
          .locator('section[aria-label]')
          .evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')))
        assert.deepEqual(groups, [
          'Seller',
          'Item details',
          'Description',
          'Exchange preferences',
        ])
        for (const text of [
          'Furniture',
          'UU Pay',
          'Meeting',
          'Western University',
        ])
          assert((await dialog.textContent()).includes(text))
        assert.equal(
          await dialog.evaluate(
            (el) => getComputedStyle(el).borderTopLeftRadius
          ),
          '16px'
        )
        await checkOverlay(
          dialog.getByRole('button', { name: 'Add to favorites', exact: true })
        )
        const heartBox = await dialog
            .getByRole('button', { name: 'Add to favorites', exact: true })
            .boundingBox(),
          dialogBox = await dialog.boundingBox(),
          mediaBox = await dialog
            .locator(':scope > div:first-child > div:first-child')
            .boundingBox()
        assert(
          Math.abs(
            mediaBox.width / mediaBox.height - (width < 768 ? 4 / 3 : 4 / 5)
          ) < 0.01,
          'original expanded media proportion'
        )
        assert(
          heartBox.x > dialogBox.x + dialogBox.width / 2 &&
            heartBox.y < dialogBox.y + 70,
          'expanded heart upper-right'
        )
        assert.equal(
          await dialog
            .locator('img')
            .first()
            .evaluate((el) => getComputedStyle(el).objectFit),
          'cover'
        )
        assert(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
          'expanded no horizontal overflow'
        )
        const actions = await dialog.evaluate((el) => {
          const buttons = [...el.querySelectorAll('button')],
            close = buttons.find((e) => e.textContent === 'Close'),
            contact = buttons.find((e) =>
              e.textContent.includes('Contact seller')
            )
          return {
            close: close.getBoundingClientRect().toJSON(),
            contact: contact.getBoundingClientRect().toJSON(),
            dialog: el.getBoundingClientRect().toJSON(),
          }
        })
        assert(actions.close.x < actions.contact.x, 'Close left/Contact right')
        assert(
          actions.contact.bottom <= actions.dialog.bottom,
          'actions remain reachable within card'
        )
        if (reducedMotion === 'reduce')
          await dialog.screenshot({
            path: 'tests/artifacts/welcome-listing-expanded-' + width + '.png',
          })
        assert((await dialog.textContent()).includes('Description'))
        assert((await dialog.textContent()).includes('Good'))
        assert((await dialog.textContent()).includes('Home & Living'))
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Contact seller', exact: true })
            .count(),
          1,
          'existing detail content/action preserved'
        )
        await dialog
          .getByRole('button', { name: 'Add to favorites', exact: true })
          .click()
        await p.waitForTimeout(650)
        assert.equal(
          await dialog
            .getByRole('button', {
              name: 'Remove from favorites',
              exact: true,
            })
            .getAttribute('aria-pressed'),
          'true'
        )
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
        await p.waitForTimeout(700)
        assert.equal(
          await listing
            .getByRole('button', {
              name: 'Unfavorite demo listing',
              exact: true,
            })
            .getAttribute('aria-pressed'),
          'true',
          'heart state shared between compact and expanded'
        )
        const frames = await p.evaluate(() => {
          window.trackRadius = false
          return window.radiusFrames
        })
        assert(
          frames.length > 0,
          'sample radius during shared-layout enter and return'
        )
        const bad = frames.filter(
          (f) => Math.abs(f.x - 16) > 1 || Math.abs(f.y - 16) > 1
        )
        assert.equal(
          bad.length,
          0,
          'visual corner remains 16px across animation: ' +
            JSON.stringify(bad.slice(0, 3))
        )
        await shop.scrollIntoViewIfNeeded()
        await p.waitForTimeout(850)
        const card = shop.getByRole('article', {
          name: 'Luna Studio demo shop',
          exact: true,
        })
        assert.equal(
          await shop.locator('[data-slot="expandable-card"]').count(),
          0,
          'Shop never expands'
        )
        for (const copy of [
          'Luna Studio',
          'Handmade jewelry & accessories',
          'Western email verified',
          '4.9',
          '24 reviews',
          '68 items sold',
          'Illustrative demo figures',
        ])
          assert((await card.textContent()).includes(copy))
        assert.equal(await card.locator('a').count(), 0)
        await p.waitForFunction(
          () =>
            document.querySelector('[data-welcome-shop-card] img')
              ?.naturalWidth > 0
        )
        const shopStyle = await card.evaluate((el) => {
          const media = el.firstElementChild,
            c = el.getBoundingClientRect(),
            m = media.getBoundingClientRect(),
            button = el.querySelector(
              'button[aria-label="Go to shop (demo only)"]'
            ),
            b = button.getBoundingClientRect()
          return {
            bg: getComputedStyle(el).backgroundColor,
            radius: getComputedStyle(el).borderRadius,
            ratio: m.width / m.height,
            fraction: m.height / c.height,
            fit: getComputedStyle(media.querySelector('img')).objectFit,
            title: getComputedStyle(el.querySelector('h3')).fontSize,
            ctaHeight: b.height,
            ctaWidth: b.width,
            infoWidth: button.parentElement.clientWidth,
            hasArrow: !!button.querySelector('svg'),
          }
        })
        assert.equal(shopStyle.bg, 'rgb(27, 21, 35)')
        assert.equal(shopStyle.radius, '16px')
        if (width < 768) {
          assert(Math.abs(shopStyle.ratio - 1) < 0.01)
          assert(
            shopStyle.fraction > 0.5 && shopStyle.fraction < 0.68,
            'mobile card unchanged'
          )
        }
        assert.equal(
          await shop
            .getByRole('heading', {
              name: 'Create your own storefront',
              exact: true,
            })
            .count(),
          1
        )
        assert.equal(
          await shop
            .getByText(
              'See how to set up your Shop, organize listings, and bring everything together in one place.',
              { exact: true }
            )
            .count(),
          1
        )
        assert.equal(
          await shop
            .getByText('Tutorial video coming soon.', { exact: true })
            .count(),
          1
        )
        assert.equal(shopStyle.fit, 'cover')
        assert.equal(shopStyle.title, '28px')
        assert(shopStyle.ctaHeight >= 52 && shopStyle.hasArrow)
        assert(
          Math.abs(shopStyle.ctaWidth - (shopStyle.infoWidth - 44)) < 1,
          'CTA fills padded content width'
        )
        await card.locator('img').click()
        assert.equal(
          await p.getByRole('dialog').count(),
          0,
          'Shop image does not expand'
        )
        console.log('SHOP', width, reducedMotion, JSON.stringify(shopStyle))

        assert.equal(
          await card.locator('img').getAttribute('src'),
          TEST_PICTURES.jewelry
        )
        await card
          .getByRole('button', { name: 'Favorite demo shop', exact: true })
          .click()
        assert.equal(
          await card
            .getByRole('button', {
              name: 'Unfavorite demo shop',
              exact: true,
            })
            .getAttribute('aria-pressed'),
          'true'
        )
        await p.waitForTimeout(650)
        await card
          .getByRole('button', { name: 'Unfavorite demo shop', exact: true })
          .focus()
        await p.keyboard.press('Space')
        assert.equal(
          await card
            .getByRole('button', { name: 'Favorite demo shop', exact: true })
            .getAttribute('aria-pressed'),
          'false'
        )
        await card
          .getByRole('button', {
            name: 'Go to shop (demo only)',
            exact: true,
          })
          .click()
        assert.equal(await p.getByRole('dialog').count(), 0)
        assert.equal(new URL(p.url()).pathname, '/')
        for (const section of [listing, shop]) {
          await section.scrollIntoViewIfNeeded()
          await p.waitForTimeout(150)
          const geo = await section.evaluate((el) => {
            const box = (e) => e.getBoundingClientRect().toJSON()
            const card = el.querySelector('[data-demo-enter="card"]'),
              image =
                card.querySelector(
                  '[data-slot="expandable-card"] > span:first-child'
                ) || card.querySelector('article > div:first-child')
            return {
              card: box(card),
              image: box(image),
              heart: box(card.querySelector('button[aria-pressed]')),
              video: box(el.querySelector('[data-demo-enter="video"]')),
              slot: box(el.querySelector('[aria-label$="video placeholder"]')),
              caption: el.querySelector('[data-demo-enter="video"]')
                .textContent,
              slotCSS: {
                bg: getComputedStyle(
                  el.querySelector('[aria-label$="video placeholder"]')
                ).backgroundColor,
                radius: getComputedStyle(
                  el.querySelector('[aria-label$="video placeholder"]')
                ).borderRadius,
              },
            }
          })
          assert(
            geo.heart.width >= 44 && geo.heart.height >= 44,
            'heart touch target'
          )
          assert(
            geo.heart.x >= geo.image.x &&
              geo.heart.x + geo.heart.width <= geo.image.right,
            'heart inside image right'
          )
          assert(
            geo.heart.y >= geo.image.y && geo.heart.y < geo.image.y + 30,
            'heart top-right'
          )
          if (
            (await section.getAttribute('data-home-section')) === 'listing-demo'
          ) {
            assert(
              Math.abs(geo.image.width / geo.image.height - 1) < 0.01,
              'collapsed media square'
            )
            assert(
              Math.abs(geo.heart.y - geo.image.y - 12) < 1,
              'collapsed heart top inset'
            )
            assert(
              Math.abs(geo.image.right - geo.heart.x - geo.heart.width - 12) <
                1,
              'collapsed heart right inset'
            )
            assert.equal(
              await section
                .locator('img')
                .first()
                .evaluate((el) => getComputedStyle(el).objectFit),
              'cover'
            )
          }
          assert(Math.abs(geo.slot.width / geo.slot.height - 16 / 9) < 0.01)
          assert.equal(geo.slotCSS.radius, '16px')
          assert.equal(geo.slotCSS.bg, 'rgba(28, 19, 38, 0.8)')
          assert(geo.caption.includes('Tutorial video coming soon.'))
          if (width < 768) assert(geo.video.y >= geo.card.bottom + 35)
          else {
            assert(geo.video.x > geo.card.right)
            if (
              (await section.getAttribute('data-home-section')) ===
              'listing-demo'
            ) {
              assert(
                Math.abs(geo.image.y - geo.slot.y) < 0.5,
                'Listing/video top aligned'
              )
              assert(
                Math.abs(geo.image.height - geo.slot.height) < 0.5,
                'square Listing matches unchanged video height'
              )
              const previousVideoHeights = {
                820: 225.53125,
                1280: 357.84375,
                1536: 355.3125,
              }
              assert(
                Math.abs(geo.slot.height - previousVideoHeights[width]) < 0.5,
                'video reference height unchanged'
              )
              console.log(
                'MEDIA',
                width,
                reducedMotion,
                JSON.stringify({ image: geo.image, video: geo.slot })
              )
            } else {
              assert(
                Math.abs(geo.image.y - geo.slot.y) < 0.5,
                'Shop/video media tops align'
              )
              assert(
                Math.abs(geo.image.height - geo.slot.height) < 0.5,
                'Shop/video media heights match'
              )
              assert(
                Math.abs(geo.card.y - geo.video.y) < 0.5,
                'Shop columns top align'
              )
              const originalHeights = {
                820: 225.53125,
                1280: 357.84375,
                1536: 355.3125,
              }
              assert(
                Math.abs(geo.slot.height - originalHeights[width]) < 0.5,
                'video reference geometry preserved'
              )
              console.log(
                'SHOP MEDIA',
                width,
                reducedMotion,
                JSON.stringify({ image: geo.image, video: geo.slot })
              )
            }
          }
          if (reducedMotion === 'reduce')
            await section.screenshot({
              path:
                'tests/artifacts/welcome-card-' +
                width +
                '-' +
                (await section.getAttribute('data-home-section')) +
                '.png',
            })
        }
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        assert.deepEqual(await p.evaluate(() => window.requests), [])
        assert.deepEqual(errors, [])
        assert.equal(network, 0)
        console.log(
          'PASS',
          width,
          reducedMotion,
          'Listing hierarchy/reveal/hearts; Shop fixed/demo stats/no-op CTA; unchanged video JSX/styles, responsive/no overflow/no API'
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
