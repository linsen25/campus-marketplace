// Read-only by default: never consume the user's canonical/manual Requests.
// Atomic Accept mutations are covered by isolated rollback/race database fixtures.
require('./order-manual-fixture.browser.cjs')
