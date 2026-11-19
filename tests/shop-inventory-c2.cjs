// Static contract test for C2.  It deliberately does not start Postgres or
// touch a Supabase project; the migration is validated in a disposable DB only
// when a dedicated local harness is added in a later task.
const fs = require('node:fs')
const assert = require('node:assert/strict')

const file =
  'supabase/migrations/20261116102654_shop_inventory_security_foundation.sql'
const sql = fs.readFileSync(file, 'utf8')

function must(pattern, message) {
  assert.match(sql, pattern, message)
}
function mustNot(pattern, message) {
  assert.doesNotMatch(sql, pattern, message)
}

must(
  /create table marketplace_private\.shop_inventory\b/i,
  'private inventory table'
)
must(
  /available_quantity integer generated always as \(on_hand_quantity - reserved_quantity\) stored/i,
  'derived availability'
)
must(
  /check \(reserved_quantity <= on_hand_quantity\)/i,
  'reserved amount cannot exceed stock'
)
must(
  /low_stock_threshold integer not null default 0/i,
  'neutral low-stock default'
)
must(
  /create table marketplace_private\.shop_inventory_adjustments\b/i,
  'immutable audit table'
)
must(
  /unique \(inventory_listing_id, action_id\)/i,
  'idempotency key is per inventory item'
)
must(
  /before update or delete on marketplace_private\.shop_inventory_adjustments/i,
  'audit mutation guard'
)
must(
  /create function marketplace_private\.guard_shop_inventory_adjustment_subject\(\)/i,
  'audit identity guard'
)
must(
  /Inventory identity is immutable/i,
  'inventory owner/shop/listing identity cannot be reassigned'
)
must(
  /create function public\.marketplace_shop_inventory\(p_listing_id uuid, p_change jsonb default null\)/i,
  'owner RPC'
)
must(/for update;/i, 'row lock is used')
must(/is_verified_user\(\)/i, 'verified-user authorization')
must(/is_shop_operator\(actor\)/i, 'Shop operator authorization')
must(/l\.listing_channel<>'shop'/i, 'resale exclusion')
must(
  /Inventory cannot be reduced below reserved quantity/i,
  'reserved-stock floor'
)
must(
  /v_action_id uuid/i,
  'PL/pgSQL action identifier is distinct from the audit column'
)
must(
  /adjustment\.action_id=v_action_id/i,
  'idempotency lookup qualifies the audit column and variable'
)
mustNot(
  /\baction_id\s*=\s*action_id\b/i,
  'no ambiguous action-id comparison remains'
)
must(
  /grant execute on function public\.marketplace_shop_inventory\(uuid,jsonb\) to authenticated/i,
  'minimal RPC grant'
)
must(
  /revoke all on marketplace_private\.shop_inventory, marketplace_private\.shop_inventory_adjustments/i,
  'private tables are fail-closed'
)
must(/l\.status in \('available','sold'\)/i, 'conservative legacy backfill')
must(
  /pending\/reserved rows are deliberately skipped/i,
  'ambiguous legacy reservations are not guessed'
)
must(/initialize_shop_inventory/i, 'C3 initialization hook is prepared')
must(
  /l\.status<>'available' or l\.reserved_order_id is not null/i,
  'initializer rejects legacy reservations'
)
mustNot(
  /create or replace function public\.marketplace_create_shop_listing/i,
  'C2 must not replace the final Shop create RPC'
)
mustNot(
  /alter table public\.listings/i,
  'C2 must not change Listing lifecycle/status'
)

console.log(
  'PASS Shop Inventory C2 static contract: private schema, owner-only atomic adjustment RPC, idempotency, conservative backfill, and no C3/UI/order changes'
)
