import { useEffect, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from 'recharts'

import { AnalyticsPeriodControl } from '@/components/home/profile-analytics'
import { useProfileChartAnimation } from '@/components/home/profile-chart-animation'
import profile from '@/components/home/profile.module.css'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import type { ActivityPeriod } from '@/lib/account-activity'
import type {
  ShopAnalytics,
  ShopAnalyticsFixtureLoader,
} from '@/lib/shop-presentation'
import type { ShopPreview } from '@/types/shop'

import { ShopProBadge } from './shop-pro-badge'
import styles from './shop-surfaces.module.css'

function ShopCharts({
  shop,
  loadFixture,
  replayToken,
}: {
  shop: ShopPreview
  loadFixture: ShopAnalyticsFixtureLoader
  replayToken: number
}) {
  const [period, setPeriod] = useState<ActivityPeriod>('7D')
  const [data, setData] = useState<ShopAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [replay, setReplay] = useState(0)
  // Separate history and datasets; account metrics never enter this surface.
  const history = useRef({ activity: 0, marketplace: 0 })
  const viewsAnimation = useProfileChartAnimation(
    replayToken,
    history,
    'activity',
    Boolean(data) && !loading && !error,
    replay
  )
  const barsAnimation = useProfileChartAnimation(
    replayToken,
    history,
    'marketplace',
    Boolean(data) && !loading && !error,
    replay
  )
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    loadFixture(period)
      .then((result) => {
        if (!current) return
        if (
          result.period !== period ||
          result.sellerProfileId !== shop.sellerProfileId
        )
          throw Error('Incorrect Shop analytics scope')
        setData(result)
        setReplay((value) => value + 1)
        setLoading(false)
      })
      .catch(() => {
        if (!current) return
        setError('Shop analytics are unavailable. Please retry.')
        setLoading(false)
      })
    return () => {
      current = false
    }
  }, [period, shop.sellerProfileId, loadFixture, attempt])
  return (
    <>
      <p className={styles.fixture}>UI fixture · Illustrative data only</p>
      <div className={profile.controls}>
        <AnalyticsPeriodControl
          period={period}
          label="Shop analysis period"
          onChange={setPeriod}
        />
      </div>
      {error && (
        <p className={profile.notice} role="alert">
          {error}
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {!data && loading && (
        <Skeleton style={{ height: 260 }} aria-label="Loading Shop analytics" />
      )}
      {data && (
        <div
          className={styles.charts}
          aria-busy={loading}
          data-shop-analytics-period={data.period}
        >
          <section
            className={styles.chartBody}
            aria-label="Shop Views"
            data-chart-animation={viewsAnimation.phase}
          >
            <h4>Shop Views</h4>
            <p className={profile.caption}>
              Intentional public Shop visits · {data.period}
            </p>
            {data.views.length ? (
              <ChartContainer
                config={{ views: { label: 'Shop Views', color: '#b88cfa' } }}
              >
                <AreaChart
                  key={viewsAnimation.key}
                  accessibilityLayer={true}
                  data={data.views}
                  margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#776088"
                    strokeOpacity={0.22}
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    minTickGap={30}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent />}
                  />
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke="#b88cfa"
                    strokeWidth={2}
                    fill="#b88cfa"
                    fillOpacity={0.12}
                    isAnimationActive={viewsAnimation.active}
                    onAnimationStart={viewsAnimation.handleStart}
                    onAnimationEnd={viewsAnimation.handleEnd}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <p className={profile.notice}>No Shop visits in this period.</p>
            )}
          </section>
          <section
            className={styles.chartBody}
            aria-label="Top Listings"
            data-chart-animation={barsAnimation.phase}
          >
            <h4>Top Listings</h4>
            <p className={profile.caption}>
              Listing views · This Shop only · {data.period}
            </p>
            {data.topListings.length ? (
              <ChartContainer
                className={styles.barChart}
                config={{ views: { label: 'Listing views', color: '#a575de' } }}
              >
                <BarChart
                  key={barsAnimation.key}
                  accessibilityLayer={true}
                  data={data.topListings}
                  layout="vertical"
                  margin={{ top: 12, right: 38, left: 0, bottom: 8 }}
                >
                  <XAxis hide={true} type="number" />
                  <YAxis
                    dataKey="title"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={132}
                    tick={{ fontSize: 10 }}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent />}
                  />
                  <Bar
                    dataKey="views"
                    fill="var(--color-views)"
                    radius={[0, 5, 5, 0]}
                    barSize={22}
                    isAnimationActive={barsAnimation.active}
                    onAnimationStart={barsAnimation.handleStart}
                    onAnimationEnd={barsAnimation.handleEnd}
                  >
                    <LabelList
                      dataKey="views"
                      position="right"
                      fill="#d6c7e4"
                      fontSize={10}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <p className={profile.notice}>No listing views in this period.</p>
            )}
          </section>
        </div>
      )}
    </>
  )
}

export function ShopAnalysis({
  shop,
  loadFixture,
  replayToken = 1,
}: {
  shop?: ShopPreview
  loadFixture?: ShopAnalyticsFixtureLoader
  replayToken?: number
}) {
  let content = (
    <p className={styles.inactive}>
      Shop analytics become available when your Shop is active.
    </p>
  )
  if (shop)
    content = (
      <p className={styles.inactive}>Shop analytics are not available yet.</p>
    )
  if (shop && loadFixture)
    content = (
      <ShopCharts
        shop={shop}
        loadFixture={loadFixture}
        replayToken={replayToken}
      />
    )
  return (
    <section
      className={`${profile.panel} ${styles.area}`}
      aria-label="Shop Analysis"
      data-shop-surface="analysis"
      data-shop-active={Boolean(shop)}
    >
      <header className={profile.panelHeader}>
        <h3>Shop Analysis</h3>
        <ShopProBadge />
      </header>
      {content}
    </section>
  )
}
