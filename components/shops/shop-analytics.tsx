/* eslint jsx-a11y/no-noninteractive-tabindex: off -- The labelled demo region has a keyboard equivalent to its content-click Shop Plans action. */
/* eslint @next/next/no-img-element: off -- Immutable local demo product thumbnails. */
import { AnimatePresence } from 'framer-motion'
import {
  Coins,
  Receipt,
  ChartNoAxesColumnIncreasing,
  Package,
  LockKeyhole,
  Plus,
  ShoppingBag,
  Clock3,
  CircleX,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts'

import ShiningButton from '@/components/animata/button/shining-button'
import FilterInteraction from '@/components/filter-interaction'
import { ChartContainer } from '@/components/ui/chart'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui/table'
import { loadShopAnalysisFixture } from '@/lib/fixtures/shop-analysis-fixture'
import {
  shopAnalysisRanges,
  shopMoney,
  shopComparison,
} from '@/lib/shop-analysis'
import type {
  ShopAnalysisRange,
  ShopAnalysisDemoAccess,
  ShopAnalysisResponse,
  ShopExpense,
} from '@/lib/shop-analysis'
import type { ShopPreview } from '@/types/shop'
import type { RealShopAnalysis } from '@/types/shop-analysis'

import { RealShopAnalysisView } from './real-shop-analysis'
import styles from './shop-analysis.module.css'
import { ExpenseDialog } from './shop-expense-dialog'
import { ShopPricingDialog } from './shop-pricing-dialog'
import { ShopProBadge } from './shop-pro-badge'

const colors = ['#9560f5', '#e56cb6', '#769aff', '#b7aac5', '#4ade80']
const financialConfig = {
  revenue: { label: 'Revenue', color: colors[0] },
  expenses: { label: 'Expenses', color: colors[1] },
  profit: { label: 'Estimated Profit', color: colors[4] },
}
type DemoLoader = typeof loadShopAnalysisFixture
function Select({
  label,
  value,
  options,
  onChange,
  portalContainer,
}: {
  portalContainer?: HTMLElement
  label: string
  value: string
  options:
    | Array<{ value: string; label: string }>
    | ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <FilterInteraction
      label={label}
      portalContainer={portalContainer}
      appearance="select"
      isOpen={open}
      value={value}
      options={[...options]}
      onOpenChange={setOpen}
      onChange={onChange}
    />
  )
}
function DateRangePlacement({
  wide,
  target,
  children,
}: {
  wide: boolean
  target?: HTMLElement | null
  children: ReactNode
}) {
  return <>{wide && target ? createPortal(children, target) : children}</>
}
function Module({
  title,
  children,
  note,
  action,
}: {
  title: string
  children: ReactNode
  note?: string
  action?: ReactNode
}) {
  return (
    <section className={styles.module} aria-label={title}>
      <div className={styles.moduleHeader}>
        <h3>{title}</h3>
        {action}
      </div>
      {note && <p className={styles.muted}>{note}</p>}
      {children}
    </section>
  )
}
function AnalysisTooltip({
  active,
  payload,
  label,
  money = true,
}: {
  active?: boolean
  payload?: ReadonlyArray<{
    name?: string
    value?: number
    dataKey?: string
    color?: string
    payload?: { name?: string }
  }>
  label?: number | string
  money?: boolean
}) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <strong>{label || payload[0]?.payload?.name}</strong>
      {payload
        .filter((x) => typeof x.value === 'number')
        .map((item, index) => (
          <p key={item.dataKey || index}>
            <span style={{ color: item.color }}>{item.name}</span>
            <b>
              {money
                ? shopMoney(Math.round(Number(item.value) * 100))
                : Number(item.value).toLocaleString('en-CA')}
            </b>
          </p>
        ))}
    </div>
  )
}
function Donut({
  entries,
  total,
  label,
}: {
  entries: Array<{ name: string; cents: number }>
  total: number
  label: string
}) {
  if (!entries.length)
    return (
      <p className={styles.empty}>No {label.toLowerCase()} in this period.</p>
    )
  return (
    <div className={styles.donutRow}>
      <div className={styles.donut}>
        <ChartContainer config={{}} className={styles.donutChart}>
          <PieChart>
            <Pie
              data={entries.map((x) => ({
                name: x.name,
                value: x.cents / 100,
              }))}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="72%"
              outerRadius="95%"
              stroke="none"
              isAnimationActive={false}
            >
              {entries.map((e, i) => (
                <Cell key={e.name} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              content={<AnalysisTooltip />}
              wrapperStyle={{ zIndex: 10 }}
            />
          </PieChart>
        </ChartContainer>
        <div className={styles.donutTotal}>
          <strong>{shopMoney(total)}</strong>
          <span>Total</span>
        </div>
      </div>
      <ul className={styles.breakdown}>
        {entries.map((e, i) => (
          <li key={e.name}>
            <span
              className={styles.dot}
              style={{ background: colors[i % colors.length] }}
            />
            <span>{e.name}</span>
            <b>{shopMoney(e.cents)}</b>
            <small>
              {total > 0 ? ((e.cents / total) * 100).toFixed(1) : '0'}%
            </small>
          </li>
        ))}
      </ul>
    </div>
  )
}
function Dashboard({
  data,
  onExpense,
}: {
  data: ShopAnalysisResponse
  onExpense: () => void
}) {
  const reduced = useReducedMotion()
  const c = data.current
  const p = data.previous
  const metrics = [
    {
      label:
        data.source === 'real' ? 'Recorded Product Sales' : 'Total Revenue',
      value: c.revenueCents,
      previous: p.revenueCents,
      Icon: Coins,
      color: colors[0],
    },
    {
      label: 'Total Expenses',
      value: c.knownExpensesCents,
      previous: p.knownExpensesCents,
      Icon: Receipt,
      color: colors[1],
    },
    {
      label: 'Estimated Profit',
      value: c.estimatedProfitCents,
      previous: p.estimatedProfitCents,
      Icon: ChartNoAxesColumnIncreasing,
      color: colors[4],
    },
    {
      label: 'Items Sold',
      value: c.sold,
      previous: p.sold,
      Icon: Package,
      color: colors[2],
    },
  ]
  const tick = (v: string) => v.slice(5)
  return (
    <>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Business Overview</h2>
          <p>Recorded Shop sales and estimated business costs.</p>
        </div>
        <ShopProBadge tier="plus" />
      </div>
      <div className={styles.kpis}>
        {metrics.map(({ label, value, previous, Icon, color }, i) => (
          <section
            key={label}
            className={styles.kpi}
            aria-label={label}
            style={{ color }}
          >
            <Icon size={21} />
            <h3>{label}</h3>
            <div
              className={`${styles.value} ${
                value !== null && value < 0 ? styles.negative : ''
              }`}
              data-kpi={label}
            >
              {value === null ? (
                <span>—</span>
              ) : (
                <>
                  {i !== 3 && <span className={styles.currency}>CA$</span>}
                  <NumberTicker
                    value={i === 3 ? value : value / 100}
                    decimalPlaces={i === 3 ? 0 : 2}
                  />
                </>
              )}
            </div>
            <p>
              {shopComparison(value, previous)} <span>vs previous period</span>
            </p>
          </section>
        ))}
      </div>
      <p className={styles.disclosure}>
        {data.source === 'real'
          ? 'Recorded Product Sales includes eligible completed item sales only. Delivery and Buyer Protection fees are excluded. It is not money received, settled earnings or verified external payment.'
          : 'Recorded Shop Sales Revenue includes completed UU Pay and directly paid Shop orders. It does not verify bank deposits or external payment collection.'}
      </p>
      {data.source === 'real' && (
        <RealCoverage data={data as RealShopAnalysis} />
      )}
      {Boolean(c.missingCostCount) && (
        <p className={styles.warning} role="status">
          Profit may be incomplete due to missing cost data. Expenses show known
          costs only.
        </p>
      )}
      {!c.orders.completed && (
        <p className={styles.empty}>
          {data.source === 'real'
            ? 'No attributable completed Shop sales in this period. Missing historical facts, if any, are listed above.'
            : 'No sales data yet. Complete your first order to see your sales trends.'}
        </p>
      )}
      <Module
        title="Revenue & Expenses"
        note="Estimated Profit = Revenue - Expenses. All amounts in CAD."
      >
        <ChartContainer config={financialConfig} className={styles.chart}>
          <ComposedChart
            accessibilityLayer={true}
            data={c.trend}
            margin={{ top: 20, right: 12, left: 0, bottom: 6 }}
          >
            <CartesianGrid vertical={false} stroke="#ffffff12" />
            <XAxis
              dataKey="date"
              tickFormatter={tick}
              minTickGap={42}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              width={56}
              tickFormatter={(v) => `$${v}`}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<AnalysisTooltip />}
              allowEscapeViewBox={{ x: false, y: false }}
            />
            <Area
              name="Revenue"
              dataKey="revenue"
              type="monotone"
              stroke={colors[0]}
              fill={colors[0]}
              fillOpacity={0.12}
              isAnimationActive={!reduced}
            />
            <Area
              name="Expenses"
              dataKey="expenses"
              type="monotone"
              stroke={colors[1]}
              fill={colors[1]}
              fillOpacity={0.07}
              isAnimationActive={!reduced}
            />
            <Line
              name="Estimated Profit"
              dataKey="profit"
              stroke={colors[4]}
              dot={false}
              strokeWidth={2}
              isAnimationActive={!reduced}
            />
          </ComposedChart>
        </ChartContainer>
        <div className={styles.legend}>
          <span style={{ color: colors[0] }}>Revenue</span>
          <span style={{ color: colors[1] }}>Expenses</span>
          <span style={{ color: colors[4] }}>Estimated Profit</span>
        </div>
      </Module>
      <div className={`${styles.twoColumns} ${styles.businessRow}`}>
        <Module
          title="Expense Breakdown"
          action={
            <div className={styles.moduleAction}>
              <ShiningButton onClick={onExpense}>
                <Plus size={15} /> Add Expense
              </ShiningButton>
            </div>
          }
        >
          <Donut
            entries={c.breakdown}
            total={c.knownExpensesCents}
            label="Expenses"
          />
          <p className={styles.muted}>
            {data.source === 'real'
              ? 'Known frozen product costs plus recorded operating expenses. No subscription charges are inferred. Expense edits and soft deletion restate this report.'
              : 'Includes product cost snapshots, operating expenses and Shop subscription fees. Demo expenses are not persisted.'}
          </p>
        </Module>
        <Module title="Order Overview">
          <div className={styles.orders}>
            {[
              {
                name: 'Completed Orders',
                value: c.orders.completed,
                Icon: ShoppingBag,
              },
              { name: 'Pending Orders', value: c.orders.pending, Icon: Clock3 },
              {
                name: 'Cancelled Orders',
                value: c.orders.cancelled,
                Icon: CircleX,
              },
            ].map(({ name, value, Icon }) => (
              <div key={name}>
                <Icon size={20} />
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className={styles.muted}>
            {data.source === 'real'
              ? 'Completed orders use completion date. Pending and cancelled orders use creation date; these are not one conversion cohort.'
              : 'Completed orders use completion date. Pending and cancelled orders use their recorded creation date in this demo.'}
          </p>
        </Module>
      </div>
      <Module
        title="Items Sold Trend"
        note={
          data.source === 'real'
            ? 'One completed eligible Listing unit or lot per Order; no inferred quantity.'
            : 'Item quantity sold, not number of orders.'
        }
      >
        <ChartContainer
          config={{ sold: { label: 'Items Sold', color: colors[0] } }}
          className={styles.chart}
        >
          <BarChart accessibilityLayer={true} data={c.trend}>
            <CartesianGrid vertical={false} stroke="#ffffff12" />
            <XAxis
              dataKey="date"
              tickFormatter={tick}
              minTickGap={42}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              width={36}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<AnalysisTooltip money={false} />} />
            <Bar
              name="Items Sold"
              dataKey="sold"
              fill={colors[0]}
              radius={[5, 5, 0, 0]}
              maxBarSize={32}
              isAnimationActive={!reduced}
            />
          </BarChart>
        </ChartContainer>
      </Module>
    </>
  )
}
function Advanced({ data }: { data: ShopAnalysisResponse }) {
  const reduced = useReducedMotion()
  const pro = data.pro
  if (!pro) return null
  const products = pro.products
  const top =
    pro.topProducts ??
    [...products]
      .sort((a, b) => b.sold - a.sold || a.id.localeCompare(b.id))
      .slice(0, 5)
  const max = top[0]?.sold || 0
  const distribution =
    pro.distribution ??
    products.slice(0, 5).map((p) => ({ name: p.name, cents: p.revenueCents }))
  if (!pro.distribution && products.length > 5)
    distribution.push({
      name: 'Other Products',
      cents: products.slice(5).reduce((sum, p) => sum + p.revenueCents, 0),
    })
  return (
    <>
      <Module
        title="Product Performance"
        note={
          data.source === 'real'
            ? 'Top 20 products by recorded item sales; totals and distribution include all products.'
            : 'See which products bring the most revenue and profit.'
        }
      >
        {products.length ? (
          <Table className={styles.performanceTable}>
            <TableCaption>
              {data.source === 'real'
                ? 'Contribution estimate = recorded item sales - frozen Order costs. General operating expenses are not allocated to products.'
                : 'Product contribution profit = revenue - cost snapshots - direct product expenses. General Shop costs are not allocated to products.'}
            </TableCaption>
            <TableHeader>
              <TableRow>
                {[
                  '#',
                  'Product',
                  'Items Sold',
                  'Revenue',
                  'Cost',
                  'Profit',
                  'Margin',
                ].map((label) => (
                  <TableHead
                    key={label}
                    className={
                      ['#', 'Product'].includes(label)
                        ? undefined
                        : styles.numeric
                    }
                  >
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p, i) => (
                <TableRow key={p.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <div className={styles.product}>
                      {p.image && (
                        <img src={p.image} alt="" width={36} height={36} />
                      )}
                      <span>{p.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className={styles.numeric}>{p.sold}</TableCell>
                  <TableCell className={styles.numeric}>
                    {shopMoney(p.revenueCents)}
                  </TableCell>
                  <TableCell className={styles.numeric}>
                    {p.costCents === null ? 'Unknown' : shopMoney(p.costCents)}
                  </TableCell>
                  <TableCell
                    className={`${styles.numeric} ${
                      p.profitCents !== null && p.profitCents < 0
                        ? styles.negative
                        : styles.positive
                    }`}
                  >
                    {p.profitCents === null
                      ? '\u2014'
                      : shopMoney(p.profitCents)}
                  </TableCell>
                  <TableCell>
                    <div className={styles.margin}>
                      <span>
                        {p.margin === null
                          ? '\u2014'
                          : `${p.margin.toFixed(1)}%`}
                      </span>
                      <Progress
                        value={p.margin ?? 0}
                        aria-label={`${p.name} profit margin`}
                        aria-valuetext={
                          p.margin === null
                            ? 'Unknown cost'
                            : `${p.margin.toFixed(1)}% profit margin`
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className={styles.empty}>
            No completed Shop products in this period.
          </p>
        )}
      </Module>
      <div className={styles.twoColumns}>
        <Module
          title="Product Revenue Distribution"
          note="Revenue share, not profit share."
        >
          <Donut
            entries={distribution}
            total={data.current.revenueCents ?? 0}
            label="Product Revenue"
          />
        </Module>
        <Module title="Top Selling Products">
          {top.length ? (
            <ol className={styles.ranking}>
              {top.map((p) => (
                <li key={p.id}>
                  {'image' in p && typeof p.image === 'string' && p.image && (
                    <img src={p.image} alt="" width={34} height={34} />
                  )}
                  <div>
                    <div className={styles.row}>
                      <span>{p.name}</span>
                      <b>{p.sold}</b>
                    </div>
                    <Progress
                      value={max ? (p.sold / max) * 100 : 0}
                      aria-label={`${p.name} relative sales`}
                      aria-valuetext={`${p.sold} items sold, relative to top seller`}
                    />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>No product sales in this period.</p>
          )}
        </Module>
      </div>
      {(data.source !== 'real' || data.access !== 'plus') && (
        <Module
          title="Featured Shop Performance"
          note="Track how your featured shop performs."
        >
          {pro.featured?.impressions ? (
            <>
              <div className={styles.featuredMetrics}>
                <div>
                  <span>Impressions</span>
                  <strong>{pro.featured.impressions.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Shop Visits</span>
                  <strong>{pro.featured.visits.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Visit Rate</span>
                  <strong>{pro.featured.rate?.toFixed(1)}%</strong>
                </div>
              </div>
              <p className={styles.muted}>
                Attributed featured visits / featured impressions. Organic
                visits are excluded.
              </p>
              <ChartContainer
                config={{
                  impressions: { label: 'Impressions', color: colors[0] },
                  visits: { label: 'Attributed Visits', color: colors[2] },
                }}
                className={styles.chart}
              >
                <AreaChart accessibilityLayer={true} data={data.current.trend}>
                  <CartesianGrid vertical={false} stroke="#ffffff12" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => v.slice(5)}
                    minTickGap={42}
                  />
                  <YAxis width={40} />
                  <Tooltip content={<AnalysisTooltip money={false} />} />
                  <Area
                    name="Impressions"
                    dataKey="impressions"
                    stroke={colors[0]}
                    fill={colors[0]}
                    fillOpacity={0.12}
                    isAnimationActive={!reduced}
                  />
                  <Area
                    name="Attributed Shop Visits"
                    dataKey="visits"
                    stroke={colors[2]}
                    fill={colors[2]}
                    fillOpacity={0.08}
                    isAnimationActive={!reduced}
                  />
                </AreaChart>
              </ChartContainer>
            </>
          ) : (
            <p className={styles.empty}>
              {data.source === 'real'
                ? 'Promotion performance is unavailable. Impressions and attributed visits have not been collected; ordinary authenticated opens are not promotion attribution.'
                : 'No featured impressions in this period. Promotion event tracking is not connected.'}
            </p>
          )}
        </Module>
      )}
    </>
  )
}
/** Demo access is presentation only. No production entitlement or analytics endpoint is invented. */
function RealCoverage({ data }: { data: RealShopAnalysis }) {
  const c = data.current.coverage
  return (
    <p className={styles.disclosure} role="status">
      Real account data · Toronto · {data.membershipStatus}. Recorded UU Pay:{' '}
      {shopMoney(c.uuPayCents)}; externally confirmed:{' '}
      {shopMoney(c.externalCents)}. Known gross item subtotal:{' '}
      {shopMoney(c.grossItemValueCents)}; excluded refunded-order item value:{' '}
      {shopMoney(c.excludedRefundedItemCents)} (not a verified refund cashflow).
      Known sales subtotal: {shopMoney(c.knownSalesCents)}.{' '}
      {data.current.missingCostCount} unknown costs; {c.missingProvenanceCount}{' '}
      missing Shop origins; {c.currencyMismatchCount} currency mismatches;{' '}
      {c.invalidFactCount} incomplete facts; {c.refundedCount} refunded Orders.
      {!c.profitComplete &&
        ' Profit is unavailable because required financial facts are incomplete.'}
      Recorded authenticated opens: {c.authenticatedShopOpens} Shop,{' '}
      {c.authenticatedListingOpens} Listing; not total or unique visitors.
      Period {data.current.bounds.start} to {data.current.bounds.end}{' '}
      (exclusive); observed through {data.current.bounds.observedUntil}.
      Comparison {data.previous.bounds.start} to {data.previous.bounds.end}:
      whole preceding equal-calendar-day period versus current-to-date.
      Pending/cancelled counts use creation date; {c.expiredCount} expired
      Orders are separate.
    </p>
  )
}

function LiveAnalysisFrame({
  headerActionsTarget,
}: {
  headerActionsTarget?: HTMLElement | null
}) {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const reduced = useReducedMotion()
  return (
    <RealShopAnalysisView>
      {(state) => (
        <motion.section
          className={styles.page}
          aria-label="Shop Analysis"
          data-shop-surface="analysis"
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.4 }}
        >
          <DateRangePlacement wide={wide} target={headerActionsTarget}>
            <div className={styles.dateSelect}>
              <Select
                label="Date range"
                value={state.range}
                options={shopAnalysisRanges}
                onChange={(value) => state.changeRange(value)}
              />
            </div>
          </DateRangePlacement>
          {state.loading && (
            <Skeleton
              style={{ height: 360 }}
              aria-label="Loading Shop analytics"
            />
          )}
          {state.error && (
            <div className={styles.empty} role="alert">
              {state.error}
              <ShiningButton onClick={() => state.retry()}>Retry</ShiningButton>
            </div>
          )}
          {state.data && !state.loading && !state.error && (
            <div
              role="region"
              aria-label="Real Shop analytics"
              data-analysis-range={state.data.range}
            >
              <Dashboard
                data={state.data}
                onExpense={() => state.addExpense()}
              />
              <div className={`${styles.sectionHeading} ${styles.proHeading}`}>
                <div>
                  <h2>Product Insights</h2>
                  <p>
                    Recorded sales performance. Promotion analysis requires Pro
                    and collected attribution.
                  </p>
                </div>
                <ShopProBadge
                  tier={state.data.access === 'plus' ? 'plus' : 'pro'}
                />
              </div>
              <Advanced data={state.data} />
            </div>
          )}
        </motion.section>
      )}
    </RealShopAnalysisView>
  )
}

export function ShopAnalysis(props: Parameters<typeof DemoShopAnalysis>[0]) {
  if (props.loadDemo || props.demoAccess) return <DemoShopAnalysis {...props} />
  return <LiveAnalysisFrame headerActionsTarget={props.headerActionsTarget} />
}

function DemoShopAnalysis({
  replayToken = 1,
  demoAccess,
  headerActionsTarget,
  loadDemo = loadShopAnalysisFixture,
}: {
  shop?: ShopPreview
  replayToken?: number
  demoAccess?: ShopAnalysisDemoAccess
  headerActionsTarget?: HTMLElement | null
  loadDemo?: DemoLoader
}) {
  // Until live analytics/access exists, the page itself is the explicitly labelled demo.
  // Explicit demoAccess remains a component-test seam, never subscription authority.
  const preview = demoAccess === undefined
  const access = demoAccess ?? 'pro'
  const [range, setRange] = useState<ShopAnalysisRange>('month')
  const [wideHeader, setWideHeader] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => setWideHeader(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const [data, setData] = useState<ShopAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [expenses, setExpenses] = useState<ShopExpense[]>([])
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [plans, setPlans] = useState(false)
  const reduced = useReducedMotion()
  const changeRange = useCallback((v: string) => {
    if (shopAnalysisRanges.some((x) => x.value === v))
      setRange(v as ShopAnalysisRange)
  }, [])
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    loadDemo(range, access, expenses)
      .then((result) => {
        if (!current) return
        if (
          result.source !== 'fixture' ||
          result.range !== range ||
          result.access !== access
        )
          throw Error('Incorrect demo response')
        setData(result)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(
            reason instanceof Error && reason.message === 'unauthorized'
              ? 'You do not have access to this Shop analysis.'
              : 'Shop analytics are unavailable. Please retry.'
          )
          setLoading(false)
        }
      })
    return () => {
      current = false
    }
  }, [access, range, expenses, retry, loadDemo])
  const dateControl = (
    <div className={styles.dateSelect}>
      <Select
        label="Date range"
        value={range}
        options={shopAnalysisRanges}
        onChange={changeRange}
      />
    </div>
  )
  return (
    <motion.section
      className={styles.page}
      aria-label="Shop Analysis"
      data-shop-surface="analysis"
      data-replay-token={replayToken}
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.4 }}
    >
      <DateRangePlacement wide={wideHeader} target={headerActionsTarget}>
        {dateControl}
      </DateRangePlacement>
      <>
        {error && (
          <div className={styles.empty} role="alert">
            {error}
            <ShiningButton onClick={() => setRetry((v) => v + 1)}>
              Retry
            </ShiningButton>
          </div>
        )}
        {!error && (!data || data.access !== access) && (
          <Skeleton
            style={{ height: 360 }}
            aria-label="Loading Shop analytics"
          />
        )}
        {!error && data && data.access === access && (
          <div
            aria-busy={loading}
            data-analysis-range={data.range}
            data-analysis-preview={preview || undefined}
            role="region"
            aria-label={
              preview
                ? 'Demo Shop analytics - press Enter to view Shop Plans'
                : 'Shop analytics content'
            }
            tabIndex={preview ? 0 : undefined}
            onClickCapture={(event) => {
              if (!preview) return
              event.preventDefault()
              event.stopPropagation()
              setPlans(true)
            }}
            onKeyDownCapture={(event) => {
              if (
                preview &&
                event.target === event.currentTarget &&
                ['Enter', ' '].includes(event.key)
              ) {
                event.preventDefault()
                setPlans(true)
              }
            }}
          >
            <Dashboard data={data} onExpense={() => setExpenseOpen(true)} />
            <div className={`${styles.sectionHeading} ${styles.proHeading}`}>
              <div>
                <h2>Pro Insights</h2>
                <p>Advanced insights to help your shop grow.</p>
              </div>
              <ShopProBadge />
            </div>
            {access === 'plus' ? (
              <section
                className={styles.locked}
                aria-label="Locked Pro preview"
              >
                <LockKeyhole size={25} />
                <h3>Unlock advanced Shop insights</h3>
                <p>Locked preview - no Pro-exclusive account data is loaded.</p>
                <ul>
                  <li>Product Performance</li>
                  <li>Product Revenue Distribution</li>
                  <li>Top Selling Products</li>
                  <li>Featured Shop Performance</li>
                </ul>
                <ShiningButton onClick={() => setPlans(true)}>
                  Upgrade to Pro
                </ShiningButton>
              </section>
            ) : (
              <>
                <p className={styles.muted}>
                  {access === 'trial'
                    ? '2-month Pro Trial demo - full Plus and Pro visibility. No trial subscription charge is included.'
                    : 'Pro demo - full Plus and Pro visibility.'}
                </p>
                <Advanced data={data} />
              </>
            )}
          </div>
        )}
      </>
      <AnimatePresence>
        {expenseOpen && (
          <ExpenseDialog
            onClose={() => setExpenseOpen(false)}
            onAdd={(expense) => setExpenses((values) => [...values, expense])}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {plans && <ShopPricingDialog onClose={() => setPlans(false)} />}
      </AnimatePresence>
    </motion.section>
  )
}
