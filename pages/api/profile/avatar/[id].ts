import { createClient } from '@supabase/supabase-js'
import type { NextApiRequest, NextApiResponse } from 'next'

import {
  avatarUuid,
  profileAvatarProjection,
  profileAvatarRules,
} from '@/lib/profile-avatar'
import { avatarRepository } from '@/lib/server/profile-avatar-repository'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'GET') return res.status(405).end()
  const { id, v } = req.query
  if (
    Object.keys(req.query).some((key) => !['id', 'v'].includes(key)) ||
    typeof id !== 'string' ||
    !avatarUuid.test(id) ||
    typeof v !== 'string' ||
    !avatarUuid.test(v)
  )
    return res.status(404).end()
  try {
    const repository = avatarRepository()
    // Same anonymous public-profile authority as the Seller page, no Auth lookup.
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const profile = await client
      .from('profiles')
      .select('avatar_path')
      .eq('id', id.toLowerCase())
      .maybeSingle()
    if (profile.error) return res.status(503).end()
    if (
      !profile.data ||
      profileAvatarProjection(id, profile.data.avatar_path).avatarVersion !==
        v.toLowerCase()
    )
      return res.status(404).end()
    const object = await repository.storage.download(profile.data.avatar_path)
    if (object.error || !object.data) return res.status(404).end()
    if (object.data.size < 1 || object.data.size > profileAvatarRules.maxBytes)
      return res.status(503).end()
    // Recheck after Storage I/O so a replacement cannot authorize an old path.
    const current = await client
      .from('profiles')
      .select('avatar_path')
      .eq('id', id.toLowerCase())
      .maybeSingle()
    if (current.error) return res.status(503).end()
    if (current.data?.avatar_path !== profile.data.avatar_path)
      return res.status(404).end()
    res.setHeader('Content-Type', 'image/webp')
    return res.status(200).send(Buffer.from(await object.data.arrayBuffer()))
  } catch {
    return res.status(503).end()
  }
}
