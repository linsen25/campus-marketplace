import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { useAuthModal } from '@/components/auth/auth-modal'
import PulseHeart from '@/components/react-bits/pulse-heart'
import { ExpandableCard } from '@/components/velora/expandable-card'
import { homepageListingDemo as example } from '@/lib/fixtures/homepage-listing-demo'
import { listingConditions } from '@/lib/listing-metadata'
import { formatListingPrice } from '@/utils/format-listing-price'

import styles from './homepage-listing-demo.module.css'
import { ListingMedia } from './listing-media'
import { useHomeReducedMotion } from './use-home-reduced-motion'
import card from './welcome-demo-cards.module.css'

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

// Existing ExpandableCard trigger/mobile-dialog radius, unified for this demo only.
const welcomeListingRadius = 16
const exchangePreferences = {
  payment: 'UU Pay',
  fulfillment: 'Meeting',
  meetingArea: 'Western University',
}

export function HomepageListingDemo() {
  const reduced = useHomeReducedMotion()
  const { openAuth } = useAuthModal()
  const [favorite, setFavorite] = useState(false)
  const category = 'Home & Living'
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
      <div className={`${styles.columns} ${card.listingDemoRow}`}>
        <motion.div data-demo-enter="card" {...enter(0.12)}>
          <div className={card.cardShell}>
            <ExpandableCard
              className={card.listingCard}
              visualRadius={welcomeListingRadius}
              overlayClassName={card.listingOverlay}
              collapsedContent={
                <span className={card.listingSummary}>
                  <span className={card.price}>
                    {formatListingPrice(example.price)}
                  </span>
                  <span className={card.listingTitle}>{example.title}</span>
                  <span className={card.meta}>
                    {condition} &middot; {category}
                  </span>
                </span>
              }
              title={formatListingPrice(example.price)}
              expandedTitle={example.title}
              media={
                <ListingMedia
                  images={example.photoUrls}
                  alt="Wooden accent chair"
                />
              }
              topAction={
                <PulseHeart
                  appearance="image-overlay"
                  liked={favorite}
                  showCount={false}
                  size={26}
                  corner={22}
                  idleColor="#b9a9c5"
                  likedColor="#d97991"
                  pillColor="transparent"
                  label={
                    favorite ? 'Remove from favorites' : 'Add to favorites'
                  }
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
                <section
                  className={card.listingDetailGroup}
                  aria-label="Seller"
                >
                  <h4>Seller</h4>
                  <p>{example.seller.displayName}</p>
                  <WesternEmailVerification
                    verified={example.seller.westernEmailVerified}
                  />
                </section>
                <section
                  className={card.listingDetailGroup}
                  aria-label="Item details"
                >
                  <h4>Item details</h4>
                  <dl className={styles.metadata}>
                    {condition && (
                      <>
                        <dt>Condition</dt>
                        <dd>{condition}</dd>
                      </>
                    )}
                    {category && (
                      <>
                        <dt>Category</dt>
                        <dd>{category}</dd>
                      </>
                    )}
                    {example.subcategory && (
                      <>
                        <dt>Subcategory</dt>
                        <dd>{example.subcategory}</dd>
                      </>
                    )}
                  </dl>
                </section>
                {example.description && (
                  <section
                    className={card.listingDetailGroup}
                    aria-label="Description"
                  >
                    <h4>Description</h4>
                    <p className={styles.description}>{example.description}</p>
                  </section>
                )}
                <section
                  className={card.listingDetailGroup}
                  aria-label="Exchange preferences"
                >
                  <h4>Exchange preferences</h4>
                  <dl className={styles.metadata}>
                    {exchangePreferences.payment && (
                      <>
                        <dt>Payment</dt>
                        <dd>{exchangePreferences.payment}</dd>
                      </>
                    )}
                    {exchangePreferences.fulfillment && (
                      <>
                        <dt>Fulfillment</dt>
                        <dd>{exchangePreferences.fulfillment}</dd>
                      </>
                    )}
                    {exchangePreferences.meetingArea && (
                      <>
                        <dt>Meeting area</dt>
                        <dd>{exchangePreferences.meetingArea}</dd>
                      </>
                    )}
                  </dl>
                </section>
              </div>
            </ExpandableCard>
            <div className={card.imageFavorite}>
              <PulseHeart
                appearance="image-overlay"
                liked={favorite}
                showCount={false}
                size={26}
                corner={24}
                idleColor="#4d574d"
                likedColor="#d97991"
                pillColor="transparent"
                className={card.heart}
                label={
                  favorite ? 'Unfavorite demo listing' : 'Favorite demo listing'
                }
                onChange={setFavorite}
              />
            </div>
          </div>
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
