import type { NextApiRequest } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { isWesternEmail } from '@/lib/marketplace-auth'
import type {
  MarketplaceClient,
  MarketplaceContext,
} from '@/lib/supabase/server'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { SellerSummary } from '@/types/listing'

export async function requireMarketplaceUser(client: MarketplaceClient) {
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (error || !user)
    throw new ListingApiError(
      'Log in with your Western email to continue.',
      401
    )
  if (!isWesternEmail(user.email) || !user.email_confirmed_at) {
    throw new ListingApiError('A verified @uwo.ca email is required.', 403)
  }
  return user
}

export async function getMarketplaceSession(
  context: MarketplaceContext
): Promise<SellerSummary | null> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    return null
  const client = createMarketplaceClient(context)
  try {
    const user = await requireMarketplaceUser(client)
    const { data, error } = await client
      .from('profiles')
      .select('id,display_name')
      .eq('id', user.id)
      .single()
    if (error || !data)
      throw new ListingApiError('Unable to load your marketplace profile.', 503)
    return { id: data.id, displayName: data.display_name }
  } catch (error) {
    if (error instanceof ListingApiError && [401, 403].includes(error.status))
      return null
    throw error
  }
}

// JSON/custom-header writes cannot be submitted by cross-origin HTML forms.
export function requireSameOriginWrite(req: NextApiRequest): void {
  if (req.headers['x-marketplace-request'] !== '1')
    throw new ListingApiError('Invalid request.', 403)
  const origin = req.headers.origin
  if (origin) {
    let host: string
    try {
      host = new URL(origin).host
    } catch {
      throw new ListingApiError('Invalid origin.', 403)
    }
    if (host !== req.headers.host)
      throw new ListingApiError('Cross-origin writes are not allowed.', 403)
  }
}
