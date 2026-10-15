// Actual Gallery/ImageSlider/FadingDialog, synthetic aspect ratios, no network.
/* global window, document, getComputedStyle, requestAnimationFrame */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const source = fs.readFileSync(
  path.join(__dirname, 'message-image-actions.browser.cjs'),
  'utf8'
)
const { root, build, aliases } = new Function(
  'require',
  source.slice(0, source.indexOf('async function run()')) +
    '\nreturn {root,build,aliases}'
)(require)
let entry = fs.readFileSync(path.join(root, 'entry.tsx'), 'utf8')
entry = entry.replace(
  'previewUrl:img',
  `previewUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+[[400,500],[1200,800],[400,400],[100,1000],[2000,100],[402,400]][i][0]+'" height="'+[[400,500],[1200,800],[400,400],[100,1000],[2000,100],[402,400]][i][1]+'"><rect width="100%" height="100%" fill="purple"/></svg>')`
)
entry += `
import {ImageSlider} from '@/components/velora/image-slider';window.showDefault=()=>flushSync(()=>root.render(<LazyMotion features={domAnimation}><div data-default style={{width:300,height:400}}><ImageSlider images={window.messageFixtures[0].images.map(i=>({src:i.previewUrl,alt:i.name}))} autoplay={false}/></div></LazyMotion>));`
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
async function run() {
  await build(aliases)
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let cases = 0
  try {
    for (const motion of ['reduce', 'no-preference'])
      for (const width of [390, 430, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: motion,
        })
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route(/^https?:/, (r) => r.abort())
        await p.addInitScript(() => (window.process = { env: {} }))
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await p.evaluate(() => window.show({ own: true, count: 6 }))
        await p.locator('[data-expanded="false"] button').last().click()
        await p.locator('[data-expanded="true"]').waitFor()
        await p.waitForTimeout(700)
        const gallery = p.locator('[data-expanded="true"]')
        await gallery
          .locator('img')
          .evaluateAll((nodes) => Promise.all(nodes.map((i) => i.decode())))
        await p.evaluate(
          () =>
            (window.galleryNode = document.querySelector(
              '[data-expanded="true"]'
            ))
        )
        const scroll = await gallery.evaluate(
          (e) => e.closest('[data-message-history]').scrollTop
        )
        await gallery.getByRole('button', { name: 'View photo 3 of 6' }).click()
        const viewer = p.getByRole('dialog', { name: 'Full image viewer' })
        await viewer.waitFor()
        await viewer
          .getByRole('group', { name: '3 of 6', exact: true })
          .waitFor()
        assert.equal(
          await viewer
            .getByRole('button', { name: 'Back to gallery', exact: true })
            .locator('svg')
            .count(),
          1
        )
        assert(
          !/[?\uFFFD]/.test(
            await viewer
              .getByRole('button', { name: 'Back to gallery', exact: true })
              .innerText()
          )
        )
        assert.equal(
          await viewer.getByRole('button', { name: /Go to slide/ }).count(),
          6
        )
        const ratios = [0.8, 1.5, 1, 0.6, 1.8, 1.005]
        for (const index of [2, 5, 3, 4, 0, 1]) {
          const current = await viewer
            .locator('[class*="viewerMedia"]')
            .boundingBox()
          await p.evaluate((index) => {
            window.resizeFrames = []
            let count = 0
            const sample = () => {
              const media = document.querySelector('[class*="viewerMedia"]')
              if (!media) return
              const r = media.getBoundingClientRect()
              window.resizeFrames.push({ width: r.width, height: r.height })
              if (++count < 20) requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
            document
              .querySelector('[aria-label="Go to slide ' + (index + 1) + '"]')
              .click()
          }, index)
          await viewer
            .getByRole('group', { name: index + 1 + ' of 6', exact: true })
            .waitFor()
          await p.waitForTimeout(motion === 'reduce' ? 30 : 300)
          const media = viewer.locator('[class*="viewerMedia"]'),
            r = await media.boundingBox(),
            ratio = index === 5 ? 1 : ratios[index]
          const maxW = width < 1024 ? width - 32 : Math.min(920, width * 0.72),
            maxH = width < 1024 ? 630 : 684
          assert(
            Math.abs(r.width - Math.min(maxW, maxH * ratio)) < 1,
            JSON.stringify({ width, index, r, ratio, maxW, maxH })
          )
          assert(Math.abs(r.height - Math.min(maxH, maxW / ratio)) < 1)
          assert(
            r.x >= 0 &&
              r.x + r.width <= width &&
              r.y >= 0 &&
              r.y + r.height <= 900
          )
          const frames = await p.evaluate(() => window.resizeFrames)
          if (
            motion === 'no-preference' &&
            (Math.abs(current.width - r.width) > 8 ||
              Math.abs(current.height - r.height) > 8)
          ) {
            assert(
              frames.some(
                (f) =>
                  (f.width > Math.min(current.width, r.width) + 1 &&
                    f.width < Math.max(current.width, r.width) - 1) ||
                  (f.height > Math.min(current.height, r.height) + 1 &&
                    f.height < Math.max(current.height, r.height) - 1)
              ),
              'Frame resize has intermediate browser geometry, not a snap'
            )
          }
          if (index === 5) {
            assert.equal(r.width, current.width)
            assert.equal(r.height, current.height)
          }
          const css = await media.evaluate((e) => ({
            transition: getComputedStyle(e).transitionDuration,
            border: getComputedStyle(e).borderTopColor,
            padding: getComputedStyle(e).padding,
          }))
          assert.equal(
            css.transition,
            motion === 'reduce' ? '0s' : '0.18s, 0.18s'
          )
          assert.equal(css.border, 'rgb(255, 255, 255)')
          assert.equal(css.padding, '0px')
          const slide = viewer.getByRole('group', {
            name: index + 1 + ' of 6',
            exact: true,
          })
          assert.equal(
            await slide
              .locator('img')
              .evaluate((e) => getComputedStyle(e).objectFit),
            'contain'
          )
          assert(
            ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(
              await slide.evaluate((e) => getComputedStyle(e).transform)
            )
          )
          const next = await viewer
              .getByRole('button', { name: 'Next slide', exact: true })
              .boundingBox(),
            prev = await viewer
              .getByRole('button', { name: 'Previous slide', exact: true })
              .boundingBox()
          assert(Math.abs(prev.x - r.x - (width < 640 ? 13 : 17)) < 1)
          assert(
            Math.abs(
              r.x + r.width - next.x - next.width - (width < 640 ? 13 : 17)
            ) < 1
          )
          assert.equal(
            await viewer
              .getByRole('button', {
                name: 'Go to slide ' + (index + 1),
                exact: true,
              })
              .getAttribute('aria-current'),
            'true'
          )
          cases++
        }
        assert.equal(
          await viewer.evaluate((e) => getComputedStyle(e).backgroundColor),
          'rgba(0, 0, 0, 0)'
        )
        assert.equal(await viewer.locator('h1,h2,h3,dl').count(), 0)
        assert.equal(await p.getByRole('menu').count(), 0)
        await viewer
          .getByRole('button', { name: 'Back to gallery', exact: true })
          .click()
        await viewer.waitFor({ state: 'detached' })
        assert(await gallery.evaluate((e) => e === window.galleryNode))
        assert.equal(await gallery.locator('img').count(), 6)
        assert.equal(
          await gallery.evaluate(
            (e) => e.closest('[data-message-history]').scrollTop
          ),
          scroll
        )
        assert.equal(
          await gallery
            .locator('img')
            .first()
            .evaluate((e) => getComputedStyle(e).objectFit),
          'cover'
        )
        await gallery.getByRole('button', { name: 'Go back to chat' }).click()
        await p.locator('[data-expanded="false"]').waitFor()
        assert.equal(await p.evaluate(() => window.mockWrites), 0)
        await p.evaluate(() => window.showDefault())
        const defaultSlider = p.locator('[data-default]')
        await defaultSlider
          .getByRole('button', { name: 'Next slide', exact: true })
          .click()
        const defaultSlide = defaultSlider.getByRole('group', {
          name: '2 of 6',
          exact: true,
        })
        await defaultSlide.waitFor()
        assert.equal(
          await defaultSlide
            .locator('img')
            .evaluate((e) => getComputedStyle(e).objectFit),
          'cover'
        )
        if (motion === 'no-preference') {
          const transform = await defaultSlide.evaluate(
            (e) => getComputedStyle(e).transform
          )
          assert(
            transform.startsWith('matrix(') &&
              Number(transform.slice(7).split(',')[0]) > 1,
            'Default Listing-style scale transition preserved'
          )
        }
        assert.deepEqual(errors, [])
        console.log(
          'PASS ' +
            width +
            '/' +
            motion +
            ': selected index, six bounded aspect ratios, tiny-ratio stability, contain/cover, fade-only slider, arrows/pagination, SVG Back, preserved Gallery; zero writes.'
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
  console.log('PASS ' + cases + ' adaptive viewer geometry cases')
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
