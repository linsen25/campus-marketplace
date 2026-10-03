import type { IncomingMessage, ServerResponse } from 'http'

import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from '@supabase/ssr'

import { ListingApiError } from '@/lib/listing-validation'

export type MarketplaceContext = { req: IncomingMessage; res: ServerResponse }

export function createMarketplaceClient(
  { req, res }: MarketplaceContext,
  requestFetch?: typeof fetch
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key)
    throw new ListingApiError(
      'Marketplace setup is incomplete. Configure Supabase using docs/supabase-setup.md.',
      503
    )
  const cookies = new Map(
    parseCookieHeader(req.headers.cookie || '').map(({ name, value }) => [
      name,
      value,
    ])
  )
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  return createServerClient(url, key, {
    ...(requestFetch ? { global: { fetch: requestFetch } } : {}),
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure:
        process.env.NODE_ENV === 'production' &&
        !/^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || ''),
      path: '/',
    },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll: (updates, cacheHeaders) => {
        Object.entries(cacheHeaders).forEach(([name, value]) =>
          res.setHeader(name, value)
        )
        const previous = res.getHeader('Set-Cookie') || []
        const headers = Array.isArray(previous)
          ? previous.map(String)
          : [String(previous)]
        for (const { name, value, options } of updates) {
          cookies.set(name, value)
          headers.push(
            serializeCookieHeader(name, value, {
              ...options,
              httpOnly: true,
              sameSite: 'lax',
              path: '/',
            })
          )
        }
        res.setHeader('Set-Cookie', headers)
      },
    },
  })
}

export type MarketplaceClient = ReturnType<typeof createMarketplaceClient>
