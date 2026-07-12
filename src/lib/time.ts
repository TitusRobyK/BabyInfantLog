import type { CareEvent, SleepInterruption } from './types'

export function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value))
}

export function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  }).format(new Date(value))
}

export function durationMinutes(start: string, end = new Date().toISOString()): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000))
}

export function sleepInterruptionMinutes(
  event: CareEvent,
  interruptions: SleepInterruption[],
  rangeStart = event.occurred_at,
  rangeEnd = event.ended_at ?? new Date().toISOString(),
): number {
  const eventStart = Math.max(new Date(event.occurred_at).getTime(), new Date(rangeStart).getTime())
  const eventEnd = Math.min(
    new Date(event.ended_at ?? rangeEnd).getTime(),
    new Date(rangeEnd).getTime(),
  )
  if (eventEnd <= eventStart) return 0

  return interruptions
    .filter((interruption) => interruption.sleep_event_id === event.id && !interruption.deleted_at)
    .reduce((total, interruption) => {
      const start = Math.max(eventStart, new Date(interruption.started_at).getTime())
      const end = Math.min(eventEnd, new Date(interruption.ended_at ?? rangeEnd).getTime())
      return total + Math.max(0, Math.round((end - start) / 60_000))
    }, 0)
}

export function netSleepMinutes(
  event: CareEvent,
  interruptions: SleepInterruption[],
  rangeStart = event.occurred_at,
  rangeEnd = event.ended_at ?? new Date().toISOString(),
): number {
  const start = Math.max(new Date(event.occurred_at).getTime(), new Date(rangeStart).getTime())
  const end = Math.min(new Date(event.ended_at ?? rangeEnd).getTime(), new Date(rangeEnd).getTime())
  const gross = Math.max(0, Math.round((end - start) / 60_000))
  return Math.max(0, gross - sleepInterruptionMinutes(event, interruptions, rangeStart, rangeEnd))
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function formatElapsed(value: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours ? `${days}d ${remainingHours}h ago` : `${days}d ago`
}

export function localDateKey(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function timeOfDayPercent(value: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const seconds = get('hour') * 3600 + get('minute') * 60 + get('second')
  return (seconds / 86_400) * 100
}

export function isOpenSession(event: CareEvent, type: 'sleep' | 'pump', subjectId?: string): boolean {
  return (
    event.event_type === type &&
    !event.ended_at &&
    !event.deleted_at &&
    (type === 'sleep' || !subjectId || event.subject_parent_id === subjectId)
  )
}

export function startOfRange(range: 'day' | 'week' | 'month', now = new Date()): Date {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (range === 'week') {
    const day = start.getDay() || 7
    start.setDate(start.getDate() - day + 1)
  }
  if (range === 'month') start.setDate(1)
  return start
}
