// Server-only: do not import this module from components or client API modules.
import { createClient } from '@supabase/supabase-js'

import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import {
  requireMessagesEnvironment,
  messageUuid,
} from '@/lib/server/messages-environment'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'
import type { FinancialCapabilities } from '@/types/financial-capabilities'

export function requireFinancialEnvironment() {
  if (
    process.env.APP_ENV !== 'staging' ||
    requireMessagesEnvironment() !== 'pcaqxezdfxofysghssyo'
  )
    throw new ListingApiError(
      'Financial capabilities are not enabled in this environment.',
      503
    )
}

// Explicit allowlist: never forward an RPC object or opaque provider reference.
export function projectFinancialCapabilities(
  value: FinancialCapabilities
): FinancialCapabilities {
  const payment = value?.paymentMethod
  const payout = value?.payoutAccount
  if (
    !payment ||
    !payout ||
    !['unset', 'set', 'needs_attention'].includes(payment.status) ||
    !['unset', 'ready', 'needs_attention'].includes(payout.status)
  )
    throw new ListingApiError('Unable to load financial capabilities.', 503)
  const label = (v: unknown) =>
    typeof v === 'string' &&
    v.length <= 80 &&
    v.trim() === v &&
    !Array.from(v).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) &&
    !/[0-9]{5}/.test(v)
      ? v
      : null
  const last4 = (v: unknown) =>
    typeof v === 'string' && /^[0-9]{4}$/.test(v) ? v : null
  return {
    paymentMethod: {
      status: payment.status,
      brand: payment.status === 'unset' ? null : label(payment.brand),
      last4: payment.status === 'unset' ? null : last4(payment.last4),
    },
    payoutAccount: {
      status: payout.status,
      institution: payout.status === 'unset' ? null : label(payout.institution),
      last4: payout.status === 'unset' ? null : last4(payout.last4),
    },
  }
}

export async function getOwnFinancialCapabilities(context: MarketplaceContext) {
  requireFinancialEnvironment()
  const client = createMarketplaceClient(context)
  await requireMarketplaceUser(client)
  const { data, error } = await client.rpc('marketplace_financial_capabilities')
  if (error)
    throw new ListingApiError('Unable to load financial capabilities.', 503)
  return projectFinancialCapabilities(data)
}

export function createTrustedFinancialClient() {
  requireFinancialEnvironment()
  if (typeof window !== 'undefined')
    throw new Error('Server-only financial capability service.')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  let valid = false
  try {
    const claims = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64url').toString()
    )
    valid =
      claims.role === 'service_role' && claims.ref === 'pcaqxezdfxofysghssyo'
  } catch {
    valid = false
  }
  if (!valid)
    throw new ListingApiError(
      'Trusted financial capability service is unavailable.',
      503
    )
  return createClient('https://pcaqxezdfxofysghssyo.supabase.co', key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export async function getFinancialCapabilities(userId: string) {
  const client = createTrustedFinancialClient()
  const { data, error } = await client.rpc(
    'marketplace_financial_capabilities_for_user',
    { p_user_id: messageUuid(userId) }
  )
  if (error)
    throw new ListingApiError('Unable to load financial capabilities.', 503)
  return projectFinancialCapabilities(data)
}
export async function hasUsablePaymentMethod(userId: string) {
  return (await getFinancialCapabilities(userId)).paymentMethod.status === 'set'
}
export async function isPayoutReady(userId: string) {
  return (
    (await getFinancialCapabilities(userId)).payoutAccount.status === 'ready'
  )
}

export type TrustedFinancialCapability = {
  userId: string
  capability: 'payment_method' | 'payout_account'
} & (
  | {
      status: 'needs_attention' | 'ready' | 'set'
      providerKey: string
      providerOwnerRef: string
      providerInstrumentRef: string
      displayLabel?: string
      last4?: string
    }
  | { status: 'unset' }
)

// Internal adapter boundary only. Caller must authenticate provider evidence; no API route.
export async function recordFinancialCapability(
  input: TrustedFinancialCapability
) {
  const client = createTrustedFinancialClient()
  const metadata = input.status === 'unset' ? null : input
  const { error } = await client.rpc(
    'marketplace_record_financial_capability',
    {
      p_user_id: messageUuid(input.userId),
      p_capability: input.capability,
      p_status: input.status,
      p_provider_key: metadata?.providerKey || null,
      p_provider_owner_ref: metadata?.providerOwnerRef || null,
      p_provider_instrument_ref: metadata?.providerInstrumentRef || null,
      p_display_label: metadata?.displayLabel ?? null,
      p_last4: metadata?.last4 ?? null,
    }
  )
  if (error)
    throw new ListingApiError('Unable to update financial capabilities.', 503)
}
