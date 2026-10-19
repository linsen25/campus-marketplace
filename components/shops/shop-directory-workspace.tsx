import {
  AnimatePresence,
  m,
  useIsPresent,
  useReducedMotion,
} from 'framer-motion'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'

import { MarketPagination } from '@/components/listings/market-pagination'
import card from '@/components/listings/welcome-demo-cards.module.css'
import { listingLayoutTransition } from '@/lib/listing-layout-motion'
import { browseShops, defaultShopDirectoryQuery } from '@/lib/shop-directory'
import type { ShopDirectoryQuery } from '@/lib/shop-directory'
import type { ShopPreview } from '@/types/shop'

import { recommendedShopsDemo } from './recommended-shops-demo'
import { RecommendedShopsSlider } from './recommended-shops-slider'
import { ShopCard } from './shop-card'
import { ShopCardPresentation } from './shop-card-presentation'
import { ShopDemoOpenAction } from './shop-demo-action'
import { demoShopLoading } from './shop-demo-data'
import { ShopDetailDemo, ShopDetailSkeleton } from './shop-detail-demo'
import styles from './shop-detail-demo.module.css'
import discovery from './shop-discovery.module.css'
import { ShopProducts } from './shop-products'
import { useShopSectionScroll } from './use-shop-section-scroll'

