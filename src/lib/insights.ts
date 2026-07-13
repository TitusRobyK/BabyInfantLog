import { ACTION_BY_TYPE } from './actionMeta'
import { durationMinutes, netSleepMinutes } from './time'
import type { CareEvent, EventType, SleepInterruption } from './types'

export type InsightsAction = 'all' | EventType
export type InsightsRange = 'day' | 'week' | 'month'

export interface InsightsPeriod {
  range: InsightsRange
  anchorDate: string
  startKey: string
  endKeyExclusive: string
  start: Date
  end: Date
  effectiveEnd: Date
  dateKeys: string[]
  label: string
  isCurrent: boolean
  isFuture: boolean
}

export interface DailyInsight {
  date: string
  count: number
  minutes: number
  volumeMl: number
  interruptions: number
}

export interface ActionInsight {
  action: EventType
  events: CareEvent[]
  count: number
  minutes: number
  volumeMl: number
  volumeEntries: number
  missingVolume: number
  interruptions: number
  longestMinutes: number
  medianIntervalMinutes: number | null
  days: DailyInsight[]
}

interface CalendarParts {
  year: number
  month: number
  day: number
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function todayDateKey(timezone: string, now = new Date()): string {
  const parts = zonedParts(now, timezone)
  return toDateKey(parts)
}

export function periodFor(
  range: InsightsRange,
  anchorDate: string,
  timezone: string,
  now = new Date(),
): InsightsPeriod {
  assertDateKey(anchorDate)
  const startKey = range === 'day'
    ? anchorDate
    : range === 'week'
      ? startOfWeekKey(anchorDate)
      : startOfMonthKey(anchorDate)
  const endKeyExclusive = range === 'day'
    ? addDays(startKey, 1)
    : range === 'week'
      ? addDays(startKey, 7)
      : addMonths(startKey, 1)
  const start = zonedMidnight(startKey, timezone)
  const end = zonedMidnight(endKeyExclusive, timezone)
  const effectiveEnd = new Date(Math.min(end.getTime(), now.getTime()))
  const today = todayDateKey(timezone, now)
  const isCurrent = today >= startKey && today < endKeyExclusive
  return {
    range,
    anchorDate: startKey,
    startKey,
    endKeyExclusive,
    start,
    end,
    effectiveEnd,
    dateKeys: enumerateDateKeys(startKey, endKeyExclusive),
    label: periodLabel(range, startKey, endKeyExclusive),
    isCurrent,
    isFuture: start.getTime() > now.getTime(),
  }
}

export function movePeriodAnchor(range: InsightsRange, anchorDate: string, amount: number): string {
  if (range === 'day') return addDays(anchorDate, amount)
  if (range === 'week') return addDays(startOfWeekKey(anchorDate), amount * 7)
  return addMonths(startOfMonthKey(anchorDate), amount)
}

export function clampPeriodAnchor(range: InsightsRange, anchorDate: string, historyStartDate: string): string {
  assertDateKey(historyStartDate)
  const candidateStart = range === 'day'
    ? anchorDate
    : range === 'week'
      ? startOfWeekKey(anchorDate)
      : startOfMonthKey(anchorDate)
  if (candidateStart >= historyStartDate) return anchorDate
  if (range === 'day') return historyStartDate
  if (range === 'week') {
    const firstWeek = startOfWeekKey(historyStartDate)
    return firstWeek < historyStartDate ? addDays(firstWeek, 7) : firstWeek
  }
  const firstMonth = startOfMonthKey(historyStartDate)
  return firstMonth < historyStartDate ? addMonths(firstMonth, 1) : firstMonth
}

export function buildActionInsight(
  action: EventType,
  events: CareEvent[],
  interruptions: SleepInterruption[],
  period: InsightsPeriod,
  timezone: string,
): ActionInsight {
  const session = ACTION_BY_TYPE[action].session
  const matching = events
    .filter((event) => !event.deleted_at && event.event_type === action)
    .filter((event) => session ? overlaps(event, period.start, period.effectiveEnd) : startsWithin(event, period.start, period.effectiveEnd))
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
  const started = matching.filter((event) => startsWithin(event, period.start, period.effectiveEnd))
  const amountEvents = started.filter((event) => typeof event.details.amount_ml === 'number')
  const sleepInterruptions = action === 'sleep'
    ? interruptions.filter((interruption) => !interruption.deleted_at && matching.some((event) => event.id === interruption.sleep_event_id))
    : []
  const sessionDurations = session
    ? matching.map((event) => sessionMinutes(event, interruptions, period.start, period.effectiveEnd))
    : []

  const days = period.dateKeys.map((date) => {
    const dayStart = zonedMidnight(date, timezone)
    const dayEnd = new Date(Math.min(zonedMidnight(addDays(date, 1), timezone).getTime(), period.effectiveEnd.getTime()))
    if (dayEnd <= dayStart) return { date, count: 0, minutes: 0, volumeMl: 0, interruptions: 0 }
    const dayStarted = matching.filter((event) => startsWithin(event, dayStart, dayEnd))
    const daySessions = session ? matching.filter((event) => overlaps(event, dayStart, dayEnd)) : []
    return {
      date,
      count: dayStarted.length,
      minutes: session ? daySessions.reduce((total, event) => total + sessionMinutes(event, interruptions, dayStart, dayEnd), 0) : 0,
      volumeMl: dayStarted.reduce((total, event) => total + numericAmount(event), 0),
      interruptions: action === 'sleep'
        ? sleepInterruptions.filter((interruption) => intervalOverlaps(interruption.started_at, interruption.ended_at, dayStart, dayEnd)).length
        : 0,
    }
  })

  return {
    action,
    events: matching,
    count: started.length,
    minutes: sessionDurations.reduce((total, minutes) => total + minutes, 0),
    volumeMl: amountEvents.reduce((total, event) => total + numericAmount(event), 0),
    volumeEntries: amountEvents.length,
    missingVolume: action === 'feed' || action === 'pump' ? started.length - amountEvents.length : 0,
    interruptions: action === 'sleep'
      ? sleepInterruptions.filter((interruption) => intervalOverlaps(interruption.started_at, interruption.ended_at, period.start, period.effectiveEnd)).length
      : 0,
    longestMinutes: sessionDurations.length ? Math.max(...sessionDurations) : 0,
    medianIntervalMinutes: medianInterval(started),
    days,
  }
}

export function sessionMinutes(
  event: CareEvent,
  interruptions: SleepInterruption[],
  start: Date,
  end: Date,
): number {
  const clippedStart = new Date(Math.max(new Date(event.occurred_at).getTime(), start.getTime())).toISOString()
  const clippedEnd = new Date(Math.min(new Date(event.ended_at ?? end).getTime(), end.getTime())).toISOString()
  if (new Date(clippedEnd) <= new Date(clippedStart)) return 0
  return event.event_type === 'sleep'
    ? netSleepMinutes(event, interruptions, clippedStart, clippedEnd)
    : durationMinutes(clippedStart, clippedEnd)
}

export function insightValue(insight: ActionInsight): number {
  return ACTION_BY_TYPE[insight.action].session ? insight.minutes : insight.count
}

export function dailyInsightValue(action: EventType, day: DailyInsight): number {
  return ACTION_BY_TYPE[action].session ? day.minutes : day.count
}

export function startOfWeekKey(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey)
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - weekday + 1)
  return date.toISOString().slice(0, 10)
}

