const assert = require('node:assert/strict')
const fs = require('node:fs')

const load = (file) => fs.readFileSync(file, 'utf8')
const access = load('hooks/use-shop-membership-access.ts')
const sidebar = load('components/home/animated-sidebar-demo.tsx')
const plans = load('components/shops/shop-membership-access.tsx')
const settings = load('components/shops/shop-membership-settings.tsx')
const pricing = load('components/pricing-card.tsx')
const pricingDialog = load('components/shops/shop-pricing-dialog.tsx')
const homeListings = load('components/listings/home-listings.tsx')

assert.match(access, /process\.env\.NODE_ENV === 'development'/)
assert.match(access, /uu-v1:dev-shop-membership:\$\{userId\}/)
assert.match(
  access,
  /localStorage\.setItem\(storageKey\(userId\), JSON\.stringify\(next\)\)/
)
assert.match(access, /fetch\('\/api\/shop\/membership'/)
assert.match(access, /ShopMembershipRequestError/)
assert.match(access, /reason\.status === 403/)
assert.match(access, /status: 'ineligible'/)
assert.doesNotMatch(access, /\/api\/shop\/trial|stripe\.com|interac/i)

assert.match(sidebar, /LockKeyhole/)
assert.match(
  sidebar,
  /\[target\.id\]:\s*lockedShopTarget\s*\?\s*'shop-membership'\s*:\s*String\(section\)/
)
assert.match(sidebar, /selected\.shop === 'shop-membership'/)
assert.match(sidebar, /selected\.shop === 'shop-settings'/)
assert.match(sidebar, /shopDemoEnabledFor\(seller\?\.id\)/)
assert.match(
  sidebar,
  /demoAccess=\{[\s\S]*shopAccess\.simulation \?\? \(shopDemoEnabled \? 'pro' : undefined\)[\s\S]*\}/
)
assert.match(sidebar, /demoProducts=\{[\s\S]*shopDemoEnabled/)
assert.match(
  homeListings,
  /const showInjectedShopDemo = shouldShowShopDemo\(channel, demoProducts\)/
)
assert.match(
  homeListings,
  /if \(showInjectedShopDemo\) \{[\s\S]*setLoading\(false\)[\s\S]*return[\s\S]*\}[\s\S]*try \{[\s\S]*getMyListings\(\{ channel \}\)/
)

assert.match(plans, /DEV ONLY/)
assert.match(plans, /Simulate Plus/)
assert.match(plans, /Simulate Pro/)
assert.match(plans, /shop-hero\.png\?v=3/)
assert.doesNotMatch(plans, /shop-journey\.png/)
assert.match(plans, /shop-footer\.png/)
assert.match(plans, /ShopPreviewShowcase/)
assert.match(plans, /shop-pricing-surface\.module\.css/)
assert.doesNotMatch(plans, /fetch\(|marketplaceRequest|stripe|interac/i)
assert.match(plans, /trialEligibility=\{trialEligibility\}/)
assert.match(plans, /showTrialPreview=\{developmentTrialPreview\}/)
assert.match(plans, /trialPreview=\{developmentTrialPreview\}/)
assert.match(pricing, /Boolean\(pendingPreview\)/)
assert.match(pricing, /Continue with \$\{plan\.name\}/)
assert.match(pricing, /Development preview only/)
assert.match(pricing, /import ShiningButton/)
assert.match(pricing, /<ShiningButton/)
assert.match(pricing, /showArrow=\{false\}/)
assert.match(pricing, /loading=\{pendingPreview === 'trial'\}/)
assert.match(pricing, /loading=\{pendingPreview === 'checkout'\}/)
assert.match(pricingDialog, /shop-pricing-surface\.module\.css/)

assert.match(settings, /Exit Test Membership/)
assert.match(settings, /ConfirmationDialog/)
assert.match(settings, /does not cancel or change any real Shop membership/)

console.log('PASS shop membership local simulation boundaries')
