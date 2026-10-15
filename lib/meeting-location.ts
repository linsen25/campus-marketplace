import type { MeetingLocation } from '@/types/meeting-location'

export function validMeetingReference(provider: unknown, placeId: unknown) {
  return (
    ((provider === null || provider === undefined) &&
      (placeId === null || placeId === undefined)) ||
    (provider === 'google' &&
      typeof placeId === 'string' &&
      /^[A-Za-z0-9_-]{6,256}$/.test(placeId))
  )
}
export function parseMeetingLocation(value: unknown): MeetingLocation | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Check the Meeting location.')
  const v = value as Record<string, unknown>
  if (
    Object.keys(v).some((k) => !['label', 'provider', 'placeId'].includes(k)) ||
    typeof v.label !== 'string' ||
    !v.label.trim() ||
    v.label.trim().length > 120 ||
    !validMeetingReference(v.provider, v.placeId) ||
    Array.from(v.label).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
    )
  )
    throw new Error('Check the Meeting location.')
  return {
    label: v.label.trim(),
    ...(v.provider === 'google'
      ? { provider: 'google', placeId: v.placeId as string }
      : {}),
  }
}
/** Provider reference alone never hides a change to the user's transaction wording. */
export const normalizeMeetingLabel = (value: unknown) =>
  typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLowerCase()
    : ''
