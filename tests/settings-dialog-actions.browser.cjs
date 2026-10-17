/* global window, document, getComputedStyle */
// Settings dialogs with real UI/components; all persistence is an in-memory fixture.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'settings-empty.jsx'),
  'export function NotificationSettings(){return <section aria-label="Notifications">Notification preferences</section>};export function Link(){return null}'
)
aliases['@/components/notifications/notification-settings'] = path.join(
  root,
  'settings-empty.jsx'
)
aliases['@ui/link/link'] = path.join(root, 'settings-empty.jsx')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {ProfileOverview} from '@/components/home/profile-overview';import {SettingsLogout} from '@/components/home/settings-logout';
window.actions=[];window.avatarSaves=0;window.usernameSaves=0;window.logoutCalls=0;window.reveals=0;window.capabilities={paymentMethod:{status:'unset'},payoutAccount:{status:'unset'}};
window.fixtureRequest=async(url,method,input)=>{if(url==='/api/profile/account')return {username:'Fixture',email:'fixture@uwo.ca',emailVerified:true,createdAt:'2026-10-01',nextUsernameChangeAt:null};if(url.startsWith('/api/auth/username-availability'))return {available:true};if(url==='/api/profile/username'){window.usernameSaves++;return {username:input.username,next_change_allowed_at:null}}throw Error('Unexpected request '+url)};
window.process={env:{}};document.body.style.background='#160f1d';document.body.style.color='white';createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation}><ProfileOverview settings onAvatarSave={()=>window.avatarSaves++} sessionAction={<SettingsLogout onConfirm={async()=>{window.logoutCalls++;if(window.logoutFails){window.logoutFails=false;throw Error('Controlled sign-out failure')}await new Promise(r=>window.finishLogout=r);return ()=>window.reveals++}}/>}/></LazyMotion>);
`
)
async function main() {
  await build(aliases)
  for (const name of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, name))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = []
      let network = 0
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => {
        network++
        return r.abort()
      })
      await p.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await p.waitForFunction(() => !document.querySelector('button')?.disabled)
      const actionNames = [
        'Set avatar',
        'Change username',
        'Change password',
        'Log out',
        'Change payment method',
        'Manage payouts',
      ]
      const geometry = []
      for (const name of actionNames) {
        const button = p.getByRole('button', { name, exact: true })
        await button.waitFor()
        assert(
          (await button.getAttribute('class')).includes(
            'stateful_button_module_css_button'
          ),
          name + ' uses payment setup component'
        )
        assert.equal(await button.locator('.shining-button__arrow').count(), 0)
        const style = await button.evaluate((n) => {
          const s = getComputedStyle(n)
          return {
            height: n.getBoundingClientRect().height,
            font: s.fontSize,
            radius: s.borderRadius,
            surface: getComputedStyle(n.querySelector('[class*="surface"]'))
              .backgroundColor,
          }
        })
        assert.deepEqual(style, {
          height: 44,
          font: '14px',
          radius: '999px',
          surface:
            name === 'Log out' ? 'rgb(119, 45, 64)' : 'rgb(119, 84, 151)',
        })
        geometry.push(await button.boundingBox())
      }
      const edge = geometry[0].x + geometry[0].width
      assert(
        new Set(geometry.map((r) => Math.round(r.width))).size >= 4,
        'Settings action widths follow content, not one shared width'
      )
      assert(
        geometry.every((r) => Math.abs(r.x + r.width - edge) < 1),
        'All six Settings actions share right edge'
      )
      assert.equal(await p.getByText('Session', { exact: true }).count(), 1)
      assert.equal(
        await p.getByRole('button', { name: 'Log out', exact: true }).count(),
        1
      )
      const notifications = await p
        .getByRole('region', { name: 'Notifications', exact: true })
        .boundingBox()
      const session = await p
        .getByText('Session', { exact: true })
        .boundingBox()
      assert(
        session.y > notifications.y + notifications.height,
        'Session follows notification preferences'
      )
      assert(
        await p.getByText('Session', { exact: true }).evaluate((n) => {
          const row = n.closest('[class*="accountRow"]')
          return row === row.parentElement.lastElementChild
        }),
        'Session is the final Settings row'
      )
      assert.equal(
        await p
          .getByText(/^(Set|Unset|Not set|Ready|Needs attention)$/)
          .count(),
        0,
        'Settings has no setup status labels'
      )
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      await p.screenshot({
        path: path.join(root, 'settings-actions-layout-' + width + '.png'),
        fullPage: true,
      })
      for (const title of [
        'Set avatar',
        'Change username',
        'Change password',
        'Log out',
      ]) {
        const opener = p.getByRole('button', { name: title, exact: true })
        await opener.click()
        const d = p.getByRole('dialog')
        await d.waitFor()
        assert.equal(
          await p.evaluate(
            () => getComputedStyle(document.documentElement).overflowY
          ),
          'hidden',
          title + ' locks background'
        )
        const cancel = d.getByRole('button', { name: 'Cancel', exact: true })
        assert.equal(await cancel.locator('.shining-button__arrow').count(), 0)
        assert.equal(
          await cancel
            .locator('.shining-button__body')
            .evaluate((n) => getComputedStyle(n).backgroundColor),
          'rgb(119, 45, 64)'
        )
        const primary = d.getByRole('button', {
          name: title === 'Log out' ? 'Log out' : 'Save',
          exact: true,
        })
        assert.equal(
          await primary
            .locator('.shining-button__arrow[aria-hidden="true"]')
            .count(),
          1
        )
        if (title !== 'Log out')
          assert(
            (await primary.getAttribute('class')).includes(
              'shining-button--green'
            )
          )
        assert(await d.evaluate((n) => n.scrollWidth <= n.clientWidth))
        const rect = await d.boundingBox()
        assert(rect.x >= 0 && rect.x + rect.width <= width)
        await p.keyboard.press('Tab')
        assert(await d.evaluate((n) => n.contains(document.activeElement)))
        await cancel.click()
        await d.waitFor({ state: 'detached' })
        assert.equal(
          await p.evaluate(() => document.documentElement.style.overflow),
          '',
          title + ' restores root overflow'
        )
        assert(await opener.evaluate((n) => n === document.activeElement))
      }
      // Avatar validation and save remain local and unchanged.
      await p.getByRole('button', { name: 'Set avatar', exact: true }).click()
      let d = p.getByRole('dialog')
      assert(
        await d.getByRole('button', { name: 'Save', exact: true }).isDisabled()
      )
      await d.locator('input[type=file]').setInputFiles({
        name: 'fixture.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="purple"/></svg>'
        ),
      })
      await d.getByRole('button', { name: 'Save', exact: true }).click()
      await d.waitFor({ state: 'detached' })
      assert.equal(await p.evaluate(() => window.avatarSaves), 1)
      await p
        .getByRole('button', { name: 'Change username', exact: true })
        .click()
      d = p.getByRole('dialog')
      await d.locator('input').fill('FixtureNew')
      await p
        .getByText('Username available (case-insensitive)', { exact: true })
        .waitFor()
      await d.getByRole('button', { name: 'Save', exact: true }).click()
      await d.waitFor({ state: 'detached' })
      assert.equal(await p.evaluate(() => window.usernameSaves), 1)
      await p
        .getByRole('button', { name: 'Change password', exact: true })
        .click()
      d = p.getByRole('dialog')
      assert(
        await d.getByRole('button', { name: 'Save', exact: true }).isDisabled()
      )
      await p.keyboard.press('Escape')
      await d.waitFor({ state: 'detached' })
      // Logout failure recovers; pending is locked; successful reveal occurs after exit.
      await p.evaluate(() => (window.logoutFails = true))
      await p.getByRole('button', { name: 'Log out', exact: true }).click()
      d = p.getByRole('dialog')
      await d.getByRole('button', { name: 'Log out', exact: true }).click()
      await d.getByRole('alert').waitFor()
      assert(
        await d.getByRole('button', { name: 'Cancel', exact: true }).isEnabled()
      )
      await d.getByRole('button', { name: 'Log out', exact: true }).click()
      await p.waitForFunction(() => typeof window.finishLogout === 'function')
      assert(
        await d
          .getByRole('button', { name: 'Cancel', exact: true })
          .isDisabled()
      )
      await p.keyboard.press('Escape')
      assert(await d.isVisible())
      await p.evaluate(() => window.finishLogout())
      await d.getByRole('button', { name: 'Signed out', exact: true }).waitFor()
      await d.waitFor({ state: 'detached' })
      await p.waitForFunction(() => window.reveals === 1)
      assert.equal(await p.evaluate(() => window.logoutCalls), 2)
      assert.equal(network, 0)
      assert.deepEqual(errors, [])
      console.log(
        'PASS Settings dialogs',
        width,
        'red/no-arrow Cancel, green/arrow Save, focus/Escape, validation, save/logout recovery, no network'
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
