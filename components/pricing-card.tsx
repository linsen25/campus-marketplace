'use client'

// Adapted from the supplied useLayouts card; presentation only, no entitlement authority.
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import NumberFlow from '@number-flow/react'
import { Gift } from 'lucide-react'
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react'
import { useId, useState } from 'react'

import styles from './pricing-card.module.css'

const plans = {
  plus: {
    name: 'Plus',
    subtitle: 'Run your shop',
    features: [
      'Your own storefront',
      'Product & inventory management',
      'Customer reviews',
      'Sales analytics',
      'Billing & sales records',
    ],
  },
  pro: {
    name: 'Pro',
    subtitle: 'Grow your shop',
    features: [
      'Everything in Plus',
      'Featured Shop promotion',
      'Promotion performance analytics',
    ],
  },
} as const
const billingPrices = {
  plus: { auto: 1.99, 'one-time': 2.99 },
  pro: { auto: 4.99, 'one-time': 5.99 },
} as const
const TRANSITION = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 30,
  mass: 0.8,
}

/** Must come from future server authority. Unavailable never implies eligibility. */
export type ShopTrialEligibility = 'eligible' | 'ineligible' | 'unavailable'

export default function PricingCard({
  trialEligibility = 'unavailable',
  showTrialPreview = false,
}: {
  trialEligibility?: ShopTrialEligibility
  /** Visual prototype only; does not assert eligibility or grant access. */
  showTrialPreview?: boolean
}) {
  const id = useId()
  const reduced = useReducedMotion()
  const [selectedPlan, setSelectedPlan] = useState<keyof typeof plans>('plus')
  const [billingMode, setBillingMode] = useState<'auto' | 'one-time'>('auto')
  const plan = plans[selectedPlan]
  const price = billingPrices[selectedPlan][billingMode]
  const showTrial = showTrialPreview || trialEligibility === 'eligible'
  const displayPrice = `CA$${price.toFixed(2)}`
  return (
    <LayoutGroup id={id}>
      <section
        data-pricing-card={true}
        data-trial-eligibility={trialEligibility}
        className={styles.card}
        aria-labelledby={`${id}-title`}
      >
        <header className={styles.intro}>
          <h2 id={`${id}-title`}>Choose your plan</h2>
          <p>Start your student shop and reach more buyers.</p>
        </header>
        <div className={styles.switcher} role="group" aria-label="Shop plan">
          {(['plus', 'pro'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={selectedPlan === key}
              aria-controls={`${id}-details`}
              onClick={() => setSelectedPlan(key)}
            >
              {selectedPlan === key && (
                <motion.span
                  layoutId="tab-bg"
                  className={styles.tabBackground}
                  transition={reduced ? { duration: 0 } : TRANSITION}
                />
              )}
              <span className={styles.tabText}>{plans[key].name}</span>
            </button>
          ))}
        </div>
        <fieldset className={styles.billing}>
          <legend>Billing option</legend>
          {(
            [
              ['auto', 'Auto-renew', 'Save CA$1 every month'],
              ['one-time', 'One month', 'Pay once · No automatic renewal'],
            ] as const
          ).map(([value, label, description]) => (
            <motion.label
              key={value}
              className={styles.billingRow}
              initial={false}
              data-selected={billingMode === value}
              animate={{
                backgroundColor:
                  billingMode === value
                    ? 'rgba(255,255,255,0.10)'
                    : 'rgba(255,255,255,0)',
                borderColor:
                  billingMode === value
                    ? 'rgba(255,255,255,0.45)'
                    : 'rgba(255,255,255,0.141176)',
              }}
              transition={{ duration: reduced ? 0 : 0.18 }}
            >
              <input
                type="radio"
                name={`${id}-billing`}
                value={value}
                checked={billingMode === value}
                aria-labelledby={`${id}-${value}-label`}
                aria-describedby={`${id}-${value}-description`}
                onChange={() => setBillingMode(value)}
              />
              <span className={styles.billingCircle} aria-hidden="true">
                <motion.span
                  initial={false}
                  animate={{
                    opacity: billingMode === value ? 1 : 0,
                    scale: reduced || billingMode === value ? 1 : 0.6,
                  }}
                  transition={{ duration: reduced ? 0 : 0.18 }}
                />
              </span>
              <span className={styles.billingText}>
                <span id={`${id}-${value}-label`}>{label}</span>
                <small id={`${id}-${value}-description`}>{description}</small>
              </span>
            </motion.label>
          ))}
        </fieldset>
        <div
          className={styles.plan}
          id={`${id}-details`}
          data-plan-detail={selectedPlan}
          aria-live="polite"
          aria-atomic="true"
        >
          <header className={styles.planHeading}>
            <div>
              <h3>{plan.name}</h3>
              <p>{plan.subtitle}</p>
            </div>
            <div className={styles.price}>
              <span className={styles.priceValue}>
                <span>CA$</span>
                <NumberFlow
                  data-plan-price={true}
                  value={price}
                  locales="en-CA"
                  format={{
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }}
                  animated={!reduced}
                />
              </span>
              <small>{billingMode === 'auto' ? '/ month' : 'one-time'}</small>
            </div>
          </header>
          <div className={styles.divider} />
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={selectedPlan}
              initial={{
                height: reduced ? 'auto' : 0,
                opacity: reduced ? 1 : 0,
              }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: reduced ? 'auto' : 0, opacity: reduced ? 1 : 0 }}
              transition={{
                duration: reduced ? 0 : 0.4,
                ease: [0.32, 0.72, 0, 1],
              }}
              className={styles.reveal}
              data-plan-features={selectedPlan}
            >
              <ul className={styles.features}>
                {plan.features.map((feature, idx) => (
                  <motion.li
                    key={feature}
                    initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: reduced ? 0 : idx * 0.05,
                      duration: reduced ? 0 : 0.3,
                    }}
                  >
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={18}
                      aria-hidden="true"
                    />
                    <span>{feature}</span>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          </AnimatePresence>
        </div>
        <footer className={styles.actions}>
          {showTrial && (
            <>
              <button type="button" className={styles.trial}>
                <Gift size={18} aria-hidden="true" />
                Start 2-Month Free Pro Trial
              </button>
              <p className={styles.disclaimer}>
                No credit card required &middot; No automatic charges
              </p>
              <div className={styles.or}>
                <span>OR</span>
              </div>
            </>
          )}
          <button type="button" className={styles.continue}>
            Continue with {plan.name} &middot; {displayPrice}
            {billingMode === 'auto' ? '/mo' : ' one-time'}
          </button>
          {showTrial && (
            <p className={styles.note}>
              New sellers can try Pro for 2 months. After the trial, choose
              Plus, Pro, or continue without paid Shop features.
            </p>
          )}
        </footer>
      </section>
    </LayoutGroup>
  )
}
