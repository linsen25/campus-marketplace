import { m, useAnimation, useReducedMotion } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'

import type { MarketMode } from './market-feed-viewport'
import styles from './market-layout.module.css'

const GradientWaves = dynamic(
  () =>
    import(
      /* webpackChunkName: 'market-gradient-waves' */ '@/components/ui/GradientWaves'
    ),
  { ssr: false }
)
const colors = {
  resale: {
    horizonColor: '#9000ff',
    waveColor: '#ff9ffc',
    crestColor: '#ffb3b3',
  },
  shop: {
    horizonColor: '#00bf6f',
    waveColor: '#37ff00',
    crestColor: '#b6ffd5',
  },
}

/** One existing canvas; only its decorative carrier travels, never page content. */
export function MarketBackground({ mode }: { mode: MarketMode }) {
  const reduced = useReducedMotion()
  const controls = useAnimation()
  const previousMode = useRef(mode)
  const [palette, setPalette] = useState(mode)
  useEffect(() => {
    let active = true
    if (previousMode.current === mode || reduced) {
      previousMode.current = mode
      setPalette(mode)
      controls.set({ y: '0%', opacity: 1 })
    } else {
      previousMode.current = mode
      const transition = { duration: 0.5, ease: [0.4, 0, 0.2, 1] }
      ;(async () => {
        await controls.start({ y: '100%', opacity: 0, transition })
        if (!active) return
        setPalette(mode)
        await controls.start({ y: '0%', opacity: 1, transition })
      })()
    }
    return () => {
      active = false
      controls.stop()
    }
  }, [controls, mode, reduced])
  return (
    <div
      className={styles.background}
      aria-hidden="true"
      data-market-background="lowered"
    >
      <m.div
        className={styles.waveCarrier}
        initial={false}
        animate={controls}
        data-market-wave-mode={palette}
        data-market-wave-target={mode}
      >
        <GradientWaves
          {...colors[palette]}
          speed={0.4}
          amplitude={2.5}
          waveScale={0.6}
          waveRatio={0.9}
          swell={35}
          turbulence={20}
          tilt={1.11}
          zoom={1}
          height={-12}
          fogDepth={15}
          detail="medium"
          brightness={1}
          opacity={1}
          mouseInteraction={true}
          parallaxStrength={0.5}
          grain={true}
          grainIntensity={0.05}
        />
      </m.div>
    </div>
  )
}
