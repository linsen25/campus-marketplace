import type { ProfileAvatar } from '@/lib/profile-avatar'

export async function uploadProfileAvatar(
  file: File,
  action: string,
  expected: string | null
): Promise<ProfileAvatar> {
  const response = await fetch('/api/profile/avatar', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': file.type,
      'X-Marketplace-Request': '1',
      'X-Avatar-Action': action,
      'X-Avatar-Version': expected || 'none',
    },
    body: file,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(
      body?.error || 'Unable to save your avatar. Please retry.'
    )
    Object.assign(error, { status: response.status })
    throw error
  }
  return body
}