type View = 'detail' | 'list' | 'loading'
function WorkspacePanel({
  children,
  reduced,
}: {
  children: ReactNode
  reduced: boolean | null
}) {
  const present = useIsPresent()
  return (
    <m.div
      {...{ inert: present ? undefined : '' }}
      aria-hidden={!present}
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : -8 }}
      transition={{ duration: reduced ? 0 : 0.12 }}
      style={{ pointerEvents: present ? 'auto' : 'none' }}
    >
      {children}
    </m.div>
  )
}
export function ShopDirectoryWorkspace({
  directoryHeader,
  query = defaultShopDirectoryQuery,
  shops = [],
  onDetailActiveChange,
  onOverlayActiveChange,
  overlayClassName,
  overlayStyle,
}: {
  directoryHeader?: ReactNode
  query?: ShopDirectoryQuery
  shops?: readonly ShopPreview[]
  onDetailActiveChange?: (active: boolean) => void
  onOverlayActiveChange?: (value: boolean) => void
  overlayClassName?: string
  overlayStyle?: CSSProperties
}) {
  const reduced = useReducedMotion()
  const [view, setView] = useState<View>('list')
  const currentView = useRef<View>('list')
  const [favorite, setFavorite] = useState(false)
  const [directoryFavorites, setDirectoryFavorites] = useState<
    Record<string, boolean>
  >({})
  const results = browseShops(recommendedShopsDemo, query)
  const publicResults = browseShops(shops, query)
  const real = shops.length > 0
  const [expanded, setExpanded] = useState(false)
  const [shopPage, setShopPage] = useState(1)
  const heading = useRef<HTMLHeadingElement>(null)
  const scrollToShops = useShopSectionScroll(heading)
  const shopCount = real ? publicResults.length : results.length
  const pageCount = Math.max(1, Math.ceil(shopCount / 16))
  const currentPage = Math.min(shopPage, pageCount)
  const start = expanded ? (currentPage - 1) * 16 : 0
  const end = expanded ? start + 16 : 8
  useEffect(() => setShopPage(1), [query.sort, query.categories])
  const [favorites, setFavorites] = useState<Record<string, boolean>>({})
  const job = useRef<{
    timers: Array<ReturnType<typeof setTimeout>>
    resolve: () => void
  } | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const root = useRef<HTMLElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const returning = useRef(false)
  const directoryScroll = useRef(0)
  const anchoring = useRef<{ value: string; priority: string } | null>(null)
  const anchorTimer = useRef<ReturnType<typeof setTimeout>>()
  const releaseAnchor = useCallback(() => {
    clearTimeout(anchorTimer.current)
    if (!anchoring.current) return
    const { value, priority } = anchoring.current
    const style = document.documentElement.style
    if (value) style.setProperty('overflow-anchor', value, priority)
    else style.removeProperty('overflow-anchor')
    anchoring.current = null
  }, [])
  const holdAnchor = useCallback(() => {
    clearTimeout(anchorTimer.current)
    if (anchoring.current) return
    const style = document.documentElement.style
    anchoring.current = {
      value: style.getPropertyValue('overflow-anchor'),
      priority: style.getPropertyPriority('overflow-anchor'),
    }
    style.setProperty('overflow-anchor', 'none')
  }, [])
  useEffect(() => () => releaseAnchor(), [releaseAnchor])
  useEffect(() => {
    if (view !== 'loading' && anchoring.current)
      anchorTimer.current = setTimeout(releaseAnchor, 350)
  }, [view, releaseAnchor])

  const cancelJob = useCallback(() => {
    job.current?.timers.forEach(clearTimeout)
    job.current?.resolve()
    job.current = null
  }, [])
  useEffect(() => () => cancelJob(), [cancelJob])
  const open = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (job.current || currentView.current !== 'list') return undefined
      holdAnchor()
      directoryScroll.current = window.scrollY
      opener.current = event.currentTarget
      return new Promise<void>((resolve) => {
        const skeleton = setTimeout(() => {
          currentView.current = 'loading'
          setView('loading')
        }, demoShopLoading.skeletonAfterMs)
        const detail = setTimeout(() => {
          currentView.current = 'detail'
          setView('detail')
          job.current = null
          resolve()
        }, demoShopLoading.readyAfterMs)
        job.current = { timers: [skeleton, detail], resolve }
      })
    },
    [holdAnchor]
  )
  const returnToList = () => {
    holdAnchor()
    cancelJob()
    currentView.current = 'list'
    returning.current = true
    setView('list')
  }
  useEffect(() => {
    if (view === 'loading') back.current?.focus({ preventScroll: true })
  }, [view])
  useLayoutEffect(() => {
    onDetailActiveChange?.(view !== 'list')
    if (view !== 'list') {
      // The document is Marketplace's scroll owner. Directory is out of layout,
      // so zero is now the true top of Detail, not an offset within Directory.
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    } else if (returning.current) {
      returning.current = false
      window.scrollTo({
        top: directoryScroll.current,
        behavior: 'instant' as ScrollBehavior,
      })
      opener.current?.focus({ preventScroll: true })
    }
  }, [view, onDetailActiveChange])
  useEffect(() => () => onDetailActiveChange?.(false), [onDetailActiveChange])

  return (
    <m.section
      layout={true}
      ref={root}
      className={styles.workspace}
      data-shop-workspace={view}
      transition={listingLayoutTransition(reduced)}
    >
      {/* Keep Directory mounted for slider/promo/favorite state, but entirely
          outside the active scroll layout while viewing the Shop. */}
      <div hidden={view !== 'list'} data-shop-directory-content={true}>
        {directoryHeader}
        <RecommendedShopsSlider
          paused={view !== 'list'}
          lunaFavorite={favorite}
          onOpenLuna={open}
          onLunaFavorite={setFavorite}
        />
        <div className={styles.workspaceHeading}>
          <h2
            ref={heading}
            tabIndex={-1}
            className={discovery.allTitle}
            style={{ marginBottom: 0 }}
          >
            All Shops
          </h2>
        </div>
        <section
          aria-label="All Shops"
          data-demo-shop-entry={!real || undefined}
          data-shop-expanded={expanded}
        >
          <button
            type="button"
            className={`${discovery.sectionLink} dynamic-arrow-row`}
            onClick={() => {
              setExpanded((value) => !value)
              scrollToShops()
            }}
          >
            {expanded ? (
              <>
                <ArrowLeft size={15} aria-hidden="true" /> Back to Shop Overview
              </>
            ) : (
              <>
                View All Shops{' '}
                <ArrowRight
                  size={15}
                  className="shining-button__arrow"
                  aria-hidden="true"
                />
              </>
            )}
          </button>
          <div className={styles.allShopsGrid} data-all-shops-grid={true}>
            {real &&
              publicResults.slice(start, end).map((shop) => (
                <div
                  key={shop.sellerProfileId}
                  className={styles.demoEntry}
                  data-directory-shop={shop.sellerProfileId}
                >
                  <ShopCard shop={shop} />
                </div>
              ))}
            {!real &&
              results.slice(start, end).map((shop) => (
                <div
                  key={shop.id}
                  className={styles.demoEntry}
                  data-directory-shop={shop.id}
                >
                  <ShopCardPresentation
                    demo={true}
                    shop={shop}
                    favorite={
                      shop.id === 'demo-luna'
                        ? favorite
                        : directoryFavorites[shop.id]
                    }
                    action={
                      shop.id === 'demo-luna' ? (
                        <ShopDemoOpenAction onOpen={open} />
                      ) : (
                        <button
                          type="button"
                          className={card.shopAction}
                          aria-label={`Go to ${shop.name} (demo only)`}
                          onClick={() => undefined}
                        >
                          Go to shop <ArrowRight size={18} aria-hidden="true" />
                        </button>
                      )
                    }
                    onFavorite={(value) =>
                      shop.id === 'demo-luna'
                        ? setFavorite(value)
                        : setDirectoryFavorites((current) => ({
                            ...current,
                            [shop.id]: value,
                          }))
                    }
                  />
                </div>
              ))}
          </div>
          {expanded && pageCount > 1 && (
            <MarketPagination
              page={currentPage}
              pageCount={pageCount}
              label="Shop pages"
              className={discovery.sectionPagination}
              onChange={(page) => {
                setShopPage(page)
                scrollToShops()
              }}
              onReturnToTop={scrollToShops}
            />
          )}
          {shopCount === 0 && (
            <p className={styles.demoNote} role="status">
              No shops found in these categories.
            </p>
          )}
        </section>
        <ShopProducts
          allowDemo={!real}
          favorites={favorites}
          overlayClassName={overlayClassName}
          overlayStyle={overlayStyle}
          onFavorite={(id, value) =>
            setFavorites((current) => ({ ...current, [id]: value }))
          }
          onOverlayActiveChange={onOverlayActiveChange}
        />
      </div>
      {view !== 'list' && (
        <>
          <div className={styles.workspaceHeading}>
            <button
              ref={back}
              type="button"
              className={styles.back}
              onClick={returnToList}
            >
              <ArrowLeft size={18} aria-hidden="true" />
              Back to shop list
            </button>
          </div>
          <AnimatePresence exitBeforeEnter={true}>
            <WorkspacePanel key="shop" reduced={reduced}>
              {view === 'loading' && <ShopDetailSkeleton />}
              {view === 'detail' && (
                <ShopDetailDemo
                  favorite={favorite}
                  favorites={favorites}
                  overlayClassName={overlayClassName}
                  overlayStyle={overlayStyle}
                  onFavorite={setFavorite}
                  onProductFavorite={(id, value) =>
                    setFavorites((current) => ({ ...current, [id]: value }))
                  }
                  onOverlayActiveChange={onOverlayActiveChange}
                />
              )}
            </WorkspacePanel>
          </AnimatePresence>
        </>
      )}
    </m.section>
  )
}
