import { createHash } from 'crypto'

import type { NextApiRequest } from 'next'
import sharp from 'sharp'

import { hasImageSignature } from '@/lib/listing-images'
import { ListingApiError } from '@/lib/listing-validation'
import {
  avatarUuid,
  profileAvatarProjection,
  profileAvatarRules,
} from '@/lib/profile-avatar'
import {
  avatarDeadline,
  avatarDatabaseError,
  avatarRepository,
} from '@/lib/server/profile-avatar-repository'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function animatedContainer(bytes: Buffer, type: string) {
  if (type === 'image/jpeg') return false
  let offset = type === 'image/png' ? 8 : 12
  while (offset + 8 <= bytes.length) {
    const png = type === 'image/png'
    const length = png
      ? bytes.readUInt32BE(offset)
      : bytes.readUInt32LE(offset + 4)
    const kind = bytes.toString(
      'ascii',
      offset + (png ? 4 : 0),
      offset + (png ? 8 : 4)
    )
    if (['acTL', 'ANIM', 'ANMF'].includes(kind)) return true
    offset += png ? 12 + length : 8 + length + (length % 2)
  }
  return false
}
export async function decodeAvatar(bytes: Buffer, type: string) {
  if (
    !profileAvatarRules.mimeTypes.includes(type) ||
    bytes.length < 1 ||
    bytes.length > profileAvatarRules.maxBytes ||
    !hasImageSignature(bytes, type) ||
    animatedContainer(bytes, type)
  )
    throw new ListingApiError(
      'Choose a JPEG, PNG, or WebP image up to 3 MB.',
      400
    )
  try {
    const image = sharp(bytes, {
      limitInputPixels: profileAvatarRules.maxPixels,
      failOnError: true,
    })
    const metadata = await image.metadata()
    const format = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
    }[type]
    if (
      metadata.format !== format ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > profileAvatarRules.maxDimension ||
      metadata.height > profileAvatarRules.maxDimension ||
      (metadata.pages || 1) !== 1
    )
      throw new Error('Invalid image dimensions or animation')
    const stored = await image
      .rotate()
      .resize({
        width: profileAvatarRules.outputDimension,
        height: profileAvatarRules.outputDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer()
    if (!stored.length || stored.length > profileAvatarRules.maxBytes)
      throw new Error('Invalid output size')
    return { stored, sourceHash: hash(bytes), storedHash: hash(stored) }
  } catch {
    throw new ListingApiError(
      'This image could not be opened. Select another image.',
      400
    )
  }
}
export async function readAvatar(req: NextApiRequest) {
  const type = String(req.headers['content-type'] || '')
  const length = req.headers['content-length']
  if (!profileAvatarRules.mimeTypes.includes(type))
    throw new ListingApiError('Choose a JPEG, PNG, or WebP image.', 400)
  if (
    length &&
    (!/^\d+$/.test(String(length)) ||
      Number(length) > profileAvatarRules.maxBytes)
  )
    throw new ListingApiError('Each image must be at most 3 MB.', 413)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > profileAvatarRules.maxBytes)
      throw new ListingApiError('Each image must be at most 3 MB.', 413)
    chunks.push(bytes)
  }
  return decodeAvatar(Buffer.concat(chunks), type)
}
export async function cleanupAvatars(
  owner: string,
  repository = avatarRepository()
) {
  // Failure never rolls back an already committed avatar. Rows remain retryable.
  try {
    const result = await repository.client.rpc(
      'marketplace_claim_profile_avatar_cleanup',
      { p_owner: owner }
    )
    if (result.error || !Array.isArray(result.data)) return
    for (const row of result.data) {
      if (avatarUuid.test(row.id) && row.path === `${owner}/${row.id}.webp`) {
        const removed = await repository.storage.remove([row.path])
        if (!removed.error)
          await repository.client.rpc(
            'marketplace_finish_profile_avatar_cleanup',
            { p_owner: owner, p_action: row.id }
          )
      }
    }
  } catch {
    /* Preserve the durable cleanup queue for a later attempt. */
  }
}
export async function saveAvatar(
  owner: string,
  action: string,
  expected: string | null,
  image: Awaited<ReturnType<typeof decodeAvatar>>,
  repository = avatarRepository()
) {
  const prepared = await repository.client.rpc(
    'marketplace_prepare_profile_avatar',
    {
      p_owner: owner,
      p_action: action,
      p_expected: expected,
      p_source_sha256: image.sourceHash,
      p_stored_sha256: image.storedHash,
      p_size: image.stored.length,
    }
  )
  avatarDatabaseError(prepared.error)
  if (prepared.data?.complete)
    return profileAvatarProjection(owner, prepared.data.currentPath)
  const path = `${owner}/${action}.webp`
  if (prepared.data?.path !== path)
    throw new ListingApiError('Unable to prepare avatar.', 503)
  const uploaded = await repository.storage.upload(path, image.stored, {
    contentType: 'image/webp',
    upsert: false,
    cacheControl: '0',
  })
  if (uploaded.error) {
    // A timed-out successful upload or concurrent retry can already own the path.
    const previous = await repository.storage.download(path)
    if (
      previous.error ||
      !previous.data ||
      hash(Buffer.from(await previous.data.arrayBuffer())) !== image.storedHash
    )
      throw new ListingApiError('Image upload failed. Please retry.', 503)
  }
  const committed = await repository.client.rpc(
    'marketplace_commit_profile_avatar',
    { p_owner: owner, p_action: action }
  )
  avatarDatabaseError(committed.error)
  const projection = profileAvatarProjection(owner, committed.data)
  // Cleanup has its own short, total deadline; committed Save must still succeed.
  try {
    await cleanupAvatars(owner, avatarRepository(avatarDeadline(3000)))
  } catch {
    /* Even cleanup capability initialization must not fail a committed Save. */
  }
  return projection
}
