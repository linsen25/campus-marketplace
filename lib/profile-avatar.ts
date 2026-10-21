export const profileAvatarRules = {
  maxBytes: 3 * 1024 * 1024,
  maxPixels: 4096 * 4096,
  maxDimension: 4096,
  outputDimension: 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
}
export const avatarUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type ProfileAvatar = {
  avatarUrl: string | null
  avatarVersion: string | null
}
export function profileAvatarProjection(
  owner: string,
  path: string | null
): ProfileAvatar {
  if (!path) return { avatarUrl: null, avatarVersion: null }
  const prefix = `${owner.toLowerCase()}/`
  const version =
    path.startsWith(prefix) && path.endsWith('.webp')
      ? path.slice(prefix.length, -5)
      : ''
  if (!avatarUuid.test(owner) || !avatarUuid.test(version))
    throw new Error('Invalid avatar reference')
  return {
    avatarUrl: `/api/profile/avatar/${owner.toLowerCase()}?v=${version}`,
    avatarVersion: version,
  }
}
