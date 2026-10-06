// Deterministic demonstration data only; never presented as live account activity.
export type AnalyticsMetric = 'listings' | 'overall' | 'sold' | 'views'
export type AnalyticsPeriod = '1D' | '7D' | '30D'

export function mockTrend(period: AnalyticsPeriod) {
  const count = period === '1D' ? 24 : Number.parseInt(period, 10)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 4))
    if (period === '1D') date.setUTCHours(index)
    else date.setUTCDate(date.getUTCDate() - count + index + 1)
    const seed = period === '1D' ? index : 30 - count + index
    const accountViews = 80 + ((seed * 43 + 29) % 120)
    const views = accountViews
    const listings = 1 + (seed % 4)
    const sold = seed % 3 === 0 ? 1 : 0
    return {
      date: date.toISOString(),
      label:
        period === '1D'
          ? `${String(index).padStart(2, '0')}:00`
          : date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            }),
      views,
      listings,
      sold,
      overall: views + listings + sold,
    }
  })
}
