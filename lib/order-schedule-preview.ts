/** Browser-local scheduling rules for the ephemeral Order preview only. */
export const ORDER_SCHEDULE_MIN_NOTICE_MINUTES = 60
export const ORDER_SCHEDULE_MAX_DAYS = 30
export const ORDER_SCHEDULE_STEP_MINUTES = 15
export type ScheduleMode = 'scheduled' | 'tbd'
export type ScheduleDraft = { mode: ScheduleMode; date?: Date; time: string }
export type ScheduleSnapshot = {
  scheduleMode: ScheduleMode
  scheduledAt?: number
}
export type ScheduleValidationResult =
  | { valid: false; message: string }
  | { valid: true; scheduledAt?: Date }
export function startOfLocalDay(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}
export function addLocalDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}
export function roundUpToMinuteStep(
  date: Date,
  step = ORDER_SCHEDULE_STEP_MINUTES
) {
  const result = new Date(date)
  const partial = result.getSeconds() !== 0 || result.getMilliseconds() !== 0
  result.setSeconds(0, 0)
  if (partial) result.setMinutes(result.getMinutes() + 1)
  const remainder = result.getMinutes() % step
  if (remainder) result.setMinutes(result.getMinutes() + step - remainder)
  return result
}
export function getEarliestOrderSchedule(now = new Date()) {
  return roundUpToMinuteStep(
    new Date(now.getTime() + ORDER_SCHEDULE_MIN_NOTICE_MINUTES * 60 * 1000)
  )
}
export function getLatestOrderSchedule(now = new Date()) {
  return addLocalDays(now, ORDER_SCHEDULE_MAX_DAYS)
}
export function combineLocalDateAndTime(date: Date, time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) return null
  const [hours, minutes] = time.split(':').map(Number)
  if (hours > 23 || minutes > 59 || !Number.isFinite(date.getTime()))
    return null
  const result = startOfLocalDay(date)
  result.setHours(hours, minutes, 0, 0)
  // Reject nonexistent local times during a daylight-saving clock change.
  if (result.getHours() !== hours || result.getMinutes() !== minutes)
    return null
  return result
}
export function isValidScheduleMinuteStep(date: Date) {
  return (
    date.getMinutes() % ORDER_SCHEDULE_STEP_MINUTES === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  )
}
export function validateOrderScheduleSnapshot(
  value: ScheduleSnapshot,
  now = new Date()
): ScheduleValidationResult {
  if (value.scheduleMode !== 'scheduled')
    return { valid: false, message: 'Choose a date and time.' }
  const date = new Date(value.scheduledAt ?? NaN)
  if (!Number.isFinite(date.getTime()))
    return { valid: false, message: 'Choose a date and time.' }
  if (!isValidScheduleMinuteStep(date))
    return { valid: false, message: 'Choose a time in 15-minute increments.' }
  if (date < getEarliestOrderSchedule(now))
    return { valid: false, message: 'Choose a time at least 1 hour from now.' }
  if (date > getLatestOrderSchedule(now))
    return { valid: false, message: 'Choose a time within the next 30 days.' }
  return { valid: true, scheduledAt: date }
}
export function validateNewOrderSchedule(
  value: ScheduleDraft,
  now = new Date()
): ScheduleValidationResult {
  const date = value.date && combineLocalDateAndTime(value.date, value.time)
  return validateOrderScheduleSnapshot(
    { scheduleMode: value.mode, scheduledAt: date?.getTime() },
    now
  )
}
export function canAcceptScheduledRequest(
  value: ScheduleSnapshot,
  now = new Date()
) {
  if (value.scheduleMode !== 'scheduled') return false
  return (
    Number.isFinite(value.scheduledAt) &&
    Number(value.scheduledAt) > now.getTime()
  )
}
export function isRequestScheduleAvailable(
  value: ScheduleSnapshot & { fulfillment: string },
  now = new Date()
) {
  return (
    value.fulfillment === 'shipping' || canAcceptScheduledRequest(value, now)
  )
}
export function formatScheduleDate(date?: Date) {
  if (!date) return 'Choose a date'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
export function formatSchedule(value: ScheduleSnapshot) {
  if (value.scheduleMode !== 'scheduled') return 'Schedule unavailable'
  const date = new Date(value.scheduledAt ?? NaN)
  if (!Number.isFinite(date.getTime())) return 'Schedule unavailable'
  const time = formatScheduleTime(
    `${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes()
    ).padStart(2, '0')}`
  )
  return `${formatScheduleDate(date)} \u00b7 ${time}`
}

export type Meridiem = 'AM' | 'PM'
export function to24HourTime(hour: number, minute: number, meridiem: Meridiem) {
  const hour24 = (hour % 12) + (meridiem === 'PM' ? 12 : 0)
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
export function from24HourTime(time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) return null
  const [hour, minute] = time.split(':').map(Number)
  if (hour > 23 || minute % ORDER_SCHEDULE_STEP_MINUTES !== 0 || minute > 59)
    return null
  return {
    hour: hour % 12 || 12,
    minute,
    meridiem: (hour >= 12 ? 'PM' : 'AM') as Meridiem,
  }
}
export function formatScheduleTime(time: string) {
  const value = from24HourTime(time)
  if (!value) return time || 'Choose a time'
  return `${value.hour}:${String(value.minute).padStart(2, '0')} ${
    value.meridiem
  }`
}
export function seedOrderTimeWheel(
  value: string,
  selectedDate?: Date,
  now = new Date()
) {
  const existing = from24HourTime(value)
  if (existing) return existing
  const today =
    selectedDate &&
    startOfLocalDay(selectedDate).getTime() === startOfLocalDay(now).getTime()
  const seed = today ? getEarliestOrderSchedule(now) : roundUpToMinuteStep(now)
  return {
    hour: seed.getHours() % 12 || 12,
    minute: seed.getMinutes(),
    meridiem: (seed.getHours() >= 12 ? 'PM' : 'AM') as Meridiem,
  }
}
