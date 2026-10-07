/* eslint-disable no-nested-ternary -- Loading, error, empty and chart are exclusive request states. */
'use client'

import type { MutableRefObject } from 'react'
import { useEffect, useId, useMemo, useState } from 'react'
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

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { useContentReveal } from '@/components/ui/content-reveal'
import { Skeleton } from '@/components/ui/skeleton'
import { mockTrend } from '@/lib/fixtures/profile-analytics'
import type {
  AnalyticsMetric,
  AnalyticsPeriod,
} from '@/lib/fixtures/profile-analytics'
import { marketplaceRequest } from '@/lib/listings-api'

import type { ChartReplayHistory } from './profile-chart-animation'
import { useProfileChartAnimation } from './profile-chart-animation'
import styles from './profile.module.css'

const metrics: Array<{ key: AnalyticsMetric; label: string }> = [
  { key: 'overall', label: 'Overall' },
  { key: 'views', label: 'Views' },
  { key: 'listings', label: 'Listings' },
  { key: 'sold', label: 'Sold' },
]
const periods: AnalyticsPeriod[] = ['1D', '7D', '30D']

type ReplayProps = {
  replayToken: number
  replayHistory: MutableRefObject<ChartReplayHistory>
}

export function ProfileAnalytics({ replayToken, replayHistory }: ReplayProps) {
  const [metric, setMetric] = useState<AnalyticsMetric>('overall')
  const [period, setPeriod] = useState<AnalyticsPeriod>('7D')
  const gradient = `trend-${useId().replace(/:/g, '')}`
  const metricLabel =
    metrics.find((item) => item.key === metric)?.label ?? 'Overall'
  const data = useMemo(() => mockTrend(period), [period])
  const animation = useProfileChartAnimation(
    replayToken,
    replayHistory,
    'activity'
  )
  return (
    <div className={styles.analytics} data-profile-analytics="true">
      <section
        className={styles.panel}
        aria-label="Your Activity"
        data-chart-replay={animation.key}
        data-chart-animation={animation.phase}
      >
        <header className={styles.panelHeader}>
          <h3>Your Activity</h3>
          <span className={styles.demo}>Demo data</span>
        </header>
        <p
          className={styles.caption}
          aria-live="polite"
          data-trend-caption="true"
        >
          Account: {metricLabel}
        </p>
        <div className={styles.controls}>
          <div
            className={styles.segment}
            role="group"
            aria-label="Trend metric"
          >
            {metrics.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={metric === item.key}
                onClick={() => {
                  animation.handleEnd()
                  setMetric(item.key)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            className={styles.segment}
            role="group"
            aria-label="Trend period"
          >
            {periods.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={period === item}
                onClick={() => {
                  animation.handleEnd()
                  setPeriod(item)
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div
          data-trend-period={period}
          data-trend-metric={metric}
          data-trend-listing="account"
          data-trend-points={data.length}
        >
          <ChartContainer
            config={{ [metric]: { label: metricLabel, color: '#b88cfa' } }}
          >
            <AreaChart
              key={animation.key}
              accessibilityLayer={true}
              data={data}
              margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#b88cfa" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#b88cfa" stopOpacity={0.03} />
                </linearGradient>
              </defs>
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
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey={metric}
                stroke="#b88cfa"
                strokeWidth={2}
                fill={`url(#${gradient})`}
                isAnimationActive={animation.active}
                onAnimationStart={animation.handleStart}
                onAnimationEnd={animation.handleEnd}
              />
            </AreaChart>
          </ChartContainer>
        </div>
        <div className={styles.chartFooter}>
          <span>
            {metric === 'overall'
              ? 'Activity: views + listings + sold'
              : metricLabel}{' '}
            · {period}
          </span>
        </div>
      </section>
      <MarketplaceTrends
        replayToken={replayToken}
        replayHistory={replayHistory}
      />
    </div>
  )
}

function MarketplaceTrends({ replayToken, replayHistory }: ReplayProps) {
  const [data, setData] = useState<Array<{
    category: string
    count: number
  }> | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const reveal = useContentReveal(!data && !error)
  const animation = useProfileChartAnimation(
    replayToken,
    replayHistory,
    'marketplace',
    Boolean(data?.some((item) => item.count > 0))
  )
  useEffect(() => {
    let active = true
    setError('')
    setData(null)
    marketplaceRequest<Array<{ category: string; count: number }>>(
      '/api/profile/categories',
      'GET'
    )
      .then((rows) => {
        if (active) setData(rows)
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Marketplace trends are unavailable.'
          )
      })
    return () => {
      active = false
    }
  }, [attempt])
  return (
    <section
      className={styles.panel}
      aria-label="Marketplace Trends"
      data-category-layout="vertical"
      data-chart-replay={animation.key}
      data-chart-animation={animation.phase}
    >
      <header className={styles.panelHeader}>
        <h3>Marketplace Trends</h3>
      </header>
      <p className={styles.caption}>Active listings by category</p>
      <div className={styles.categoryRegion}>
        {error ? (
          <div className={`${styles.notice} ${reveal}`} role="alert">
            {error}
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : !data ? (
          <div
            className={styles.categorySkeleton}
            role="status"
            aria-label="Loading marketplace trends"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <div className={styles.categorySkeletonRow} key={index}>
                <Skeleton />
                <Skeleton />
              </div>
            ))}
          </div>
        ) : data.every((item) => item.count === 0) ? (
          <p className={`${styles.notice} ${reveal}`}>
            No active listings yet.
          </p>
        ) : (
          <ChartContainer
            className={`${styles.categoryChart} ${reveal}`}
            config={{ count: { label: 'Active listings', color: '#a575de' } }}
          >
            <BarChart
              key={animation.key}
              accessibilityLayer={true}
              data={data}
              layout="vertical"
              margin={{ top: 12, right: 46, left: 0, bottom: 8 }}
            >
              <XAxis hide={true} type="number" />
              <YAxis
                dataKey="category"
                type="category"
                tickLine={false}
                axisLine={false}
                width={132}
                tick={{ fontSize: 10 }}
              />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[0, 5, 5, 0]}
                barSize={22}
                isAnimationActive={animation.active}
                onAnimationStart={animation.handleStart}
                onAnimationEnd={animation.handleEnd}
              >
                <LabelList
                  dataKey="count"
                  position="right"
                  fill="#d6c7e4"
                  fontSize={10}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </div>
      <p className={styles.caption}>
        Counts represent active listings across the marketplace.
      </p>
    </section>
  )
}
