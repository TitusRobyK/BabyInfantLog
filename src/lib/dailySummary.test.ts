import { describe, expect, it } from 'vitest'
import { briefWindow } from '../../netlify/functions/daily-summary.mts'

describe('daily brief scheduling window', () => {
  it('recovers the most recent 8 PM brief after the original hour has passed', () => {
    const morningRetry = briefWindow(new Date('2026-07-13T14:15:00Z'), 'America/Chicago')
    expect(morningRetry.end.toISOString()).toBe('2026-07-13T01:00:00.000Z')

    const eveningRun = briefWindow(new Date('2026-07-14T02:15:00Z'), 'America/Chicago')
    expect(eveningRun.end.toISOString()).toBe('2026-07-14T01:00:00.000Z')
    expect(briefWindow(new Date('2026-07-14T02:15:00Z'), 'America/Chicago', 1).end.toISOString())
      .toBe('2026-07-13T01:00:00.000Z')
  })

  it('uses local 8 PM boundaries across daylight-saving changes', () => {
    const spring = briefWindow(new Date('2026-03-09T02:15:00Z'), 'America/Chicago')
    const fall = briefWindow(new Date('2026-11-02T03:15:00Z'), 'America/Chicago')
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23)
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25)
  })
})
