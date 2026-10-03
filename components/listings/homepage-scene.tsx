import { useTransform, useViewportScroll } from 'framer-motion'
import { motion } from 'motion/react'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'

import { useAuthModal } from '@/components/auth/auth-modal'
import { HeroParallax } from '@/components/ui/hero-parallax'
import type { HeroParallaxProduct } from '@/components/ui/hero-parallax'
import type { Listing } from '@/types/listing'

import { HomepageFooter } from './homepage-footer'
import { HomepageListingDemo } from './homepage-listing-demo'
import styles from './homepage-scene.module.css'
import { useHomeReducedMotion } from './use-home-reduced-motion'
import { WelcomeHero } from './welcome-hero'

const GradientWaves = dynamic(
  () =>
    import(
      /* webpackChunkName: 'gradient-waves' */ '@/components/ui/GradientWaves'
    ),
  { ssr: false }
)

// Fractions of the viewport; height is a shader-space value, never a CSS offset.
const WAVE_SCROLL_DISTANCE = 0.8
const WAVE_HEIGHT_TOP = 5.5
const WAVE_HEIGHT_LOWERED = -12
const clamp = (value: number) => Math.min(1, Math.max(0, value))

const Lanyard = dynamic(
  () => import(/* webpackChunkName: 'lanyard' */ '@/components/ui/Lanyard'),
  { ssr: false }
)
const TearTicket = dynamic(
  () =>
    import(/* webpackChunkName: 'tear-ticket' */ '@/components/ui/TearTicket'),
  { ssr: false }
)
export function HomepageScene({
  listings,
  demoProducts,
}: {
  listings: Listing[]
  demoProducts?: HeroParallaxProduct[]
}) {
  const products = useMemo(() => {
    if (demoProducts) return demoProducts
    const real = listings.flatMap((listing) =>
      listing.photoUrls.slice(0, 1).map((image) => ({
        title: listing.title,
        image,
        href: `/listings/${encodeURIComponent(listing.id)}`,
      }))
    )
    // Keep all three rows populated even while the real catalog is small.
    return real.length
      ? Array.from(
          { length: Math.max(3, real.length) },
          (_, i) => real[i % real.length]
        )
      : []
  }, [listings, demoProducts])
  const { openAuth } = useAuthModal()
  const join = () => openAuth({ mode: 'signup', intent: 'join' })
  const [ticketReset, setTicketReset] = useState(0)
  const joinTicket = () =>
    openAuth({
      mode: 'signup',
      intent: 'join',
      onDismiss: () => setTicketReset((value) => value + 1),
    })
  const [ticket, setTicket] = useState<boolean | null>(null)
  useEffect(() => {
    // Includes landscape iPad Pro without replacing Lanyard on desktop laptops.
    const media = window.matchMedia(
      '(max-width: 1199px), (hover: none) and (pointer: coarse) and (max-width: 1366px)'
    )
    const update = () => setTicket(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const reduced = useHomeReducedMotion()
  const { scrollY } = useViewportScroll()
  const [mobile, setMobile] = useState(false)
  const [viewport, setViewport] = useState(900)
  useEffect(() => {
    const resize = () => {
      setViewport(window.innerHeight)
      setMobile(window.innerWidth < 768)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const progress = useTransform(scrollY, (value) =>
    clamp(value / (viewport * WAVE_SCROLL_DISTANCE))
  )
  const horizon = useTransform(progress, (value) =>
    reduced
      ? WAVE_HEIGHT_TOP
      : WAVE_HEIGHT_TOP + (WAVE_HEIGHT_LOWERED - WAVE_HEIGHT_TOP) * value
  )
  return (
    <div className={styles.home}>
      <div className={styles.background} aria-hidden="true">
        <GradientWaves
          horizonColor="#9000ff"
          waveColor="#ff9ffc"
          crestColor="#ffb3b3"
          speed={0.4}
          amplitude={2.5}
          waveScale={0.6}
          waveRatio={0.9}
          swell={35}
          turbulence={20}
          tilt={1.11}
          zoom={1}
          height={horizon}
          fogDepth={15}
          detail="medium"
          brightness={1}
          opacity={1}
          mouseInteraction={true}
          parallaxStrength={0.5}
          grain={true}
          grainIntensity={0.05}
        />
      </div>
      <HeroParallax
        products={products}
        drift={mobile ? 120 : 480}
        className={styles.parallax}
        copyClassName={styles.heroCopy}
      >
        <WelcomeHero
          ticket={ticket === true}
          visual={
            ticket !== null &&
            (ticket ? (
              <motion.div
                className={styles.ticketAmbientWrapper}
                initial={{ x: 0, y: 0, rotate: 0 }}
                animate={
                  reduced === false
                    ? {
                        x: mobile ? [0, -4, 4, 0] : [0, -2, 2, 0],
                        y: mobile ? [0, -8, 8, 0] : [0, -5, 5, 0],
                        rotate: mobile ? [0, -0.7, 0.7, 0] : [0, -0.4, 0.4, 0],
                      }
                    : { x: 0, y: 0, rotate: 0 }
                }
                transition={
                  reduced === false
                    ? {
                        duration: 14,
                        ease: 'easeInOut',
                        repeat: Infinity,
                        repeatType: 'mirror',
                      }
                    : { duration: 0 }
                }
              >
                <TearTicket
                  width={420}
                  height={220}
                  stubSize={120}
                  background="#1c1036"
                  stubBackground="#39205c"
                  borderColor="#bda0e3"
                  rotate={-4}
                  tilt={!reduced}
                  ariaLabel="Tear ticket to log in"
                  stub={<span className={styles.ticketStub}>Tear me off</span>}
                  resetToken={ticketReset}
                  onTear={joinTicket}
                  onActivate={joinTicket}
                >
                  <div className={styles.ticketCopy}>
                    <span>Campus Marketplace</span>
                    <strong>
                      Find it nearby.
                      <br />
                      Pass it on.
                    </strong>
                    <span>For the Western community</span>
                  </div>
                </TearTicket>
              </motion.div>
            ) : (
              <div
                className={styles.lanyardContent}
                aria-label="Pull to join us / drag the hanging card"
              >
                <Lanyard
                  position={[0, 0, 18]}
                  reducedMotion={reduced !== false}
                  frontImage="/lanyard/invitation.svg"
                  backImage="/lanyard/invitation.svg"
                  onJoin={join}
                />
              </div>
            ))
          }
        />
      </HeroParallax>
      {products.length === 0 && (
        <p className={styles.empty}>No listing photos are available yet.</p>
      )}
      <HomepageListingDemo />
      <HomepageFooter />
    </div>
  )
}
