import { ArrowUp, UserRound } from 'lucide-react'
import { motion } from 'motion/react'
import dynamic from 'next/dynamic'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import ShiningButton from '@/components/animata/button/shining-button'
import WorkButton, {
  WorkProfile,
} from '@/components/animata/button/work-button'
import { useAuthModal } from '@/components/auth/auth-modal'
import DiscoverButton from '@/components/discover-button'
import FilterInteraction from '@/components/filter-interaction'
import InfiniteGrid from '@/components/infinite-grid'
import gridStyles from '@/components/infinite-grid.module.css'
import PulseHeart from '@/components/react-bits/pulse-heart'
import { ExpandableCard } from '@/components/velora/expandable-card'
import { useMarketScroll } from '@/hooks/use-market-scroll'
import type { MarketPreviewListing } from '@/lib/fixtures/market-layout'
import { marketPreviewListings } from '@/lib/fixtures/market-layout'
import type { ListingFilterValues } from '@/lib/listing-filters'
import {
  normalizeSearchQuery,
  searchListings,
  searchSuggestions,
} from '@/lib/market-search'
import type { SearchSuggestion } from '@/lib/market-search'
import { marketSorts } from '@/lib/market-taxonomy'
import { formatListingPrice } from '@/utils/format-listing-price'

import detailStyles from './homepage-listing-demo.module.css'
import { ListingMedia } from './listing-media'
import MarketFilter from './market-filter'
import type { MarketFilterValues } from './market-filter'
import styles from './market-layout.module.css'
import welcomeStyles from './welcome-hero.module.css'

const GradientWaves = dynamic(
  () =>
    import(
      /* webpackChunkName: 'market-gradient-waves' */ '@/components/ui/GradientWaves'
    ),
  {
    ssr: false,
  }
)
// Thin fixture adapter: the accepted Welcome card owns all expansion behavior.
function MarketCard({
  listing,
  headerHeight,
  onOverlayActiveChange,
}: {
  listing: MarketPreviewListing
  headerHeight: number
  onOverlayActiveChange: (active: boolean) => void
}) {
  const { openAuth } = useAuthModal()
  const [favorite, setFavorite] = useState(false)
  return (
    <ExpandableCard
      overlayClassName={styles.listingOverlay}
      overlayStyle={
        { '--market-header-height': `${headerHeight}px` } as CSSProperties
      }
      title={listing.price === 0 ? 'Free' : formatListingPrice(listing.price)}
      expandedTitle={listing.title}
      media={<ListingMedia images={listing.images} alt={listing.title} />}
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
          onClick={() => openAuth({ mode: 'signin', intent: 'contact-seller' })}
        >
          Contact seller
        </ShiningButton>
      }
      onOverlayActiveChange={onOverlayActiveChange}
    >
      <div className={detailStyles.details}>
        <p className={styles.mobileListingLocation}>
          Location: {listing.location}
        </p>
        <h4>Seller</h4>
        <p>{listing.sellerUsername}</p>
        <dl className={detailStyles.metadata}>
          <dt>Condition</dt>
          <dd>{listing.condition}</dd>
          <dt>Category</dt>
          <dd>{listing.category}</dd>
        </dl>
        <h4>Description</h4>
        <p className={detailStyles.description}>{listing.description}</p>
      </div>
    </ExpandableCard>
  )
}

