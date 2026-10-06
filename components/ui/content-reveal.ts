import { useEffect, useRef, useState } from 'react'

import styles from './content-reveal.module.css'

/** Reveal only after a genuine pending state; cached data and tab entries stay stable. */
export function useContentReveal(loading: boolean) {
  const pending = useRef(loading)
  const [resolved, setResolved] = useState(false)
  const revealing = !loading && (pending.current || resolved)
  useEffect(() => {
    const completed = pending.current && !loading
    pending.current = loading
    if (loading) setResolved(false)
    if (!completed) return undefined
    setResolved(true)
    const timer = setTimeout(() => setResolved(false), 160)
    return () => clearTimeout(timer)
  }, [loading])
  return revealing ? styles.reveal : ''
}
