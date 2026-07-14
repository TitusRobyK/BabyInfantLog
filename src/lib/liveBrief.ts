import { formatDuration } from './time'
import type { CareEvent, SleepInterruption } from './types'

export const LIVE_BRIEF_TITLE = 'Latest brief'

type BriefDayReference = 'today' | 'yesterday'
type DiscreteEventType = 'poop' | 'pee' | 'feed' | 'burp' | 'diaper_check' | 'hiccups'

export interface LiveBriefWindow {
  start: Date
  end: Date
  dayReference: BriefDayReference
  timeframeLabel: string
}

export interface LiveBriefMetrics {
  counts: Record<DiscreteEventType, number>
  feed: {
    sessions: number
    medianIntervalMinutes: number | null
    volumeMl: number
    sessionsWithVolume: number
    sessionsWithoutVolume: number
  }
  sleep: {
    sessions: number
    ongoingSessions: number
    totalMinutes: number
    longestMinutes: number
    interruptions: number
    interruptionMinutes: number
  }
  pump: {
    sessions: number
    ongoingSessions: number
    totalMinutes: number
    volumeMl: number
    sessionsWithVolume: number
    sessionsWithoutVolume: number
  }
}

export interface LiveBrief {
  title: typeof LIVE_BRIEF_TITLE
  window: LiveBriefWindow
  timeframeLabel: string
  metrics: LiveBriefMetrics
  lines: string[]
  empty: boolean
  emptyMessage: string
}

interface Interval {
  start: number
  end: number
}

interface SessionDuration {
  interruptionMs: number
  netMs: number
  interruptionIds: string[]
}

/**
 * Returns the live brief window from the most recent household-local 8 PM
 * through the supplied current time.
 */
export function latestBriefWindow(now: Date, timezone: string): LiveBriefWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError('The current time must be a valid date.')

  const parts = zonedParts(now, timezone)
  const today = dateKey(parts)
  const dayReference: BriefDayReference = parts.hour >= 20 ? 'today' : 'yesterday'
  const startDate = dayReference === 'today' ? today : addDays(today, -1)
  const start = zonedDateTime(startDate, 20, timezone)
  const updatedTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(now)

  return {
    start,
    end: new Date(now),
    dayReference,
    timeframeLabel: `Since 8 PM ${dayReference} · updated through ${updatedTime}`,
  }
}

/**
 * Builds the live, shared brief from already-loaded entries. Entries are not
 * filtered by creator, so activity recorded by either parent is included.
 */
