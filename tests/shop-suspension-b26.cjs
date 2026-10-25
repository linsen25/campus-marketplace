// B26-B static/server coordinator qualification. No network or remote database.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const ts = require('typescript')

const migration = fs.readFileSync(
  'supabase/migrations/20261023030000_shop_suspension_lifecycle.sql',
  'utf8'
)
for (const table of [
  'shop_suspension_cycles',
  'shop_suspension_offer_closures',
  'shop_suspension_message_events',
  'shop_membership_lifecycle_cursor',
]) {
  assert.match(
    migration,
    new RegExp(
      `alter table marketplace_private\\.${table} enable row level security`
    )
  )
}
assert.match(
  migration,
  /revoke all on marketplace_private\.shop_suspension_cycles,[\s\S]*from public,anon,authenticated,service_role/
)
assert.match(
  migration,
  /revoke all on function public\.marketplace_shop_membership_lifecycle\(text,integer\) from public,anon,authenticated,service_role/
)
assert.match(
  migration,
  /grant execute on function public\.marketplace_shop_membership_lifecycle\(text,integer\) to service_role/
)
assert.match(migration, /for update skip locked/)
assert.match(migration, /close_shop_suspension_offers/)
assert.match(
  migration,
  /select \* into l from public\.listings[\s\S]*select \* into c from public\.conversations[\s\S]*select \* into r from public\.order_requests/
)
assert.match(migration, /marketplace_private\.shop_conversation_has_order/)
assert.match(
  migration,
  /before insert or update on public\.image_message_submissions/
)
assert.match(
  migration,
  /This shop is temporarily suspended\. Your message has been saved\. The seller can reply once the shop reopens\./
)
assert.match(
  migration,
  /This shop has reopened! You can now continue your conversation with the seller\./
)
assert.match(migration, /interval '24 hours'/)
assert.doesNotMatch(
  migration,
  /cron\.schedule|net\.http|http_post|payouts\.create/
)

const source = fs.readFileSync(
  'lib/server/shop-suspension-lifecycle.ts',
  'utf8'
)
function load(client) {
  const mod = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(source, {
      compilerOptions: { module: 1, target: 7, esModuleInterop: true },
    }).outputText
  )(
    (name) =>
      name === '@/lib/server/financial-capabilities-service'
        ? { createTrustedFinancialClient: () => client }
        : require(name),
    mod,
    mod.exports
  )
  return mod.exports
}

async function main() {
  const old = process.env.SHOP_SUSPENSION_LIFECYCLE_ENABLED
  let calls = 0
  const client = {
    rpc: async (name, args) => {
      calls++
      assert.equal(name, 'marketplace_shop_membership_lifecycle')
      assert.deepEqual(args, { p_action: 'process_due', p_limit: 20 })
      return {
        data: {
          busy: false,
          scanned: 4,
          offersClosed: 2,
          messagesInserted: 3,
          cyclesReopened: 1,
        },
        error: null,
      }
    },
  }
  try {
    delete process.env.SHOP_SUSPENSION_LIFECYCLE_ENABLED
    let result = await load(client).drainShopSuspensionLifecycle()
    assert.equal(result.enabled, false)
    assert.equal(calls, 0, 'default-off coordinator must not reach Supabase')
    process.env.SHOP_SUSPENSION_LIFECYCLE_ENABLED = 'true'
    result = await load(client).drainShopSuspensionLifecycle()
    assert.deepEqual(result, {
      enabled: true,
      busy: false,
      scanned: 4,
      offersClosed: 2,
      messagesInserted: 3,
      cyclesReopened: 1,
    })
    assert.equal(calls, 1)
    await assert.rejects(
      () =>
        load({
          rpc: async () => ({
            data: null,
            error: { message: 'private detail' },
          }),
        }).drainShopSuspensionLifecycle(),
      /Shop membership lifecycle reconciliation failed/
    )
  } finally {
    if (old === undefined) delete process.env.SHOP_SUSPENSION_LIFECYCLE_ENABLED
    else process.env.SHOP_SUSPENSION_LIFECYCLE_ENABLED = old
  }
  console.log(
    'PASS B26-B static/coordinator: private lifecycle evidence, default-off worker, bounded RPC, lock order, message and image fences'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