export function MarketLayout({ values }: { values: ListingFilterValues }) {
  const [isApp, setIsApp] = useState(false)
  const [pageNumber, setPageNumber] = useState(1)
  const toolbar = useRef<HTMLElement>(null)
  const browsingTop = useRef<HTMLDivElement>(null)
  const pageScroll = useRef<ReturnType<typeof setTimeout>>()
  const { animateTo, cancel: cancelScroll } = useMarketScroll()
  const [showReturnTop, setShowReturnTop] = useState(false)
  useEffect(() => {
    const update = () => {
      setShowReturnTop(window.scrollY > 300)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  const [headerHeight, setHeaderHeight] = useState(0)
  const [headerWidth, setHeaderWidth] = useState(0)
  const [cardActive, setCardActive] = useState(false)
  const cardPresence = useCallback((active: boolean) => {
    // Fixed descendants bypass the body's scrollbar compensation. Preserve
    // the real unlocked header width before changing its positioning.
    if (active && toolbar.current)
      setHeaderWidth(toolbar.current.getBoundingClientRect().width)
    setCardActive(active)
  }, [])
  const [appliedQuery, setAppliedQuery] = useState(
    normalizeSearchQuery(values.search)
  )
  const [draftQuery, setDraftQuery] = useState(appliedQuery)
  useEffect(
    () => setAppliedQuery(normalizeSearchQuery(values.search)),
    [values.search]
  )
  const [searchDismissSignal, setSearchDismissSignal] = useState(0)
  const suggestions = useMemo(
    () => searchSuggestions(marketPreviewListings, draftQuery),
    [draftQuery]
  )
  const cancelPageScroll = useCallback(() => {
    clearTimeout(pageScroll.current)
    cancelScroll()
  }, [cancelScroll])
  useEffect(() => {
    const header = toolbar.current
    if (!header) return undefined
    const observer = new ResizeObserver(() =>
      setHeaderHeight(header.getBoundingClientRect().height)
    )
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  const [closing, setClosing] = useState(false)
  useEffect(
    () => () => {
      cancelPageScroll()
    },
    [cancelPageScroll]
  )
  const scrollToBrowsingTop = () => {
    const target = browsingTop.current
    if (!target) return
    const offset = toolbar.current?.getBoundingClientRect().height || 0
    const destination = Math.max(
      0,
      window.scrollY + target.getBoundingClientRect().top - offset
    )
    animateTo(destination)
  }
  const changePage = (page: number) => {
    if (page === pageNumber) return
    cancelPageScroll()
    setPageNumber(page)
    pageScroll.current = setTimeout(scrollToBrowsingTop, 200)
  }
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)')
    const update = () => {
      cancelPageScroll()
      setIsApp(query.matches)
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [cancelPageScroll])
  const [applied, setApplied] = useState<MarketFilterValues>({
    category: '',
    subcategory: '',
    place: '',
  })
  const category = applied.category
  const location = applied.place
  const [activePanel, setActivePanel] = useState<
    'filter' | 'search' | 'sort' | null
  >(null)
  const closePanel = useCallback(() => {
    if (activePanel === 'search') setSearchDismissSignal((signal) => signal + 1)
    setClosing(true)
  }, [activePanel])
  const searchFocus = useCallback((open: boolean) => {
    if (!open) {
      setClosing(true)
      return
    }
    setClosing(false)
    setActivePanel('search')
  }, [])
  const openSort = useCallback(
    (open: boolean) => {
      if (!open) {
        closePanel()
        return
      }
      setClosing(false)
      setActivePanel('sort')
    },
    [closePanel]
  )
  const openFilter = useCallback(
    (open: boolean) => {
      if (!open) {
        closePanel()
        return
      }
      setClosing(false)
      setActivePanel('filter')
    },
    [closePanel]
  )
  const [sort, setSort] = useState('newest')
  useEffect(() => {
    cancelPageScroll()
    setPageNumber(1)
  }, [
    category,
    location,
    applied.subcategory,
    sort,
    appliedQuery,
    cancelPageScroll,
  ])
  const items = useMemo(
    () =>
      searchListings(marketPreviewListings, appliedQuery)
        .filter(
          (listing) =>
            (!category || listing.category === category) &&
            (!location || listing.location === location) &&
            (!applied.subcategory ||
              listing.subcategory === applied.subcategory)
        )
        .sort((a, b) => {
          if (sort === 'price-asc') return a.price - b.price
          if (sort === 'price-desc') return b.price - a.price
          return appliedQuery ? 0 : b.createdAt.localeCompare(a.createdAt)
        })
        .map((listing) => ({
          id: listing.id,
          title: listing.title,
          customContent: (
            <MarketCard
              listing={listing}
              headerHeight={headerHeight}
              onOverlayActiveChange={cardPresence}
            />
          ),
        })),
    [
      category,
      location,
      applied.subcategory,
      sort,
      appliedQuery,
      headerHeight,
      cardPresence,
    ]
  )
  const browsing = isApp ? (
    <InfiniteGrid
      key={`${category}-${applied.subcategory}-${location}-${sort}-${appliedQuery}`}
      items={items}
    />
  ) : (
    <>
      <div
        className={gridStyles.root}
        data-market-grid="true"
        data-browsing="pagination"
      >
        <div className={gridStyles.grid}>
          {items.slice((pageNumber - 1) * 15, pageNumber * 15).map((item) => (
            <div
              key={item.id}
              className={gridStyles.item}
              data-market-card="true"
            >
              {item.customContent}
            </div>
          ))}
        </div>
      </div>
      <nav className={styles.pagination} aria-label="Listing pages">
        <WorkButton
          appearance="pagination"
          type="button"
          disabled={pageNumber === 1}
          onClick={() => changePage(pageNumber - 1)}
        >
          Previous
        </WorkButton>
        {Array.from({ length: Math.ceil(items.length / 15) }, (_, index) => (
          <WorkButton
            key={index + 1}
            appearance="pagination"
            aria-label={`Page ${index + 1}`}
            aria-current={pageNumber === index + 1 ? 'page' : undefined}
            onClick={() => changePage(index + 1)}
          >
            {index + 1}
          </WorkButton>
        ))}
        <span aria-live="polite">
          Page {pageNumber} of {Math.ceil(items.length / 15)}
        </span>
        <WorkButton
          appearance="pagination"
          type="button"
          disabled={pageNumber >= Math.ceil(items.length / 15)}
          onClick={() => changePage(pageNumber + 1)}
        >
          Next
        </WorkButton>
      </nav>
    </>
  )
  return (
    <main className={styles.page}>
      {!isApp && showReturnTop && (
        <button
          type="button"
          aria-label="Return to top"
          className={styles.returnTop}
          onClick={() => {
            cancelPageScroll()
            scrollToBrowsingTop()
          }}
        >
          <ArrowUp size={22} />
        </button>
      )}
      {activePanel &&
        createPortal(
          <motion.button
            type="button"
            className={styles.focusBackdrop}
            data-market-focus-backdrop="true"
            aria-label={
              activePanel === 'search'
                ? 'Dismiss search suggestions'
                : 'Close filter or sort'
            }
            initial={{
              opacity: 0,
              backdropFilter: 'blur(0px)',
              backgroundColor: 'rgba(15,10,22,0)',
            }}
            animate={{
              opacity: closing ? 0 : 1,
              backdropFilter: closing ? 'blur(0px)' : 'blur(4px)',
              backgroundColor: closing
                ? 'rgba(15,10,22,0)'
                : 'rgba(15,10,22,0.18)',
            }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onAnimationComplete={() => {
              if (closing) {
                setActivePanel(null)
                setClosing(false)
              }
            }}
            onClick={closePanel}
          />,
          document.body
        )}
      <div
        className={styles.background}
        aria-hidden="true"
        data-market-background="lowered"
      >
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
      </div>
      {cardActive && (
        <div aria-hidden="true" style={{ height: headerHeight }} />
      )}
      <header
        ref={toolbar}
        style={{ '--market-header-width': `${headerWidth}px` } as CSSProperties}
        className={`${styles.stickyHeader} ${
          cardActive ? styles.pinnedHeader : ''
        }`}
      >
        <div className={styles.mobileBrand}>
          <span aria-hidden="true" className={styles.brandAccent}>
            ✦
          </span>
          <span>Campus Marketplace</span>
        </div>
        <div className={styles.toolbar}>
          <h1 className={`${welcomeStyles.brand} ${styles.brandHeading}`}>
            Campus Marketplace
          </h1>
          <div className={styles.discoverSpace}>
            <DiscoverButton
              query={appliedQuery}
              suggestions={suggestions}
              focusActive={activePanel === 'search'}
              focusClosing={closing}
              dismissSignal={searchDismissSignal}
              onDraftChange={setDraftQuery}
              onApply={(query) => {
                setAppliedQuery(query)
                setPageNumber(1)
                cancelPageScroll()
              }}
              onFocusChange={searchFocus}
              onDismiss={() => {
                setSearchDismissSignal((signal) => signal + 1)
                if (activePanel === 'search') setClosing(true)
              }}
              onSelect={(suggestion: SearchSuggestion) => {
                if (suggestion.kind === 'search') {
                  setAppliedQuery(suggestion.query)
                  setPageNumber(1)
                  cancelPageScroll()
                } else if (suggestion.kind === 'listing') {
                  setAppliedQuery(normalizeSearchQuery(suggestion.label))
                  setPageNumber(1)
                  cancelPageScroll()
                } else {
                  setApplied((previous) => ({
                    ...previous,
                    category:
                      suggestion.category as MarketFilterValues['category'],
                    subcategory: suggestion.subcategory,
                  }))
                  setAppliedQuery('')
                  setPageNumber(1)
                  cancelPageScroll()
                  setSearchDismissSignal((signal) => signal + 1)
                }
                setClosing(true)
              }}
            />
          </div>
          <div className={styles.controls}>
            <div id="listing-sort-label">
              <FilterInteraction
                label="Sort"
                isOpen={activePanel === 'sort'}
                isClosing={closing}
                options={[...marketSorts]}
                value={sort}
                onOpenChange={openSort}
                onChange={setSort}
              />
            </div>
            <FilterInteraction
              label="Filter"
              isOpen={activePanel === 'filter'}
              isClosing={closing}
              onOpenChange={openFilter}
            >
              <MarketFilter
                applied={applied}
                onCancel={() => openFilter(false)}
                onConfirm={(draft) => {
                  setApplied(draft)
                  openFilter(false)
                }}
              />
            </FilterInteraction>
          </div>
          <nav className={styles.desktopNav} aria-label="Market navigation">
            <WorkProfile href="/profile/listings">
              <UserRound size={24} />
            </WorkProfile>
          </nav>
        </div>
      </header>
      <div ref={browsingTop} className={styles.content}>
        {items.length ? (
          browsing
        ) : (
          <p role="status">
            {appliedQuery
              ? `No listings found for "${appliedQuery}"`
              : 'No listings match your filters. Try another search or clear the filters.'}
          </p>
        )}
      </div>
    </main>
  )
}
