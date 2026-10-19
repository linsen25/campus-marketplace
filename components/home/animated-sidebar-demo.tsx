import {
  ArrowLeft,
  Bell,
  MessageCircle,
  Package,
  Store,
  ClipboardList,
  Settings,
  UserRound,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { HomeListings } from '@/components/listings/home-listings'
import type { ListingLeaveGuard } from '@/components/listings/listing-form'
import { ShopManagementTitle } from '@/components/listings/shop-management-title'
import {
  useDesktopRouteTransition,
  usePendingDestination,
} from '@/components/navigation/desktop-route-transition'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { NotificationsView } from '@/components/notifications/notifications-view'
import shopAnalysisStyles from '@/components/shops/shop-analysis.module.css'
import { ShopAnalysis } from '@/components/shops/shop-analytics'
import { ShopProBadge } from '@/components/shops/shop-pro-badge'
import MenuInteraction from '@/components/smooth-dropdown'
import { LocalTabContent } from '@/components/ui/local-tab-content'
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
} from '@/components/velora/animated-sidebar'
import { Link } from '@ui/link/link'

import { AccountAnalysis } from './account-analysis'
import styles from './animated-sidebar-demo.module.css'
import { Messages } from './messages'
import { useOrderVisual } from './order-visual-context'
import { Orders } from './orders'
import type { ChartReplayHistory } from './profile-chart-animation'
import { useProfileLogout } from './profile-logout'
import { ProfileOverview } from './profile-overview'
import { SectionHeader } from './section-header'
import { SettingsLogout } from './settings-logout'

const GradientWaves = dynamic(
  () =>
    import(
      /* webpackChunkName: 'home-gradient-waves' */ '@/components/ui/GradientWaves'
    ),
  {
    ssr: false,
  }
)

const creationHeadings = new Map([
  ['create-listing', 'Manage Resale'],
  ['create-shop-listing', 'Manage Products'],
])

type Group = 'messages' | 'orders' | 'profile' | 'resale' | 'shop'

const groups: Array<{
  id: Group
  label: string
  icon: ReactNode
  badge?: ReactNode
  children: Array<{
    id: string
    label: string
    heading: string
    badge?: ReactNode
  }>
}> = [
  { id: 'profile', label: 'Profile', icon: <UserRound />, children: [] },
  {
    id: 'resale',
    label: 'My Resale',
    icon: <Package />,
    children: [
      { id: 'my-listings', label: 'Manage Resale', heading: 'Manage Resale' },
      {
        id: 'favorites',
        label: 'Resale Favorites',
        heading: 'Resale Favorites',
      },
    ],
  },
  {
    id: 'shop',
    label: 'My Shop',
    icon: <Store />,
    badge: <ShopProBadge tier="plus" />,
    children: [
      { id: 'my-shop', label: 'Manage Products', heading: 'Manage Products' },
      {
        id: 'shop-favorites',
        label: 'Shop Favorites',
        heading: 'Shop Favorites',
      },
      {
        id: 'shop-analysis',
        label: 'Shop Analysis',
        heading: 'Shop Analysis',
      },
    ],
  },
  {
    id: 'messages',
    label: 'Messages',
    icon: <MessageCircle />,
    children: [
      { id: 'buying', label: 'Buying', heading: 'Buying' },
      { id: 'selling', label: 'Selling', heading: 'Selling' },
    ],
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: <ClipboardList />,
    children: [
      { id: 'purchases', label: 'Purchases', heading: 'Purchases' },
      { id: 'sales', label: 'Sales', heading: 'Sales' },
    ],
  },
]

