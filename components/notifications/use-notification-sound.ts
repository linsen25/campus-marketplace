import { useCallback, useEffect, useRef } from 'react'

// Eligibility and ID dedupe belong to the existing popup stream, not this player.
export function useNotificationSound(
  userId: string | undefined,
  enabled: boolean
) {
  const allowed = useRef(enabled && Boolean(userId))
  allowed.current = enabled && Boolean(userId)
  const actor = useRef(userId)
  actor.current = userId
  const audio = useRef<HTMLAudioElement | null>(null)
  const frame = useRef<number>()
  const stop = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
    if (audio.current) {
      audio.current.pause()
      audio.current.removeAttribute('src')
      audio.current.load()
      audio.current = null
    }
  }, [])
  useEffect(() => stop, [userId, stop])
  useEffect(() => {
    if (!enabled) stop()
  }, [enabled, stop])
  const play = useCallback(() => {
    if (!allowed.current) return
    const owner = actor.current
    // Coalesce same-frame bursts; let React commit the popup first. Never queue
    // a backlog of audio or overlap instances of the same short sound.
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      if (!allowed.current || actor.current !== owner) return
      try {
        if (!audio.current) {
          audio.current = new Audio('/static/sounds/notification.wav')
          audio.current.volume = 0.45
          audio.current.loop = false
        }
        audio.current.pause()
        audio.current.currentTime = 0
        // Autoplay denial, interrupted playback and decoder/network failures
        // never affect notification state. A future eligible event may try once.
        audio.current.play().catch(() => {})
      } catch {
        /* Audio may be unavailable; the popup remains fully usable. */
      }
    })
  }, [])
  return { play, stop }
}
