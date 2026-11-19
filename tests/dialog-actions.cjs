const assert = require('node:assert/strict')
const fs = require('node:fs')

const read = (file) => fs.readFileSync(file, 'utf8')
const actions = read('components/ui/dialog-actions.tsx')
const dialog = read('components/ui/confirmation-dialog.tsx')
const listing = read('components/listings/listing-confirmation.tsx')

assert.match(actions, /ActionRow align="between" compactBetween/)
assert.match(dialog, /import \{ FadingDialog \}/)
assert.match(dialog, /import \{ DialogActions \}/)
assert(
  !dialog.includes('createPortal'),
  'confirmation must not recreate a portal'
)
assert.match(listing, /if \(!onSave\)/)
assert.match(listing, /<ConfirmationDialog/)
assert.match(listing, /<ActionRow three=\{true\}>/)
assert.match(listing, /variant="purple"/)
console.log(
  'PASS dialog action composition and ListingConfirmation two/three-action branches'
)
