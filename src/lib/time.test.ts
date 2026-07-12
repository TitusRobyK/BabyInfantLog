import { describe, expect, it } from 'vitest'
import { durationMinutes, formatDuration, formatElapsed, isOpenSession, localDateKey, netSleepMinutes, timeOfDayPercent } from './time'
import type { CareEvent, SleepInterruption } from './types'

describe('time helpers', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(42)).toBe('42m')
    expect(formatDuration(125)).toBe('2h 5m')
  })

  it('formats time since a shared event', () => {
    const now = new Date('2026-07-11T12:00:00Z').getTime()
    expect(formatElapsed('2026-07-11T11:58:30Z', now)).toBe('1m ago')
    expect(formatElapsed('2026-07-11T09:45:00Z', now)).toBe('2h 15m ago')
    expect(formatElapsed('2026-07-10T08:00:00Z', now)).toBe('1d 4h ago')
  })

  it('uses the requested household timezone for date keys', () => {
    expect(localDateKey('2026-07-12T01:00:00Z', 'America/Chicago')).toBe('2026-07-11')
    expect(timeOfDayPercent('2026-07-11T17:00:00Z', 'America/Chicago')).toBe(50)
  })

  it('recognizes open sessions', () => {
    const event = { event_type: 'sleep', ended_at: null, deleted_at: null } as CareEvent
    expect(isOpenSession(event, 'sleep')).toBe(true)
    expect(durationMinutes('2026-07-11T10:00:00Z', '2026-07-11T11:30:00Z')).toBe(90)
  })

  it('subtracts interruptions from sleep duration', () => {
    const event = {
      id: 'sleep-1',
      occurred_at: '2026-07-11T10:00:00Z',
      ended_at: '2026-07-11T12:00:00Z',
    } as CareEvent
    const interruptions = [
      {
        sleep_event_id: 'sleep-1',
        started_at: '2026-07-11T10:30:00Z',
        ended_at: '2026-07-11T10:45:00Z',
        deleted_at: null,
      },
    ] as SleepInterruption[]
    expect(netSleepMinutes(event, interruptions)).toBe(105)
  })
})
