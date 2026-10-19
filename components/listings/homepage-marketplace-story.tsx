import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { OfferTimelineCard } from '@/components/home/offer-timeline-card'
import { OrderProgress } from '@/components/home/order-progress'
import { LocalTabContent } from '@/components/ui/local-tab-content'
import { homepageListingDemo as listing } from '@/lib/fixtures/homepage-listing-demo'

import layout from './homepage-listing-demo.module.css'
import styles from './homepage-marketplace-story.module.css'
import { ListingCardPreview } from './listing-card-presentation'

const stages = [
  {
    id: 'find',
    title: 'Find',
    copy: 'Browse Resale or discover Shops and find something worth a closer look.',
  },
  {
    id: 'connect',
    title: 'Connect',
    copy: 'Message the seller, ask questions, and make or negotiate an offer in one conversation.',
  },
  {
    id: 'agree',
    title: 'Agree',
    copy: 'Confirm the price, payment method, and how the exchange will happen.',
  },
  {
    id: 'exchange',
    title: 'Exchange',
    copy: 'Meet or arrange delivery, complete the handoff, and keep the order history together.',
  },
] as const
const exchangeSteps = [
  'Agreement',
  'Payment',
  'Meet / Inspect',
  'Handoff',
  'Protection',
  'Completed',
]

function FlowPreview({ stage }: { stage: typeof stages[number]['id'] }) {
  const [favorite, setFavorite] = useState(false)
  if (stage === 'find')
    return (
      <div className={styles.findCard}>
        <ListingCardPreview
          listing={{ ...listing, category: 'Home & Living' }}
          favorite={favorite}
          onFavorite={setFavorite}
        />
      </div>
    )
  if (stage === 'connect')
    return (
      <div className={styles.conversation}>
        <div className={styles.context}>
          <strong>Seller &middot; Alex</strong>
          <span>{listing.title}</span>
        </div>
        <div className={styles.buyer}>
          <small>Buyer</small>
          <p>Would you take CA$40?</p>
        </div>
        <div className={styles.offerDemo}>
          <OfferTimelineCard
            id="welcome-offer"
            own={true}
            direction="Buyer"
            status="Active"
            positive={true}
            amountCents={4000}
            fields={[]}
          />
        </div>
        <div className={styles.seller}>
          <small>Seller</small>
          <p>How about CA$42?</p>
        </div>
      </div>
    )
  if (stage === 'agree')
    return (
      <div className={styles.agreement}>
        <p className={styles.eyebrow}>Agreement preview</p>
        <h4>{listing.title}</h4>
        <dl>
          <div>
            <dt>Agreed price</dt>
            <dd>CA$42</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>UU Pay</dd>
          </div>
          <div>
            <dt>Fulfillment</dt>
            <dd>Meeting</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Waiting for confirmation</dd>
          </div>
        </dl>
      </div>
    )
  return (
    <div className={styles.exchange}>
      <p className={styles.eyebrow}>Meeting &middot; Pay by UU</p>
      <OrderProgress steps={exchangeSteps} current={2} completed={2} />
      <p>
        Meet / Inspect is current. Handoff, Protection, and completion are still
        ahead.
      </p>
    </div>
  )
}

/** Explanatory UI only. Never loads or changes any real marketplace transaction. */
export function HomepageTransactionDemo() {
  const id = useId()
  const [activeStage, setActiveStage] =
    useState<typeof stages[number]['id']>('find')
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const active = stages.find((stage) => stage.id === activeStage) || stages[0]
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % stages.length
    else if (event.key === 'ArrowLeft')
      next = (index + stages.length - 1) % stages.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = stages.length - 1
    else return
    event.preventDefault()
    setActiveStage(stages[next].id)
    buttons.current[next]?.focus()
  }
  return (
    <section
      className={layout.section}
      aria-labelledby={`${id}-heading`}
      data-home-section="transaction-demo"
    >
      <header className={layout.heading}>
        <h2 id={`${id}-heading`}>From listing to exchange.</h2>
        <p>
          See how a listing moves from discovery to conversation, agreement, and
          a completed exchange.
        </p>
      </header>
      <div
        className={styles.stages}
        role="tablist"
        aria-label="Explore the marketplace flow"
      >
        {stages.map((stage, index) => (
          <button
            key={stage.id}
            ref={(el) => {
              buttons.current[index] = el
            }}
            type="button"
            role="tab"
            id={`${id}-${stage.id}`}
            aria-selected={activeStage === stage.id}
            aria-controls={`${id}-panel`}
            tabIndex={activeStage === stage.id ? 0 : -1}
            onClick={() => setActiveStage(stage.id)}
            onKeyDown={(event) => navigate(event, index)}
          >
            <span className={styles.number} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            {stage.title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${activeStage}`}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focusable ARIA tabpanel for keyboard reading.
        tabIndex={0}
        className={styles.panel}
      >
        <LocalTabContent tab={activeStage}>
          <div className={styles.flow} data-flow-preview={activeStage}>
            <div className={styles.explanation}>
              <p className={styles.eyebrow}>How UU works</p>
              <h3>{active.title}</h3>
              <p>{active.copy}</p>
              <p className={styles.exampleNote}>
                Illustrative example &middot; not a live transaction.
              </p>
            </div>
            <div className={styles.preview}>
              <FlowPreview stage={activeStage} />
            </div>
          </div>
        </LocalTabContent>
      </div>
    </section>
  )
}

const sellingPoints = [
  {
    title: 'Resale when you just want to sell something.',
    copy: 'List everyday items without needing to build a storefront.',
  },
  {
    title: 'Shop when selling becomes a business.',
    copy: 'Create your own storefront, organize Shop listings, and grow with seller tools.',
  },
  {
    title: 'One flow from interest to exchange.',
    copy: 'Messages, offers, agreements, orders, and fulfillment stay connected from start to finish.',
  },
]
export function HomepageStudentSelling() {
  const id = useId()
  return (
    <section
      className={layout.section}
      aria-labelledby={`${id}-heading`}
      data-home-section="student-selling"
    >
      <header className={layout.heading}>
        <h2 id={`${id}-heading`}>Built around real student selling.</h2>
        <p>
          Whether you&apos;re clearing out a room or building a storefront, UU
          keeps the experience connected.
        </p>
      </header>
      <ol className={styles.sellingPoints}>
        {sellingPoints.map((point, index) => (
          <li key={point.title}>
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h3>{point.title}</h3>
              <p>{point.copy}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
