const assert = require('node:assert/strict')
const fs = require('node:fs')

const load = (file) => fs.readFileSync(file, 'utf8')
const banner = load('components/shops/shop-pro-promo-banner.tsx')
const transition = load('components/navigation/desktop-route-transition.tsx')
const sidebar = load('components/home/animated-sidebar-demo.tsx')

assert.match(banner, /const plansHref = '\/home\?section=shop-membership'/)
assert.match(banner, /href=\{plansHref\}/)
assert.match(banner, /onNavigate=\{\(event\) => navigate\(event, plansHref\)\}/)
assert.doesNotMatch(banner, /ShopPricingDialog/)

assert.match(transition, /destinationPath: string/)
assert.match(transition, /destinationSearch: string/)
assert.match(transition, /new URL\(destination, window\.location\.origin\)/)
assert.match(transition, /location\.search !== navigation\.destinationSearch/)
assert.match(
  transition,
  /shopPlans && !plans\?\.getBoundingClientRect\(\)\.width/
)

assert.match(sidebar, /section === 'shop-membership'/)
assert.match(sidebar, /shop: 'shop-membership'/)
assert.match(sidebar, /badge: item\.badge/)

console.log('PASS Shop Plans deep-link navigation wiring')
