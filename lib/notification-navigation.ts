import { notificationTarget } from './notification-presentation'

// UI-only enrichment. Email templates and stored destinations are unchanged.
export function notificationUiTarget(
  value: unknown,
  type: string
): string | null {
  const target = notificationTarget(value)
  if (!target) return null
  const d = value as Record<string, unknown>
  if (
    d.section === 'messages' &&
    typeof d.offerId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      d.offerId
    ) &&
    type !== 'new_message'
  )
    return `${target}&offer=${d.offerId}`
  // Order Detail already selects its authoritative current stage and terminal
  // history. Never use an older notification to force an invalid stage backward.
  return target
}
