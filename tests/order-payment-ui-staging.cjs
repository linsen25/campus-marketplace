// Phase D's guarded runner owns scoped fixture creation/cleanup; no migrations.
process.env.ORDER_PAYMENT_UI_TEST = '1'
process.argv[2] = 'browser'
require('./order-financial-staging-admin.cjs')
