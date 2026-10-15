// Server-only Google transport. Never import into browser code.
import { ListingApiError } from '@/lib/listing-validation'
import type { PlaceDetails, PlaceSuggestion } from '@/types/meeting-location'

const tokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function requirePlacesEnvironment() {
  if (
    process.env.APP_ENV !== 'staging' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !==
      'https://pcaqxezdfxofysghssyo.supabase.co' ||
    !process.env.GOOGLE_PLACES_API_KEY
  )
    throw new ListingApiError(
      'Location search is temporarily unavailable. You can enter a location manually.',
      503
    )
}
export function validatePlacesInput(
  body: unknown,
  action: 'autocomplete' | 'details'
) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ListingApiError('Invalid location search.')
  const data = body as Record<string, unknown>
  const field = action === 'autocomplete' ? 'input' : 'placeId'
  if (
    Object.keys(data).some((k) => ![field, 'sessionToken'].includes(k)) ||
    typeof data.sessionToken !== 'string' ||
    !tokenPattern.test(data.sessionToken) ||
    typeof data[field] !== 'string'
  )
    throw new ListingApiError('Invalid location search.')
  const value = (data[field] as string).trim()
  if (
    action === 'autocomplete'
      ? value.length < 2 ||
        value.length > 160 ||
        Array.from(value).some(
          (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
        )
      : !/^[A-Za-z0-9_-]{6,256}$/.test(value)
  )
    throw new ListingApiError('Invalid location search.')
  return { value, sessionToken: data.sessionToken }
}
// Best-effort per-process protection, not a distributed production rate limiter.
const limits = new Map<string, { count: number; until: number }>()
export function guardPlacesRate(actor: string, now = Date.now()) {
  limits.forEach((entry, id) => {
    if (entry.until <= now) limits.delete(id)
  })
  const entry = limits.get(actor)
  if ((entry && entry.count >= 60) || (!entry && limits.size >= 1000))
    throw new ListingApiError(
      'Too many location searches. Please wait and retry.',
      429
    )
  limits.set(actor, {
    count: (entry?.count || 0) + 1,
    until: entry?.until || now + 60000,
  })
}
const text = (value: unknown, limit = 512) =>
  typeof value === 'string' && value.length <= limit ? value : ''
export async function searchPlaces(
  action: 'autocomplete' | 'details',
  value: string,
  sessionToken: string,
  transport: typeof fetch = fetch
): Promise<PlaceDetails | PlaceSuggestion[]> {
  requirePlacesEnvironment()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const autocomplete = action === 'autocomplete'
    const url = autocomplete
      ? 'https://places.googleapis.com/v1/places:autocomplete'
      : `https://places.googleapis.com/v1/places/${encodeURIComponent(
          value
        )}?sessionToken=${encodeURIComponent(sessionToken)}&languageCode=en`
    const response = await transport(url, {
      method: autocomplete ? 'POST' : 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY!,
        'X-Goog-FieldMask': autocomplete
          ? 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat'
          : 'id,displayName,formattedAddress',
      },
      ...(autocomplete
        ? {
            body: JSON.stringify({
              input: value,
              sessionToken,
              includedRegionCodes: ['ca'],
              languageCode: 'en',
              locationBias: {
                circle: {
                  center: { latitude: 43.0096, longitude: -81.2737 },
                  radius: 30000,
                },
              },
            }),
          }
        : {}),
    })
    if (!response.ok) throw new Error('Upstream unavailable')
    const data = await response.json()
    if (autocomplete) {
      if (data.suggestions !== undefined && !Array.isArray(data.suggestions))
        throw new Error('Invalid response')
      return (data.suggestions || []).slice(0, 5).flatMap(
        (item: {
          placePrediction?: {
            placeId?: unknown
            text?: { text?: unknown }
            structuredFormat?: {
              mainText?: { text?: unknown }
              secondaryText?: { text?: unknown }
            }
          }
        }) => {
          const p = item.placePrediction
          const placeId = text(p?.placeId, 256)
          const displayText = text(p?.text?.text)
          return /^[A-Za-z0-9_-]{6,256}$/.test(placeId) && displayText
            ? [
                {
                  placeId,
                  displayText,
                  primaryText:
                    text(p?.structuredFormat?.mainText?.text) || displayText,
                  secondaryText: text(p?.structuredFormat?.secondaryText?.text),
                },
              ]
            : []
        }
      )
    }
    const placeId = text(data.id, 256)
    if (!/^[A-Za-z0-9_-]{6,256}$/.test(placeId))
      throw new Error('Invalid response')
    return {
      placeId,
      displayName: text(data.displayName?.text),
      formattedAddress: text(data.formattedAddress),
    }
  } catch {
    throw new ListingApiError(
      'Location search is temporarily unavailable. You can enter a location manually.',
      503
    )
  } finally {
    clearTimeout(timeout)
  }
}
