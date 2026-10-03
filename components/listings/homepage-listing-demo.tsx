import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { useAuthModal } from '@/components/auth/auth-modal'
import PulseHeart from '@/components/react-bits/pulse-heart'
import { ExpandableCard } from '@/components/velora/expandable-card'
import { homepageListingDemo as example } from '@/lib/fixtures/homepage-listing-demo'
import { listingCategories, listingConditions } from '@/lib/listing-metadata'
import { formatListingPrice } from '@/utils/format-listing-price'

import styles from './homepage-listing-demo.module.css'
import { ListingMedia } from './listing-media'
import { useHomeReducedMotion } from './use-home-reduced-motion'

export function WesternEmailVerification({ verified }: { verified: boolean }) {
  if (!verified) return null
  return (
    <p className={styles.verified}>
      <span className={styles.verifiedMark} aria-hidden="true">
        <Check size={10} strokeWidth={3} />
      </span>
      Western email verified
    </p>
  )
}

export function HomepageListingDemo() {
  const reduced = useHomeReducedMotion()
  const { openAuth } = useAuthModal()
  const [favorite, setFavorite] = useState(false)
  const category = listingCategories.find(
    (item) => item.value === example.category
  )?.label
  const condition = listingConditions.find(
    (item) => item.value === example.condition
  )?.label
  const enter = (delay: number) => ({
    initial: reduced === true ? (false as const) : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.15 },
    transition: {
      duration: reduced === false ? 0.5 : 0,
      delay: reduced === false ? delay : 0,
      ease: 'easeOut' as const,
    },
  })
  return (
    <section
      className={styles.section}
      aria-labelledby="listing-demo-heading"
      data-home-section="listing-demo"
    >
      <motion.header
        data-demo-enter="heading"
        {...enter(0)}
        className={styles.heading}
      >
        <h2 id="listing-demo-heading">
          Take a closer look. Then connect with the seller.
        </h2>
        <p>
          Expand the listing to see more details, or watch how easy it is to
          create your own.
        </p>
      </motion.header>
      <div className={styles.columns}>
        <motion.div data-demo-enter="card" {...enter(0.12)}>
          <ExpandableCard
            title={formatListingPrice(example.price)}
            expandedTitle={example.title}
            media={
              <ListingMedia
                images={example.photoUrls}
                alt="Woven accent chair beside a planter"
              />
            }
            topAction={
              <PulseHeart
                liked={favorite}
                showCount={false}
                size={26}
                corner={22}
                idleColor="#b9a9c5"
                likedColor="#d97991"
                pillColor="transparent"
                label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                onChange={(liked: boolean) => setFavorite(liked)}
              />
            }
            primaryAction={
              <ShiningButton
                variant="green"
                desktopAppearance={true}
                onClick={() =>
                  openAuth({ mode: 'signin', intent: 'contact-seller' })
                }
              >
                Contact seller
              </ShiningButton>
            }
          >
            <div className={styles.details}>
              <h4>Seller</h4>
              <p>{example.seller.displayName}</p>
              <WesternEmailVerification
                verified={example.seller.westernEmailVerified}
              />
              <dl className={styles.metadata}>
                <dt>Condition</dt>
                <dd>{condition || 'Not specified'}</dd>
                <dt>Category</dt>
                <dd>{category}</dd>
              </dl>
              <h4>Description</h4>
              <p className={styles.description}>{example.description}</p>
            </div>
          </ExpandableCard>
        </motion.div>
        <motion.div
          data-demo-enter="video"
          {...enter(0.24)}
          className={styles.videoColumn}
        >
          <div
            className={styles.videoSlot}
            aria-label="Create Listing Demo video placeholder"
          >
            <p>Create Listing Demo</p>
          </div>
          <p className={styles.note}>Tutorial video coming soon.</p>
        </motion.div>
      </div>
    </section>
  )
}
