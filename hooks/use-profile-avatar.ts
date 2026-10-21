import { useCallback, useEffect, useRef, useState } from 'react'

import { marketplaceRequest } from '@/lib/listings-api'
import type { ProfileAvatar } from '@/lib/profile-avatar'
import { uploadProfileAvatar } from '@/lib/profile-avatar-api'

export function useProfileAvatar(owner: string | undefined) {
  const [state, setState] = useState<ProfileAvatar & { owner?: string }>({
    avatarUrl: null,
    avatarVersion: null,
  })
  const identity = useRef(owner)
  identity.current = owner
  const version = useRef<string | null>(null)
  const sequence = useRef(0)
  const request = useRef<{
    file: File
    action: string
    expected: string | null
  }>()
  const readyOwner = useRef<string>()
  useEffect(() => {
    let active = true
    const token = ++sequence.current
    readyOwner.current = undefined
    version.current = null
    request.current = undefined
    setState({ owner, avatarUrl: null, avatarVersion: null })
    if (owner)
      marketplaceRequest<ProfileAvatar>('/api/profile/account', 'GET')
        .then((data) => {
          if (
            active &&
            identity.current === owner &&
            token === sequence.current
          ) {
            version.current = data.avatarVersion ?? null
            readyOwner.current = owner
            setState({
              owner,
              avatarUrl: data.avatarUrl ?? null,
              avatarVersion: version.current,
            })
          }
        })
        .catch(() => {
          /* Existing account panel presents its own loading error. */
        })
    const ended = () => {
      active = false
      ++sequence.current
      readyOwner.current = undefined
      version.current = null
      request.current = undefined
      setState({ avatarUrl: null, avatarVersion: null })
    }
    window.addEventListener('marketplace-session-ended', ended)
    return () => {
      active = false
      // Request generations intentionally invalidate outstanding saves.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++sequence.current
      window.removeEventListener('marketplace-session-ended', ended)
    }
  }, [owner])
  const saveAvatar = useCallback(
    async (file: File) => {
      if (!owner || identity.current !== owner || readyOwner.current !== owner)
        throw new Error('Unable to load your avatar. Please refresh and retry.')
      if (request.current?.file !== file)
        request.current = {
          file,
          action: crypto.randomUUID(),
          expected: version.current,
        }
      const intent = request.current
      const token = ++sequence.current
      try {
        const data = await uploadProfileAvatar(
          file,
          intent.action,
          intent.expected
        )
        if (identity.current !== owner || token !== sequence.current)
          throw new Error('Your account changed. Please retry.')
        version.current = data.avatarVersion
        request.current = undefined
        setState({ ...data, owner })
      } catch (error) {
        if (
          (error as { status?: number }).status === 409 &&
          identity.current === owner &&
          token === sequence.current
        ) {
          const data = await marketplaceRequest<ProfileAvatar>(
            '/api/profile/account',
            'GET'
          )
          if (identity.current === owner && token === sequence.current) {
            version.current = data.avatarVersion
            request.current = undefined
            setState({ ...data, owner })
          }
        }
        throw error
      }
    },
    [owner]
  )
  return {
    avatarImage:
      state.owner === owner ? state.avatarUrl || undefined : undefined,
    saveAvatar,
  }
}
