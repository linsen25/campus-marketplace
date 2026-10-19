import dynamic from 'next/dynamic'
import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { useAuthModal } from '@/components/auth/auth-modal'
import { Link } from '@ui/link/link'

import { MarketBrandMark } from './market-brand-mark'
import { useHomeReducedMotion } from './use-home-reduced-motion'
import styles from './welcome-hero.module.css'

const MaskedHeading = dynamic(
  () =>
    import(
      /* webpackChunkName: 'masked-heading' */ '@/components/ui/MaskedHeading'
    ),
  { ssr: false }
)
const TextType = dynamic(
  () => import(/* webpackChunkName: 'text-type' */ '@/components/ui/TextType'),
  { ssr: false }
)
const SUBTITLE_LINES = [
  'Buy and sell second-hand items within the',
  'Western community.',
] as const
const SUBTITLE = SUBTITLE_LINES.join(' ')

export function WelcomeHero({
  visual,
  ticket,
}: {
  visual?: ReactNode
  ticket?: boolean
}) {
  const reduced = useHomeReducedMotion()
  const [firstLineComplete, setFirstLineComplete] = useState(false)
  const completeFirstLine = useCallback(() => setFirstLineComplete(true), [])
  const { openAuth } = useAuthModal()
  return (
    <section className={styles.hero} aria-labelledby="welcome-title">
      <nav className={styles.navigation} aria-label="Welcome navigation">
        <Link href="/" className={styles.brand}>
          <MarketBrandMark />
          <span>Usual & Unusual</span>
        </Link>
        <div className={styles.actions}>
          <ShiningButton
            variant="green"
            desktopAppearance={true}
            onClick={() => openAuth({ mode: 'signin', intent: 'login' })}
          />
        </div>
      </nav>
      <div className={styles.composition}>
        <div className={styles.copy}>
          <h1
            id="welcome-title"
            className={styles.headline}
            aria-label="Find it nearby. Pass it on."
          >
            {reduced === null ? (
              <>
                Find it nearby.
                <br />
                Pass it on.
              </>
            ) : (
              <>
                {['Find it nearby.', 'Pass it on.'].map((line) => (
                  <MaskedHeading
                    key={line}
                    tag="span"
                    text={line}
                    src="/static/images/masked-heading-fill.svg"
                    align="left"
                    weight={900}
                    textScale={0.14}
                    drift={reduced ? 0 : 18}
                    parallax={reduced ? 0 : 26}
                    reveal={reduced ? 'none' : 'rise'}
                    className={styles.maskedLine}
                  />
                ))}
              </>
            )}
          </h1>
          <div className={styles.subtitle} aria-label={SUBTITLE}>
            <span className={styles.subtitleSizer} aria-hidden="true">
              {SUBTITLE_LINES.map((line) => (
                <span key={line} className={styles.subtitleLine}>
                  {line}
                </span>
              ))}
            </span>
            <div className={styles.subtitleText} aria-hidden="true">
              <span className={styles.subtitleLine}>
                {reduced !== false ? (
                  SUBTITLE_LINES[0]
                ) : (
                  <TextType
                    text={SUBTITLE_LINES[0]}
                    as="span"
                    loop={false}
                    showCursor={false}
                    typingSpeed={30}
                    initialDelay={150}
                    onTypingComplete={completeFirstLine}
                  />
                )}
              </span>
              <span className={styles.subtitleLine}>
                {reduced !== false
                  ? SUBTITLE_LINES[1]
                  : firstLineComplete && (
                      <TextType
                        text={SUBTITLE_LINES[1]}
                        as="span"
                        loop={false}
                        showCursor={false}
                        typingSpeed={30}
                      />
                    )}
              </span>
            </div>
          </div>
        </div>
        <div className={styles.visuals}>
          <div className={ticket ? styles.ticket : styles.lanyard}>
            {visual}
          </div>
        </div>
      </div>
    </section>
  )
}