export function startOfMonthKey(dateKey: string): string {
  const { year, month } = parseDateKey(dateKey)
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export function addDays(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function addMonths(dateKey: string, months: number): string {
  const { year, month } = parseDateKey(dateKey)
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10)
}

export function zonedMidnight(dateKey: string, timezone: string): Date {
  const target = parseDateKey(dateKey)
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day)
  let guess = targetUtc
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = zonedParts(new Date(guess), timezone, true)
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const adjustment = targetUtc - actualAsUtc
    guess += adjustment
    if (adjustment === 0) break
  }
  return new Date(guess)
}

function startsWithin(event: CareEvent, start: Date, end: Date): boolean {
  const timestamp = new Date(event.occurred_at).getTime()
  return timestamp >= start.getTime() && timestamp < end.getTime()
}

function overlaps(event: CareEvent, start: Date, end: Date): boolean {
  const eventStart = new Date(event.occurred_at).getTime()
  const eventEnd = new Date(event.ended_at ?? end).getTime()
  return eventStart < end.getTime() && eventEnd > start.getTime()
}

function intervalOverlaps(startValue: string, endValue: string | null, start: Date, end: Date): boolean {
  return new Date(startValue).getTime() < end.getTime() && new Date(endValue ?? end).getTime() > start.getTime()
}

function numericAmount(event: CareEvent): number {
  return typeof event.details.amount_ml === 'number' ? event.details.amount_ml : 0
}

function medianInterval(events: CareEvent[]): number | null {
  if (events.length < 2) return null
  const times = events.map((event) => new Date(event.occurred_at).getTime()).sort((a, b) => a - b)
  const gaps = times.slice(1).map((time, index) => Math.round((time - times[index]) / 60_000)).sort((a, b) => a - b)
  const middle = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[middle] : Math.round((gaps[middle - 1] + gaps[middle]) / 2)
}

function enumerateDateKeys(start: string, endExclusive: string): string[] {
  const result: string[] = []
  for (let key = start; key < endExclusive; key = addDays(key, 1)) result.push(key)
  return result
}

function periodLabel(range: InsightsRange, start: string, endExclusive: string): string {
  if (range === 'day') return formatDateKey(start, { weekday: 'short', month: 'short', day: 'numeric' })
  if (range === 'month') return formatDateKey(start, { month: 'long', year: 'numeric' })
  const end = addDays(endExclusive, -1)
  const startParts = parseDateKey(start)
  const endParts = parseDateKey(end)
  if (startParts.year !== endParts.year) {
    const left = formatDateKey(start, { month: 'short', day: 'numeric', year: 'numeric' })
    const right = formatDateKey(end, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${left}–${right}`
  }
  const left = formatDateKey(start, { month: 'short', day: 'numeric' })
  const right = startParts.month === endParts.month
    ? `${endParts.day}, ${endParts.year}`
    : formatDateKey(end, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${left}–${right}`
}

function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`))
}

function zonedParts(date: Date, timezone: string, includeTime = false): CalendarParts & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {}),
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

function parseDateKey(value: string): CalendarParts {
  assertDateKey(value)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Invalid calendar date.')
  }
  return { year, month, day }
}

function assertDateKey(value: string): void {
  if (!DATE_KEY_PATTERN.test(value)) throw new Error('Invalid calendar date.')
}

function toDateKey(parts: CalendarParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}
