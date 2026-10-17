export type NotificationPreferences = {
  inApp: boolean
  sounds: boolean
  email: boolean
}
export const notificationPreferenceKeys = ['inApp', 'sounds', 'email'] as const
export function validNotificationPreferences(
  value: unknown
): value is NotificationPreferences {
  return Boolean(
    value &&
      typeof value === 'object' &&
      notificationPreferenceKeys.every(
        (key) => typeof (value as Record<string, unknown>)[key] === 'boolean'
      )
  )
}
