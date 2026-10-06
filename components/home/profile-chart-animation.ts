import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export type ChartReplayHistory = { activity: number; marketplace: number }

const motionQuery = '(prefers-reduced-motion: reduce)'
const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia(motionQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const readMotion = () => window.matchMedia(motionQuery).matches

// History lives in the shell so responsive unmounts cannot replay a consumed click.
export function useProfileChartAnimation(
  token: number,
  history: MutableRefObject<ChartReplayHistory>,
  chart: keyof ChartReplayHistory,
  ready = true
) {
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, () => true)
  const [animation, setAnimation] = useState({
    key: -1,
    phase: 'idle',
  })
  useEffect(() => {
    if (!ready || token <= history.current[chart]) return
    const consumed = history.current
    consumed[chart] = token
    setAnimation({ key: token, phase: reduced ? 'idle' : 'pending' })
  }, [chart, history, ready, reduced, token])
  const finish = useCallback(() => {
    setAnimation((current) =>
      current.phase === 'idle' ? current : { ...current, phase: 'idle' }
    )
  }, [])
  useEffect(() => {
    if (reduced) finish()
  }, [finish, reduced])
  useEffect(() => {
    // A resize may end motion, but must never become another entrance trigger.
    window.addEventListener('resize', finish)
    return () => window.removeEventListener('resize', finish)
  }, [finish])
  const start = useCallback(() => {
    setAnimation((current) => ({ ...current, phase: 'running' }))
  }, [])
  return {
    key: animation.key,
    phase: reduced ? 'idle' : animation.phase,
    active: !reduced && animation.phase !== 'idle',
    handleStart: start,
    handleEnd: finish,
  }
}