export function buildLiveBrief(
  events: CareEvent[],
  interruptions: SleepInterruption[],
  timezone: string,
  now = new Date(),
): LiveBrief {
  const window = latestBriefWindow(now, timezone)
  const startMs = window.start.getTime()
  const endMs = window.end.getTime()
  const activeEvents = events.filter((event) => !event.deleted_at)
  const activeInterruptions = interruptions.filter((interruption) => !interruption.deleted_at)
  const discrete = activeEvents.filter((event) => {
    if (event.event_type === 'sleep' || event.event_type === 'pump') return false
    const occurredAt = timestamp(event.occurred_at)
    return occurredAt !== null && occurredAt >= startMs && occurredAt <= endMs
  })

  const counts: LiveBriefMetrics['counts'] = {
    poop: countEvents(discrete, 'poop'),
    pee: countEvents(discrete, 'pee'),
    feed: countEvents(discrete, 'feed'),
    burp: countEvents(discrete, 'burp'),
    diaper_check: countEvents(discrete, 'diaper_check'),
    hiccups: countEvents(discrete, 'hiccups'),
  }
  const feeds = discrete
    .filter((event) => event.event_type === 'feed')
    .sort((left, right) => new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime())
  const feedVolumeEvents = feeds.filter(hasRecordedVolume)
  const feed = {
    sessions: feeds.length,
    medianIntervalMinutes: medianInterval(feeds),
    volumeMl: sumVolume(feedVolumeEvents),
    sessionsWithVolume: feedVolumeEvents.length,
    sessionsWithoutVolume: feeds.length - feedVolumeEvents.length,
  }

  const sleepEvents = overlappingSessions(activeEvents, 'sleep', startMs, endMs)
  const sleepDurations = sleepEvents.map((event) => sleepSessionDuration(event, activeInterruptions, startMs, endMs))
  const interruptionIds = new Set(sleepDurations.flatMap((duration) => duration.interruptionIds))
  const sleep = {
    sessions: sleepEvents.length,
    ongoingSessions: sleepEvents.filter((event) => !event.ended_at).length,
    totalMinutes: minutes(sleepDurations.reduce((total, duration) => total + duration.netMs, 0)),
    longestMinutes: sleepDurations.length ? minutes(Math.max(...sleepDurations.map((duration) => duration.netMs))) : 0,
    interruptions: interruptionIds.size,
    interruptionMinutes: minutes(sleepDurations.reduce((total, duration) => total + duration.interruptionMs, 0)),
  }

  const pumpEvents = overlappingSessions(activeEvents, 'pump', startMs, endMs)
  // Pump amount is collected when a session is stopped. Include completed
  // sessions that cross the 8 PM boundary, but do not call an active session
  // "missing" before the parent has reached the details step.
  const pumpVolumeCandidates = pumpEvents.filter((event) => event.ended_at !== null)
  const pumpVolumeEvents = pumpVolumeCandidates.filter(hasRecordedVolume)
  const pump = {
    sessions: pumpEvents.length,
    ongoingSessions: pumpEvents.filter((event) => !event.ended_at).length,
    totalMinutes: minutes(pumpEvents.reduce((total, event) => total + sessionMilliseconds(event, startMs, endMs), 0)),
    volumeMl: sumVolume(pumpVolumeEvents),
    sessionsWithVolume: pumpVolumeEvents.length,
    sessionsWithoutVolume: pumpVolumeCandidates.length - pumpVolumeEvents.length,
  }

  const metrics: LiveBriefMetrics = { counts, feed, sleep, pump }
  const lines = presentationLines(metrics)
  const empty = lines.length === 0

  return {
    title: LIVE_BRIEF_TITLE,
    window,
    timeframeLabel: window.timeframeLabel,
    metrics,
    lines,
    empty,
    emptyMessage: `No entries since 8 PM ${window.dayReference}. The brief will update as care is logged.`,
  }
}

function presentationLines(metrics: LiveBriefMetrics): string[] {
  const lines: string[] = []

  if (metrics.feed.sessions) {
    const parts = [countLabel(metrics.feed.sessions, 'feed')]
    if (metrics.feed.medianIntervalMinutes !== null) {
      parts.push(`typical gap ${formatDuration(metrics.feed.medianIntervalMinutes)}`)
    }
    if (metrics.feed.sessionsWithVolume) parts.push(`${Math.round(metrics.feed.volumeMl)} ml recorded`)
    if (metrics.feed.sessionsWithoutVolume) {
      parts.push(`${countLabel(metrics.feed.sessionsWithoutVolume, 'feed')} without an amount`)
    }
    lines.push(parts.join(' · '))
  }

  if (metrics.sleep.sessions) {
    const parts = [metrics.sleep.totalMinutes
      ? `${formatDuration(metrics.sleep.totalMinutes)} sleep across ${countLabel(metrics.sleep.sessions, 'session')}`
      : countLabel(metrics.sleep.sessions, 'sleep session') + (metrics.sleep.ongoingSessions ? ' ongoing' : ' recorded')]
    if (metrics.sleep.totalMinutes && metrics.sleep.ongoingSessions) parts.push(`${countLabel(metrics.sleep.ongoingSessions, 'session')} ongoing`)
    if (metrics.sleep.interruptions) parts.push(countLabel(metrics.sleep.interruptions, 'interruption'))
    lines.push(parts.join(' · '))
  }

  const careCounts = [
    metrics.counts.pee ? `${metrics.counts.pee} pee` : '',
    metrics.counts.poop ? `${metrics.counts.poop} poop` : '',
    metrics.counts.diaper_check ? countLabel(metrics.counts.diaper_check, 'diaper check') : '',
  ].filter(Boolean)
  if (careCounts.length) lines.push(careCounts.join(' · '))

  if (metrics.counts.burp) lines.push(countLabel(metrics.counts.burp, 'burp'))
  if (metrics.counts.hiccups) lines.push(countLabel(metrics.counts.hiccups, 'hiccup episode'))

  if (metrics.pump.sessions) {
    const parts = [countLabel(metrics.pump.sessions, 'pump session')]
    if (metrics.pump.totalMinutes) parts.push(`${formatDuration(metrics.pump.totalMinutes)} total`)
    if (metrics.pump.ongoingSessions) parts.push(`${countLabel(metrics.pump.ongoingSessions, 'session')} ongoing`)
    if (metrics.pump.sessionsWithVolume) parts.push(`${Math.round(metrics.pump.volumeMl)} ml recorded`)
    if (metrics.pump.sessionsWithoutVolume) {
      parts.push(`${countLabel(metrics.pump.sessionsWithoutVolume, 'session')} without an amount`)
    }
    lines.push(parts.join(' · '))
  }

  return lines
}

