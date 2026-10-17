export type ActivityMetric = 'listings' | 'overall' | 'sold' | 'views'
export type ActivityPeriod = '1D' | '7D' | '30D'
export type ActivityPoint = Record<ActivityMetric, number> & {
  timestamp: string
  label: string
}
export type AccountActivity = {
  period: ActivityPeriod
  points: ActivityPoint[]
}
export function validAccountActivity(
  value: AccountActivity,
  period: ActivityPeriod
) {
  return (
    value?.period === period &&
    Array.isArray(value.points) &&
    value.points.length ===
      (period === '1D' ? 24 : Number.parseInt(period, 10)) &&
    value.points.every(
      (point) =>
        typeof point.label === 'string' &&
        Number.isFinite(Date.parse(point.timestamp)) &&
        [point.views, point.listings, point.sold, point.overall].every(
          (n) => Number.isSafeInteger(n) && n >= 0
        ) &&
        point.overall === point.views + point.listings + point.sold
    )
  )
}
