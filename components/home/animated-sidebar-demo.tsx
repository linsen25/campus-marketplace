import {
  ArrowLeft,
  MessageCircle,
  Package,
  Settings,
  UserRound,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { HomeListings } from '@/components/listings/home-listings'
import type { ListingLeaveGuard } from '@/components/listings/listing-form'
import {
  useDesktopRouteTransition,
  usePendingDestination,
} from '@/components/navigation/desktop-route-transition'
import MenuInteraction from '@/components/smooth-dropdown'
import { LocalTabContent } from '@/components/ui/local-tab-content'
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
} from '@/components/velora/animated-sidebar'
import { Link } from '@ui/link/link'

import marketStyles from '../listings/market-layout.module.css'

import styles from './animated-sidebar-demo.module.css'
import { ProfileAnalytics } from './profile-analytics'
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

type Group = 'listings' | 'messages' | 'profile'

const groups: Array<{
  id: Group
  label: string
  icon: ReactNode
  children: Array<{ id: string; label: string; heading: string }>
}> = [
  {
    id: 'profile',
    label: 'Profile',
    icon: <UserRound />,
    children: [{ id: 'overview', label: 'Overview', heading: 'Overview' }],
  },
  {
    id: 'listings',
    label: 'Listings',
    icon: <Package />,
    children: [
      { id: 'my-listings', label: 'My Listings', heading: 'My Listings' },
      {
        id: 'create-listing',
        label: 'Create Listing',
        heading: 'Create Listing',
      },
      { id: 'favorites', label: 'Favorites', heading: 'Favorites' },
    ],
  },
  {
    id: 'messages',
    label: 'Messages',
    icon: <MessageCircle />,
    children: [{ id: 'inbox', label: 'Inbox', heading: 'Inbox' }],
  },
]

const mobileGroups = groups.map((group) =>
  group.id === 'profile'
    ? {
        ...group,
        children: [
          ...group.children,
          { id: 'analytics', label: 'Analytics', heading: 'Analytics' },
          { id: 'payment', label: 'Payment', heading: 'Payment' },
        ],
      }
    : group
)

export function AnimatedSidebarDemo() {
  const router = useRouter()
  const navigate = useDesktopRouteTransition()
  const logout = useProfileLogout()
  const pendingDestination = usePendingDestination()
  const arrivingFromMarket = useRef(false)
  const [username, setUsername] = useState<string | null>(null)
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
  const [active, setActive] = useState<Group | 'settings'>('profile')
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
    listings: 'my-listings',
    messages: 'inbox',
  })
  useEffect(() => {
    const section = router.query.section
    if (
      ['my-listings', 'create-listing', 'favorites'].includes(String(section))
    ) {
      setActive('listings')
      setSelected((current) => ({ ...current, listings: String(section) }))
    }
  }, [router.query.section])
  // Primary entries classify child pages; explicit group selection starts at
  // its first child. Rail width/hover/pinning never calls this selection path.
  const selectSection = (id: Group | 'settings', child?: string) => {
    const replayCharts =
      id === 'profile' && (desktop ? !child : child === 'analytics')
    const alreadySelected =
      id === active && child && selected[id as Group] === child
    if (alreadySelected && !replayCharts) return
    const select = () => {
      if (replayCharts) setChartReplayToken((token) => token + 1)
      if (alreadySelected || (desktop && id === 'profile' && active === id))
        return
      setActive(id)
      const section = groups.find((item) => item.id === id)
      if (section) {
        const next = child ?? section.children[0].id
        setSelected((current) => ({ ...current, [id]: next }))
      }
    }
    if (listingGuard.current) listingGuard.current(select)
    else select()
  }
  const group = mobileGroups.find((item) => item.id === active)
  const heading =
    group?.children.find((child) => child.id === selected[group.id])?.heading ??
    'Settings'
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
        <header
          className={`${marketStyles.mobileBrand} ${styles.mobileHeader}`}
          data-home-mobile-header="true"
        >
          <span className={styles.mobileBrand}>
            <span aria-hidden="true" className={marketStyles.brandAccent}>
              {'\u2726'}
            </span>
            <span>Campus Marketplace</span>
          </span>
          <MenuInteraction
            items={[
              ...mobileGroups,
              { id: 'settings', label: 'Settings', icon: <Settings /> },
            ]}
            activeItem={active}
            selectedChild={group ? selected[group.id] : undefined}
            onSelect={(id, child) =>
              selectSection(id as Group | 'settings', child)
            }
          />
        </header>
        <main className={styles.mobileMain}>
          <SectionHeader title={heading} />
          {!desktop && active === 'profile' && (
            <LocalTabContent tab={selected.profile}>
              {selected.profile === 'overview' && (
                <ProfileOverview showHeading={false} onUsername={setUsername} />
              )}
              {selected.profile === 'analytics' && (
                <ProfileAnalytics
                  replayToken={chartReplayToken}
                  replayHistory={chartReplayHistory}
                />
              )}
              {selected.profile === 'payment' && <p>Coming later</p>}
            </LocalTabContent>
          )}
          {!desktop && active === 'settings' && (
            <ProfileOverview
              settings={true}
              sessionAction={
                <SettingsLogout onConfirm={() => logout(username)} />
              }
              onUsername={setUsername}
            />
          )}
          {!desktop && active === 'listings' && (
            <HomeListings
              page={selected.listings}
              onGuardChange={registerListingGuard}
              onSelect={(page) => {
                listingGuard.current = null
                setSelected((current) => ({ ...current, listings: page }))
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
          }
        >
          {groups.map((item) => (
            <div key={item.id}>
              <SidebarLink
                href={`#${item.id}`}
                label={item.label}
                icon={item.icon}
                active={active === item.id}
                aria-expanded={active === item.id}
                onClick={(event) => {
                  event.preventDefault()
                  selectSection(item.id)
                }}
              />
              {item.id !== 'profile' && (
                <div
                  className={styles.submenu}
                  data-open={active === item.id || undefined}
                >
                  <div className={styles.submenuInner}>
                    {item.children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        className={styles.child}
                        aria-current={
                          active === item.id && selected[item.id] === child.id
                            ? 'page'
                            : undefined
                        }
                        onClick={() => selectSection(item.id, child.id)}
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </SidebarBody>
        <main ref={main} className={styles.main} data-home-main="true">
          <SectionHeader title={active === 'profile' ? 'Profile' : heading} />
          {desktop && active === 'profile' && (
            <>
              <ProfileOverview onUsername={setUsername} />
              <ProfileAnalytics
                replayToken={chartReplayToken}
                replayHistory={chartReplayHistory}
              />
            </>
          )}
          {desktop && active === 'settings' && (
            <ProfileOverview
              settings={true}
              sessionAction={
                <SettingsLogout onConfirm={() => logout(username)} />
              }
              onUsername={setUsername}
            />
          )}
          {desktop && active === 'listings' && (
            <HomeListings
              page={selected.listings}
              onGuardChange={registerListingGuard}
              onSelect={(page) => {
                listingGuard.current = null
                setSelected((current) => ({ ...current, listings: page }))
              }}
            />
          )}
        </main>
      </Sidebar>
    </div>
  )
}
