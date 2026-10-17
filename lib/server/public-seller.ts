import { createClient } from '@supabase/supabase-js'

import { validUsername } from '@/lib/auth-username'
import { ListingApiError } from '@/lib/listing-validation'
import { publicSellerIdentifierPattern } from '@/lib/public-seller'
import type { PublicSeller } from '@/lib/public-seller'

const pageSize = 24

// Deliberately anonymous, even for a signed-in owner: public RLS, no cookies,
// Auth admin lookup, service-role credential or private account projection.
export async function getPublicSeller(
  identifier: string,
  page = 1
): Promise<PublicSeller | null> {
  const uuid = publicSellerIdentifierPattern.test(identifier)
  if (!uuid && !validUsername(identifier)) return null
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new ListingApiError('Seller page unavailable.', 503)
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const profile = await client
    .from('profiles')
    .select('id,username')
    .eq(uuid ? 'id' : 'username_normalized', identifier.toLowerCase())
    .maybeSingle()
  if (profile.error) throw new ListingApiError('Seller page unavailable.', 503)
  if (!profile.data) return null
  const result = await client
    .from('listings')
    .select('id,title,price_cents,listing_images(path,slot,ready)')
    .eq('seller_id', profile.data.id)
    .eq('status', 'available')
    .not('published_at', 'is', null)
    .order('created_at', { ascending: false })
    .order('id')
    .range((page - 1) * pageSize, page * pageSize)
  if (result.error) throw new ListingApiError('Seller page unavailable.', 503)
  return {
    identifier: profile.data.id,
    username: profile.data.username || 'UU seller',
    avatarUrl: null,
    page,
    hasNextPage: page < 1000 && result.data.length > pageSize,
    listings: result.data.slice(0, pageSize).map((row) => {
      const image = row.listing_images
        .filter((photo) => photo.ready)
        .sort((a, b) => a.slot - b.slot)[0]
      return {
        id: row.id,
        title: row.title,
        priceCents: row.price_cents,
        imageUrl: image
          ? client.storage.from('listing-images').getPublicUrl(image.path).data
              .publicUrl
          : null,
      }
    }),
  }
}
