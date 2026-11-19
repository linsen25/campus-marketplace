import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { shopBillingEntitlementSyncConfiguration } from '@/lib/server/shop-billing-environment'

const unavailable = () =>
  new ListingApiError(
    'Shop Billing entitlement synchronization is unavailable.',
    503
  )

const terminal = () => Object.assign(unavailable(), { billingTerminal: true })

async function command(
  action: 'record_payment_failure' | 'resolve_payment_state',
  subscriptionId: string
) {
  const { error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_membership_command',
    {
      p_action: action,
      p_billing_invoice_id: null,
      p_billing_subscription_id: subscriptionId,
    }
  )
  if (error) {
    if (['23514', '23505', '40001'].includes(error.code || '')) throw terminal()
    throw unavailable()
  }
}

/**
 * Server-only bridge from an already reconciled internal Invoice to existing
 * Membership authority. The SQL boundary re-resolves and locks its immutable
 * proof; the browser never supplies any billing or tier values.
 */
export async function synchronizeShopBillingEntitlements(input: {
  verifiedInvoiceId?: string | null
  subscriptionId: string
  subscriptionStatus: string
}) {
  shopBillingEntitlementSyncConfiguration()

  if (input.verifiedInvoiceId) {
    const { error } = await createTrustedFinancialClient().rpc(
      'marketplace_shop_billing_apply_verified_invoice',
      { p_billing_invoice_id: input.verifiedInvoiceId }
    )
    if (error) {
      if (['23514', '23505', '40001'].includes(error.code || ''))
        throw terminal()
      throw unavailable()
    }
  }

  // Payment action required does not prove failure. Only a provider-confirmed
  // past_due state starts bounded Grace; active/canceled may clear old Grace.
  if (input.subscriptionStatus === 'past_due') {
    await command('record_payment_failure', input.subscriptionId)
  } else if (
    input.subscriptionStatus === 'active' ||
    input.subscriptionStatus === 'canceled'
  ) {
    await command('resolve_payment_state', input.subscriptionId)
  }
}
