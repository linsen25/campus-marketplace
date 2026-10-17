import { Check } from 'lucide-react'
import { useId, useState } from 'react'
import type { CSSProperties } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { SHOP_PRO_PLANS } from '@/lib/shop-pro-plans'

import styles from './shop-pro-pricing.module.css'

const continuePreview = () => undefined

/** Shared UI shell only. Selection never changes Shop capability or persisted state. */
export function ShopProPricing({ sheet = false }: { sheet?: boolean }) {
  const id = useId()
  const [selectedPlan, setSelectedPlan] = useState<string>('3-month')
  return (
    <section
      className={styles.pricing}
      aria-labelledby={`${id}-title`}
      data-shop-pro-pricing="true"
      data-sheet-entrance={sheet || undefined}
    >
      <header>
        <h3 id={`${id}-title`}>Shop Pro</h3>
        <p>Build your own storefront and unlock shop features.</p>
      </header>
      <fieldset className={styles.plans}>
        <legend className={styles.srOnly}>Choose a Shop Pro plan</legend>
        {SHOP_PRO_PLANS.map((plan, index) => (
          <label
            key={plan.id}
            className={styles.plan}
            data-selected={selectedPlan === plan.id}
            style={{ '--plan-index': index } as CSSProperties}
          >
            <input
              type="radio"
              name={`${id}-plan`}
              value={plan.id}
              checked={selectedPlan === plan.id}
              onChange={() => setSelectedPlan(plan.id)}
            />
            <span className={styles.planHeading}>
              <span>{plan.label}</span>
              {plan.badge && <span className={styles.badge}>{plan.badge}</span>}
            </span>
            <span className={styles.positioning}>
              {plan.positioning || '\u00a0'}
            </span>
            <span className={styles.price}>{plan.displayPrice}</span>
            <span className={styles.monthly}>{plan.monthlyPrice}</span>
            <span className={styles.savings}>{plan.savings || '\u00a0'}</span>
            <span className={styles.description}>{plan.description}</span>
            <ul className={styles.features}>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={17} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
            {plan.featureNote && (
              <span className={styles.featureNote}>{plan.featureNote}</span>
            )}
          </label>
        ))}
      </fieldset>
      <p className={styles.expiry}>
        Your Shop and listings stay saved if your plan ends. Resubscribe anytime
        to reopen your storefront.
      </p>
      <footer className={styles.footer}>
        <ShiningButton variant="green" onClick={continuePreview}>
          Continue
        </ShiningButton>
      </footer>
    </section>
  )
}