// eslint-disable-next-line complexity -- Existing responsive Home destinations keep separate mobile and desktop rendering branches.
export function AnimatedSidebarDemo() {
  const router = useRouter()
  const orderVisuals = useOrderVisual()
  const navigate = useDesktopRouteTransition()
  const logout = useProfileLogout()
  const pendingDestination = usePendingDestination()
  const arrivingFromMarket = useRef(false)
  const [analysisHeaderTarget, setAnalysisHeaderTarget] =
    useState<HTMLDivElement | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [avatarImage, setAvatarImage] = useState<string>()
  const saveAvatar = useCallback((file: File) => {
    setAvatarImage(URL.createObjectURL(file))
  }, [])
  useEffect(() => {
    return () => {
      if (avatarImage) URL.revokeObjectURL(avatarImage)
    }
  }, [avatarImage])
  const [chartReplayToken, setChartReplayToken] = useState(0)
  const chartReplayHistory = useRef<ChartReplayHistory>({
    activity: 0,
    marketplace: 0,
  })
  const listingGuard = useRef<ListingLeaveGuard | null>(null)
  const registerListingGuard = useCallback(
    (guard: ListingLeaveGuard | null) => {
      listingGuard.current = guard
    },
    []
  )
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = main.current
    if (!element) return undefined
    let previous = element.scrollTop
    let timer: ReturnType<typeof setTimeout>
    const scrolled = () => {
      if (element.scrollTop === previous) return
      previous = element.scrollTop
      element.dataset.scrolling = 'true'
      clearTimeout(timer)
      timer = setTimeout(() => {
        delete element.dataset.scrolling
      }, 600)
    }
    element.addEventListener('scroll', scrolled, { passive: true })
    return () => {
      element.removeEventListener('scroll', scrolled)
      clearTimeout(timer)
      delete element.dataset.scrolling
    }
  }, [])
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const query = matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const [active, setActive] = useState<Group | 'notifications' | 'settings'>(
    'profile'
  )
  useEffect(() => {
    if (pendingDestination === '/home') {
      arrivingFromMarket.current = true
    } else if (pendingDestination === null && arrivingFromMarket.current) {
      arrivingFromMarket.current = false
      // The route provider releases Home only after the slide and source handoff.
      if (desktop && active === 'profile')
        setChartReplayToken((token) => token + 1)
    }
  }, [pendingDestination, desktop, active])
  const [selected, setSelected] = useState<Record<Group, string>>({
    profile: 'overview',
    resale: 'my-listings',
    shop: 'my-shop',
    messages: 'buying',
    orders: 'purchases',
  })
  const [expanded, setExpanded] = useState<Group | null>(null)
  // Preview navigation follows Home's existing local destination pattern. No route/API request.
  useEffect(() => {
    if (!orderVisuals.selection) return
    setActive('orders')
    setExpanded('orders')
    setSelected((current) => ({
      ...current,
      orders: orderVisuals.selection?.workspace || current.orders,
    }))
  }, [orderVisuals.selection])
  useEffect(() => {
    const syncSection = () => {
      const section = router.query.section
      if (section === 'settings') setActive('settings')
      if (section === 'notifications') setActive('notifications')
      if (section === 'orders') {
        setActive('orders')
        setExpanded('orders')
        setSelected((current) => ({
          ...current,
          orders: ['sales', 'selling'].includes(
            String(router.query.destination)
          )
            ? 'sales'
            : 'purchases',
        }))
      }
      if (section === 'messages') {
        setActive('messages')
        setExpanded('messages')
        setSelected((current) => ({
          ...current,
          messages:
            router.query.destination === 'selling' ? 'selling' : 'buying',
        }))
      }
      // Legacy create links open the management-owned overlay, never a second page.
      if (section === 'create-listing') {
        setActive('resale')
        setExpanded('resale')
        setSelected((current) => ({ ...current, resale: 'create-listing' }))
      }
      if (section === 'create-shop-listing') {
        setActive('shop')
        setExpanded('shop')
        setSelected((current) => ({ ...current, shop: 'create-shop-listing' }))
      }
      const target = groups.find((item) =>
        item.children.some((child) => child.id === section)
      )
      if (target) {
        setActive(target.id)
        setExpanded(target.id)
        setSelected((current) => ({ ...current, [target.id]: String(section) }))
      }
      if (section === 'profile' || section === 'analytics') setActive('profile')
    }
    syncSection()
    // Local sidebar selection can diverge from an unchanged URL. Reapply even
    // when a Settings link navigates to the same query as a previous visit.
    router.events.on('routeChangeComplete', syncSection)
    return () => router.events.off('routeChangeComplete', syncSection)
  }, [router, router.query.section, router.query.destination])
  // Primary entries classify child pages; explicit group selection starts at
  // its first child. Rail width/hover/pinning never calls this selection path.
  const selectSection = (
    id: Group | 'notifications' | 'settings',
    child?: string
  ) => {
    if (id === 'notifications') {
      const enter = () => {
        router.push('/home?section=notifications').catch(() => {})
      }
      if (listingGuard.current) listingGuard.current(enter)
      else enter()
      return
    }
    const replayCharts = id === 'profile'
    const alreadySelected =
      id === active && child && selected[id as Group] === child
    if (
      alreadySelected &&
      !replayCharts &&
      !(id === 'orders' && orderVisuals.selection)
    )
      return
    const select = () => {
      orderVisuals.showList()
      if (replayCharts) setChartReplayToken((token) => token + 1)
      if (alreadySelected) return
      setActive(id)
      const section = groups.find((item) => item.id === id)
      if (section) {
        const next = child ?? section.children[0]?.id ?? 'overview'
        setSelected((current) => ({ ...current, [id]: next }))
      }
    }
    if (listingGuard.current) listingGuard.current(select)
    else select()
  }
  const group = groups.find((item) => item.id === active)
  const heading =
    creationHeadings.get(group ? selected[group.id] : '') ??
    group?.children.find((child) => child.id === selected[group.id])?.heading ??
    group?.label ??
    (active === 'notifications' ? 'Notifications' : 'Settings')
  const managementHeading =
    heading === 'Manage Products' ? <ShopManagementTitle /> : heading

  const renderDesktopHeaderActions = () => {
    if (!desktop) return null
    if (active === 'shop' && selected.shop === 'shop-analysis')
      return (
        <div className={shopAnalysisStyles.workspaceActions}>
          <div
            ref={setAnalysisHeaderTarget}
            className={shopAnalysisStyles.dateSlot}
            data-shop-analysis-date-slot={true}
          />
          <NotificationBell />
        </div>
      )
    return <NotificationBell />
  }
  return (
    <div className={styles.page} data-slot="home-sidebar-demo">
      {desktop ? (
        <div
          className={styles.ambient}
          data-home-ambient="true"
          aria-hidden="true"
        >
          <GradientWaves
            horizonColor="#9000ff"
            waveColor="#ff9ffc"
            crestColor="#ffb3b3"
            zoom={0.8}
            height={2}
            waveScale={0.8}
            brightness={0.8}
            mouseInteraction={false}
          />
        </div>
      ) : (
        <div
          className={styles.mobileAmbient}
          data-home-ambient="true"
          aria-hidden="true"
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
      )}
      <div className={styles.mobileShell}>
        <header className={styles.mobileHeader} data-home-mobile-header="true">
          <h1 className={styles.mobileTitle}>{managementHeading}</h1>
          {!desktop &&
            (active === 'shop' && selected.shop === 'shop-analysis' ? (
              <div className={shopAnalysisStyles.workspaceActions}>
                <div
                  ref={setAnalysisHeaderTarget}
                  className={shopAnalysisStyles.dateSlot}
                  data-shop-analysis-date-slot={true}
                />
                <NotificationBell />
              </div>
            ) : (
              <NotificationBell />
            ))}
          <MenuInteraction
            compact={true}
            items={[
              ...groups,
              {
                id: 'notifications',
                label: 'Notifications',
                icon: <Bell />,
              },
              { id: 'settings', label: 'Settings', icon: <Settings /> },
            ]}
            activeItem={active}
            selectedChild={group ? selected[group.id] : undefined}
            onSelect={(id, child) =>
              selectSection(id as Group | 'notifications' | 'settings', child)
            }
          />
        </header>
        <main className={styles.mobileMain}>
          {!desktop && active === 'notifications' && <NotificationsView />}
          {!desktop && active === 'profile' && (
            <LocalTabContent tab={selected.profile}>
              <ProfileOverview
                showHeading={false}
                avatarImage={avatarImage}
                onFinancialSettings={() => selectSection('settings')}
                onUsername={setUsername}
                onAvatarSave={saveAvatar}
              />
              <AccountAnalysis
                replayToken={chartReplayToken}
                replayHistory={chartReplayHistory}
              />
            </LocalTabContent>
          )}
          {!desktop && active === 'messages' && (
            <Messages destination={selected.messages} mobile={true} />
          )}
          {!desktop && active === 'orders' && (
            <Orders
              key={selected.orders}
              destination={selected.orders}
              desktop={desktop}
              onNavigate={(mode) => selectSection('orders', mode)}
            />
          )}
          {!desktop && active === 'settings' && (
            <ProfileOverview
              settings={true}
              avatarImage={avatarImage}
              sessionAction={
                <SettingsLogout onConfirm={() => logout(username)} />
              }
              onFinancialSettings={() => selectSection('settings')}
              onAvatarSave={saveAvatar}
              onUsername={setUsername}
            />
          )}
          {!desktop &&
            active === 'shop' &&
            selected.shop === 'shop-analysis' && (
              <ShopAnalysis
                replayToken={chartReplayToken}
                headerActionsTarget={analysisHeaderTarget}
              />
            )}
          {!desktop &&
            (active === 'resale' || active === 'shop') &&
            selected[active] !== 'shop-analysis' && (
              <HomeListings
                key={active}
                page={selected[active]}
                onGuardChange={registerListingGuard}
                onSelect={(page) => {
                  listingGuard.current = null
                  setSelected((current) => ({ ...current, [active]: page }))
                }}
              />
            )}
        </main>
      </div>
      <Sidebar className={styles.frame}>
        <SidebarBody
          className={styles.navigation}
          logo={
            <Link
              href="/listings"
              className={styles.mark}
              aria-label="Back to Market"
              onClick={(event) => navigate(event, '/listings')}
            >
              <ArrowLeft aria-hidden="true" />
            </Link>
          }
          title="Back to Market"
          footer={
            <>
              <SidebarLink
                href="/home?section=notifications"
                label="Notifications"
                icon={<Bell />}
                active={active === 'notifications'}
                onClick={(event) => {
                  event.preventDefault()
                  selectSection('notifications')
                }}
              />
              <SidebarLink
                href="#settings"
                label="Settings"
                icon={<Settings />}
                active={active === 'settings'}
                onClick={(event) => {
                  event.preventDefault()
                  selectSection('settings')
                }}
              />
            </>
          }
        >
          {groups.map((item) => (
            <div key={item.id}>
              <SidebarLink
                href={`#${item.id}`}
                label={item.label}
                aria-label={item.label}
                badge={item.badge}
                icon={item.icon}
                active={active === item.id}
                aria-expanded={
                  item.children.length ? expanded === item.id : undefined
                }
                onClick={(event) => {
                  event.preventDefault()
                  if (item.id === 'resale' || item.id === 'shop') {
                    setExpanded((current) =>
                      current === item.id ? null : item.id
                    )
                  } else {
                    setExpanded(item.children.length ? item.id : null)
                    selectSection(item.id)
                  }
                }}
              />
              {item.children.length > 0 && (
                <div
                  className={styles.submenu}
                  data-open={expanded === item.id || undefined}
                >
                  <div className={styles.submenuInner}>
                    {item.children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        className={styles.child}
                        aria-label={child.label}
                        aria-current={
                          active === item.id && selected[item.id] === child.id
                            ? 'page'
                            : undefined
                        }
                        onClick={() => selectSection(item.id, child.id)}
                      >
                        {child.label}
                        {child.badge && (
                          <span className={styles.childBadge}>
                            {child.badge}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </SidebarBody>
        <main ref={main} className={styles.main} data-home-main="true">
          <SectionHeader
            title={
              active === 'profile' && selected.profile === 'overview'
                ? 'Profile'
                : managementHeading
            }
          >
            {renderDesktopHeaderActions()}
          </SectionHeader>
          {desktop && active === 'notifications' && <NotificationsView />}
          {desktop && active === 'profile' && (
            <>
              <ProfileOverview
                avatarImage={avatarImage}
                onFinancialSettings={() => selectSection('settings')}
                onUsername={setUsername}
                onAvatarSave={saveAvatar}
              />
              <AccountAnalysis
                replayToken={chartReplayToken}
                replayHistory={chartReplayHistory}
              />
            </>
          )}
          {desktop && active === 'messages' && (
            <Messages destination={selected.messages} />
          )}
          {desktop && active === 'orders' && (
            <Orders
              key={selected.orders}
              destination={selected.orders}
              desktop={desktop}
              onNavigate={(mode) => selectSection('orders', mode)}
            />
          )}
          {desktop && active === 'settings' && (
            <ProfileOverview
              settings={true}
              avatarImage={avatarImage}
              sessionAction={
                <SettingsLogout onConfirm={() => logout(username)} />
              }
              onFinancialSettings={() => selectSection('settings')}
              onAvatarSave={saveAvatar}
              onUsername={setUsername}
            />
          )}
          {desktop &&
            active === 'shop' &&
            selected.shop === 'shop-analysis' && (
              <ShopAnalysis
                replayToken={chartReplayToken}
                headerActionsTarget={analysisHeaderTarget}
              />
            )}
          {desktop &&
            (active === 'resale' || active === 'shop') &&
            selected[active] !== 'shop-analysis' && (
              <HomeListings
                key={active}
                page={selected[active]}
                onGuardChange={registerListingGuard}
                onSelect={(page) => {
                  listingGuard.current = null
                  setSelected((current) => ({ ...current, [active]: page }))
                }}
              />
            )}
        </main>
      </Sidebar>
    </div>
  )
}
