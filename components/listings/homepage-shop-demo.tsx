import { motion } from 'motion/react'

import { ShopCard } from '@/components/shops/shop-card'
import { homepageShopDemo } from '@/lib/fixtures/homepage-shop-demo'

import styles from './homepage-listing-demo.module.css'
import { useHomeReducedMotion } from './use-home-reduced-motion'

export function HomepageShopDemo() {
  const reduced = useHomeReducedMotion()
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
      aria-labelledby="shop-demo-heading"
      data-home-section="shop-demo"
    >
      <motion.header
        className={styles.heading}
        data-demo-enter="heading"
        {...enter(0)}
      >
        <h2 id="shop-demo-heading">
          Build your business. Then grow your own shop.
        </h2>
        <p>
          Create a storefront, organize your listings, and show how Shop helps
          sellers grow beyond everyday resale.
        </p>
      </motion.header>
      <div className={styles.columns}>
        <motion.div data-demo-enter="card" {...enter(0.12)}>
          <ShopCard shop={homepageShopDemo} preview={true} />
        </motion.div>
        <motion.div
          className={styles.videoColumn}
          data-demo-enter="video"
          {...enter(0.24)}
        >
          <div
            className={styles.videoSlot}
            aria-label="Create Shop Demo video placeholder"
          >
            <p>Create Shop Demo</p>
          </div>
          <p className={styles.note}>Tutorial video coming soon.</p>
        </motion.div>
      </div>
    </section>
  )
}
