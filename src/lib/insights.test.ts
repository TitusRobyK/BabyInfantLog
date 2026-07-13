import { describe, expect, it } from 'vitest'
import { buildActionInsight, clampPeriodAnchor, movePeriodAnchor, periodFor } from './insights'
import type { CareEvent, SleepInterruption } from './types'

function event(overrides: Partial<CareEvent>): CareEvent {
  return {
    id: 'event-1',
    household_id: 'household-1',
    child_id: 'child-1',
    created_by: 'parent-1',
    subject_parent_id: null,
    event_type: 'poop',
    occurred_at: '2026-07-13T12:00:00.000Z',
    ended_at: null,
    client_timezone_offset_minutes: 0,
    details: {},
    recorded_at: '2026-07-13T12:00:00.000Z',
    updated_at: '2026-07-13T12:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}

describe('Insights calendar periods', () => {
  it('uses Monday through Sunday and moves complete periods', () => {
    const week = periodFor('week', '2026-07-16', 'America/Chicago', new Date('2026-07-20T12:00:00Z'))
    expect(week.startKey).toBe('2026-07-13')
    expect(week.endKeyExclusive).toBe('2026-07-20')
    expect(week.label).toBe('Jul 13–19, 2026')
    expect(week.dateKeys).toHaveLength(7)
    expect(movePeriodAnchor('week', week.anchorDate, -1)).toBe('2026-07-06')

    const month = periodFor('month', '2026-07-16', 'America/Chicago', new Date('2026-08-02T12:00:00Z'))
    expect(month.startKey).toBe('2026-07-01')
    expect(month.endKeyExclusive).toBe('2026-08-01')
    expect(month.label).toBe('July 2026')
    expect(month.dateKeys).toHaveLength(31)
  })

  it('respects 23-hour and 25-hour Chicago daylight-saving days', () => {
    const spring = periodFor('day', '2026-03-08', 'America/Chicago', new Date('2026-03-10T00:00:00Z'))
    const fall = periodFor('day', '2026-11-01', 'America/Chicago', new Date('2026-11-03T00:00:00Z'))
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23)
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25)
  })

  it('moves range changes to the first fully loaded period at the history boundary', () => {
    expect(clampPeriodAnchor('day', '2025-06-08', '2025-06-08')).toBe('2025-06-08')
    expect(clampPeriodAnchor('week', '2025-06-08', '2025-06-08')).toBe('2025-06-09')
    expect(clampPeriodAnchor('month', '2025-06-08', '2025-06-08')).toBe('2025-07-01')
  })
})

describe('Insights aggregation', () => {
  it('clips cross-midnight sleep and subtracts interruptions', () => {
    const period = periodFor('day', '2026-07-13', 'America/Chicago', new Date('2026-07-15T00:00:00Z'))
    const sleep = event({
      id: 'sleep-1',
      event_type: 'sleep',
      occurred_at: '2026-07-13T04:00:00.000Z',
      ended_at: '2026-07-13T08:00:00.000Z',
    })
    const interruptions = [{
      id: 'interruption-1',
      household_id: 'household-1',
      child_id: 'child-1',
      sleep_event_id: 'sleep-1',
      started_at: '2026-07-13T06:30:00.000Z',
      ended_at: '2026-07-13T06:45:00.000Z',
      created_by: 'parent-1',
      ended_by: 'parent-1',
      recorded_at: '2026-07-13T06:30:00.000Z',
      updated_at: '2026-07-13T06:45:00.000Z',
      deleted_at: null,
    }] as SleepInterruption[]

    const insight = buildActionInsight('sleep', [sleep], interruptions, period, 'America/Chicago')
    expect(insight.count).toBe(0)
    expect(insight.minutes).toBe(165)
    expect(insight.longestMinutes).toBe(165)
    expect(insight.interruptions).toBe(1)
  })

  it('materializes empty dates and tracks missing feed amounts', () => {
    const period = periodFor('week', '2026-07-13', 'America/Chicago', new Date('2026-07-21T00:00:00Z'))
    const feeds = [
      event({ id: 'feed-1', event_type: 'feed', occurred_at: '2026-07-13T12:00:00Z', details: { amount_ml: 75 } }),
      event({ id: 'feed-2', event_type: 'feed', occurred_at: '2026-07-14T12:00:00Z', details: {} }),
    ]
    const insight = buildActionInsight('feed', feeds, [], period, 'America/Chicago')
    expect(insight.days).toHaveLength(7)
    expect(insight.count).toBe(2)
    expect(insight.volumeMl).toBe(75)
    expect(insight.missingVolume).toBe(1)
    expect(insight.medianIntervalMinutes).toBe(1440)
    expect(insight.days.filter((day) => day.count === 0)).toHaveLength(5)
  })

  it('keeps daily Pump volume and clips an open session to the current time', () => {
    const now = new Date('2026-07-13T18:00:00Z')
    const period = periodFor('day', '2026-07-13', 'America/Chicago', now)
    const pump = event({
      id: 'pump-1',
      event_type: 'pump',
      subject_parent_id: 'parent-1',
      occurred_at: '2026-07-13T17:30:00Z',
      ended_at: null,
      details: { amount_ml: 55 },
    })
    const insight = buildActionInsight('pump', [pump], [], period, 'America/Chicago')
    expect(insight.minutes).toBe(30)
    expect(insight.longestMinutes).toBe(30)
    expect(insight.volumeMl).toBe(55)
    expect(insight.days[0]?.volumeMl).toBe(55)
  })
})
