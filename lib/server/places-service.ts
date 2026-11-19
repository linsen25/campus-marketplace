import { isWithinWesternCampus } from '@/lib/geo/western-campus'
import { ListingApiError } from '@/lib/listing-validation'
import { configuredUuProjectRef } from '@/lib/marketplace-test-environment'
import type {
  MeetingArea,
  MeetingLocation,
  PlaceDetails,
  PlaceSuggestion,
} from '@/types/meeting-location'

const tokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type InternalPlaceDetails = PlaceDetails & {
  location?: {
    latitude: number
    longitude: number
  }
}

export function requirePlacesEnvironment() {
  if (!configuredUuProjectRef() || !process.env.GOOGLE_PLACES_API_KEY)
    throw new ListingApiError(
      'Location search is temporarily unavailable. Retry to choose a Google Place.',
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
    Object.keys(data).some(
      (k) =>
        ![
          field,
          'sessionToken',
          ...(action === 'autocomplete' ? ['meetingArea'] : []),
        ].includes(k)
    ) ||
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

  if (
    action === 'autocomplete' &&
    data.meetingArea !== undefined &&
    data.meetingArea !== 'ON_CAMPUS' &&
    data.meetingArea !== 'OTHER'
  ) {
    throw new ListingApiError('Invalid meeting area.')
  }

  return {
    value,
    sessionToken: data.sessionToken,
    meetingArea:
      action === 'autocomplete'
        ? (data.meetingArea as MeetingArea | undefined)
        : undefined,
  }
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
  transport: typeof fetch = fetch,
  includeCoordinates = false
): Promise<InternalPlaceDetails | PlaceSuggestion[]> {
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
          : includeCoordinates
          ? 'id,displayName,formattedAddress,location'
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
                  center: {
                    latitude: 43.0096,
                    longitude: -81.2737,
                  },
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

    const details: InternalPlaceDetails = {
      placeId,
      displayName: text(data.displayName?.text),
      formattedAddress: text(data.formattedAddress),
    }

    if (includeCoordinates) {
      const latitude = data.location?.latitude
      const longitude = data.location?.longitude

      if (
        typeof latitude !== 'number' ||
        typeof longitude !== 'number' ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      )
        throw new Error('Invalid place coordinates')

      details.location = { latitude, longitude }
    }

    return details
  } catch {
    throw new ListingApiError(
      'Location search is temporarily unavailable. Retry to choose a Google Place.',
      503
    )
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Verify the Google Place on the server.
 *
 * ON_CAMPUS: validate Google coordinates against the campus polygon.
 * OTHER: validate the Google Place without campus restrictions.
 * DELIVERY: no meeting-location validation required.
 *
 * Never trust coordinates supplied by the browser.
 */
export async function assertMeetingPlaceSelection(
  fulfillment: 'DELIVERY' | 'ON_CAMPUS',
  area: MeetingArea | null | undefined,
  location: MeetingLocation | null | undefined
) {
  if (fulfillment === 'DELIVERY') return

  if (location?.provider !== 'google' || !location.placeId)
    throw new ListingApiError(
      'Choose a suggested Google Place for the meeting.'
    )

  if (area !== 'ON_CAMPUS' && area !== 'OTHER')
    throw new ListingApiError('Choose an on-campus or other meeting area.')

  const place = (await searchPlaces(
    'details',
    location.placeId,
    crypto.randomUUID(),
    fetch,
    true
  )) as InternalPlaceDetails

  if (place.placeId !== location.placeId)
    throw new ListingApiError('Choose a valid Google Place for the meeting.')

  const latitude = place.location?.latitude
  const longitude = place.location?.longitude

  if (typeof latitude !== 'number' || typeof longitude !== 'number')
    throw new ListingApiError(
      'Unable to verify the selected location. Please retry.',
      422
    )

  const withinCampus = isWithinWesternCampus(latitude, longitude)

  if (area === 'ON_CAMPUS' && !withinCampus)
    throw new ListingApiError(
      'This location is outside the supported Western campus area. Choose Other.',
      422
    )

  if (area === 'OTHER' && withinCampus)
    throw new ListingApiError(
      'This location is within the Western campus area. Choose On campus.',
      422
    )
}
