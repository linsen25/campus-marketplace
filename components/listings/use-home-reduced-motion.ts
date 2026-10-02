import { useEffect, useState } from 'react'

// Start with the same value on the server and client to preserve hydration.
export function useHomeReducedMotion() {
  const [reduced, setReduced] = useState<boolean | null>(null)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}
