import { describe, expect, it } from 'vitest'
import { buildLiveBrief, latestBriefWindow } from './liveBrief'
import type { CareEvent, SleepInterruption } from './types'

function event(overrides: Partial<CareEvent>): CareEvent {
  return {
    id: 'event-1',
    household_id: 'household-1',
    child_id: 'child-1',
    created_by: 'parent-a',
    subject_parent_id: null,
    event_type: 'poop',
    occurred_at: '2026-07-13T21:00:00.000Z',
    ended_at: null,
    client_timezone_offset_minutes: 0,
    details: {},
    recorded_at: '2026-07-13T21:00:00.000Z',
    updated_at: '2026-07-13T21:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}

function interruption(overrides: Partial<SleepInterruption>): SleepInterruption {
  return {
    id: 'interruption-1',
    household_id: 'household-1',
    child_id: 'child-1',
    sleep_event_id: 'sleep-1',
    started_at: '2026-07-13T21:00:00.000Z',
    ended_at: null,
    created_by: 'parent-a',
    ended_by: null,
    recorded_at: '2026-07-13T21:00:00.000Z',
    updated_at: '2026-07-13T21:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}

describe('latestBriefWindow', () => {
  it('uses the most recent household-local 8 PM and clear timeframe copy', () => {
    const beforeEight = latestBriefWindow(new Date('2026-07-13T22:46:00.000Z'), 'America/Chicago')
    expect(beforeEight.start.toISOString()).toBe('2026-07-13T01:00:00.000Z')
    expect(beforeEight.dayReference).toBe('yesterday')
    expect(beforeEight.timeframeLabel).toBe('Since 8 PM yesterday · updated through 5:46 PM')

    const afterEight = latestBriefWindow(new Date('2026-07-14T01:18:00.000Z'), 'America/Chicago')
    expect(afterEight.start.toISOString()).toBe('2026-07-14T01:00:00.000Z')
    expect(afterEight.dayReference).toBe('today')
    expect(afterEight.timeframeLabel).toBe('Since 8 PM today · updated through 8:18 PM')
  })

  it('resolves 8 PM correctly across both daylight-saving transitions', () => {
    const spring = latestBriefWindow(new Date('2026-03-09T00:00:00.000Z'), 'America/Chicago')
    expect(spring.start.toISOString()).toBe('2026-03-08T02:00:00.000Z')

    const fall = latestBriefWindow(new Date('2026-11-02T01:00:00.000Z'), 'America/Chicago')
    expect(fall.start.toISOString()).toBe('2026-11-01T01:00:00.000Z')
  })
})

describe('buildLiveBrief', () => {
  it('combines entries recorded by either parent and omits zero-only categories', () => {
    const brief = buildLiveBrief([
      event({ id: 'feed-1', event_type: 'feed', created_by: 'parent-a', occurred_at: '2026-07-13T20:15:00.000Z', details: { amount_ml: 70 } }),
      event({ id: 'feed-2', event_type: 'feed', created_by: 'parent-b', occurred_at: '2026-07-13T21:45:00.000Z' }),
      event({ id: 'pee-1', event_type: 'pee', created_by: 'parent-b', occurred_at: '2026-07-13T21:00:00.000Z' }),
      event({ id: 'burp-1', event_type: 'burp', created_by: 'parent-a', occurred_at: '2026-07-13T21:50:00.000Z' }),
      event({ id: 'deleted-poop', event_type: 'poop', occurred_at: '2026-07-13T21:20:00.000Z', deleted_at: '2026-07-13T21:30:00.000Z' }),
    ], [], 'UTC', new Date('2026-07-13T22:00:00.000Z'))

    expect(brief.metrics.feed).toMatchObject({
      sessions: 2,
      medianIntervalMinutes: 90,
      volumeMl: 70,
      sessionsWithVolume: 1,
      sessionsWithoutVolume: 1,
    })
    expect(brief.metrics.counts).toMatchObject({ feed: 2, pee: 1, poop: 0, burp: 1, diaper_check: 0, hiccups: 0 })
    expect(brief.lines).toEqual([
      '2 feeds · typical gap 1h 30m · 70 ml recorded · 1 feed without an amount',
      '1 pee',
      '1 burp',
    ])
    expect(brief.lines.join(' ')).not.toContain('poop')
    expect(brief.empty).toBe(false)
  })

  it('clips cross-boundary and ongoing sessions and their interruptions to now', () => {
    const brief = buildLiveBrief([
      event({ id: 'sleep-1', event_type: 'sleep', occurred_at: '2026-07-13T19:30:00.000Z', ended_at: null }),
      event({ id: 'pump-before', event_type: 'pump', occurred_at: '2026-07-13T19:30:00.000Z', ended_at: '2026-07-13T20:10:00.000Z', details: { amount_ml: 80 } }),
      event({ id: 'pump-current', event_type: 'pump', occurred_at: '2026-07-13T21:00:00.000Z', ended_at: null }),
    ], [
      interruption({ id: 'wake-before', started_at: '2026-07-13T19:45:00.000Z', ended_at: '2026-07-13T20:15:00.000Z' }),
      interruption({ id: 'wake-open', started_at: '2026-07-13T21:15:00.000Z', ended_at: null, created_by: 'parent-b' }),
    ], 'UTC', new Date('2026-07-13T22:00:00.000Z'))

    expect(brief.metrics.sleep).toEqual({
      sessions: 1,
      ongoingSessions: 1,
      totalMinutes: 60,
      longestMinutes: 60,
      interruptions: 2,
      interruptionMinutes: 60,
    })
    expect(brief.metrics.pump).toEqual({
      sessions: 2,
      ongoingSessions: 1,
      totalMinutes: 70,
      volumeMl: 80,
      sessionsWithVolume: 1,
      sessionsWithoutVolume: 0,
    })
    expect(brief.lines).toContain('1h sleep across 1 session · 1 session ongoing · 2 interruptions')
    expect(brief.lines).toContain('2 pump sessions · 1h 10m total · 1 session ongoing · 80 ml recorded')
    expect(brief.lines.join(' ')).not.toContain('without an amount')
  })

  it('describes a fully interrupted open sleep as ongoing rather than newly started', () => {
    const brief = buildLiveBrief([
      event({ id: 'sleep-1', event_type: 'sleep', occurred_at: '2026-07-13T20:00:00.000Z', ended_at: null }),
    ], [
      interruption({ id: 'wake-open', started_at: '2026-07-13T20:00:00.000Z', ended_at: null }),
    ], 'UTC', new Date('2026-07-13T22:00:00.000Z'))

    expect(brief.metrics.sleep.totalMinutes).toBe(0)
    expect(brief.lines).toEqual(['1 sleep session ongoing · 1 interruption'])
  })

  it('exposes a helpful empty state instead of a list of zeroes', () => {
    const brief = buildLiveBrief([], [], 'America/Chicago', new Date('2026-07-13T22:46:00.000Z'))
    expect(brief.title).toBe('Latest brief')
    expect(brief.empty).toBe(true)
    expect(brief.lines).toEqual([])
    expect(brief.emptyMessage).toBe('No entries since 8 PM yesterday. The brief will update as care is logged.')
  })
})
