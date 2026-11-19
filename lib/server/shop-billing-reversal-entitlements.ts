import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { shopBillingReversalEntitlementSyncConfiguration } from '@/lib/server/shop-billing-environment'

const unavailable = () =>
  new ListingApiError(
    'Shop Billing reversal entitlement synchronization is unavailable.',
    503
  )
const terminal = () => Object.assign(unavailable(), { billingTerminal: true })

/**
 * Server-only bridge for a Phase 4B-4A immutable full-refund proof. The SQL
 * boundary re-locks and validates every Billing binding before it can revoke
 * the one matching Provider Term.
 */
export async function synchronizeShopBillingReversalEntitlement(input: {
  reversalProofId: string
}) {
  shopBillingReversalEntitlementSyncConfiguration()
  const { error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_apply_reversal_proof',
    { p_reversal_proof_id: input.reversalProofId }
  )
  if (error) {
    if (['23514', '23505', '40001'].includes(error.code || '')) throw terminal()
    throw unavailable()
  }
}