function countEvents(events: CareEvent[], type: DiscreteEventType): number {
  return events.filter((event) => event.event_type === type).length
}

function overlappingSessions(
  events: CareEvent[],
  type: 'sleep' | 'pump',
  start: number,
  end: number,
): CareEvent[] {
  return events.filter((event) => event.event_type === type && sessionInterval(event, start, end) !== null)
}

function sessionInterval(event: CareEvent, start: number, end: number): Interval | null {
  const occurredAt = timestamp(event.occurred_at)
  const endedAt = event.ended_at === null ? end : timestamp(event.ended_at)
  if (occurredAt === null || endedAt === null || occurredAt > end || endedAt <= start || endedAt < occurredAt) return null
  return { start: Math.max(occurredAt, start), end: Math.min(endedAt, end) }
}

function sessionMilliseconds(event: CareEvent, start: number, end: number): number {
  const interval = sessionInterval(event, start, end)
  return interval ? Math.max(0, interval.end - interval.start) : 0
}

function sleepSessionDuration(
  event: CareEvent,
  interruptions: SleepInterruption[],
  start: number,
  end: number,
): SessionDuration {
  const session = sessionInterval(event, start, end)
  if (!session) return { interruptionMs: 0, netMs: 0, interruptionIds: [] }

  const interruptionIntervals = interruptions
    .filter((interruption) => interruption.sleep_event_id === event.id)
    .map((interruption) => {
      const interruptionStart = timestamp(interruption.started_at)
      const interruptionEnd = interruption.ended_at === null ? end : timestamp(interruption.ended_at)
      if (interruptionStart === null || interruptionEnd === null) return null
      const clipped = {
        id: interruption.id,
        start: Math.max(interruptionStart, session.start),
        end: Math.min(interruptionEnd, session.end),
      }
      return clipped.end > clipped.start ? clipped : null
    })
    .filter((interval): interval is Interval & { id: string } => interval !== null)
  const grossMs = Math.max(0, session.end - session.start)
  const interruptionMs = mergedDuration(interruptionIntervals)

  return {
    interruptionMs,
    netMs: Math.max(0, grossMs - interruptionMs),
    interruptionIds: interruptionIntervals.map((interval) => interval.id),
  }
}

function mergedDuration(intervals: Interval[]): number {
  const ordered = intervals.slice().sort((left, right) => left.start - right.start)
  if (!ordered.length) return 0
  let total = 0
  let current = { ...ordered[0] }
  for (const interval of ordered.slice(1)) {
    if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end)
    } else {
      total += current.end - current.start
      current = { ...interval }
    }
  }
  return total + current.end - current.start
}

function hasRecordedVolume(event: CareEvent): boolean {
  return typeof event.details.amount_ml === 'number' && Number.isFinite(event.details.amount_ml)
}

function sumVolume(events: CareEvent[]): number {
  return events.reduce((total, event) => total + (event.details.amount_ml ?? 0), 0)
}

function medianInterval(events: CareEvent[]): number | null {
  if (events.length < 2) return null
  const times = events.map((event) => new Date(event.occurred_at).getTime()).sort((left, right) => left - right)
  const gaps = times.slice(1).map((time, index) => Math.round((time - times[index]) / 60_000)).sort((left, right) => left - right)
  const middle = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[middle] : Math.round((gaps[middle - 1] + gaps[middle]) / 2)
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function minutes(milliseconds: number): number {
  return Math.max(0, Math.round(milliseconds / 60_000))
}

function timestamp(value: string): number | null {
  const result = new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

function dateKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}

function zonedDateTime(value: string, hour: number, timezone: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  const targetAsUtc = Date.UTC(year, month - 1, day, hour)
  let guess = targetAsUtc
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const actual = zonedParts(new Date(guess), timezone)
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const adjustment = targetAsUtc - actualAsUtc
    guess += adjustment
    if (adjustment === 0) break
  }
  return new Date(guess)
}
