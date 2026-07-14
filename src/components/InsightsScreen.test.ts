import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayDateKey } from '../lib/insights'
import type { CareEvent, EventDetails, EventType } from '../lib/types'
import InsightsScreen from './InsightsScreen.svelte'

vi.mock('../lib/api', () => ({
  downloadInsightsReport: vi.fn(),
}))

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function render(online = true, historyStartDate = '2025-01-01', events: CareEvent[] = []) {
  mounted = mount(InsightsScreen, {
    target: document.body,
    props: {
      events,
      interruptions: [],
      timezone: 'America/Chicago',
      online,
      pendingCount: 0,
      historyStartDate,
      onSyncPending: async () => 0,
    },
  })
}

function careEvent(id: string, eventType: EventType, occurredAt: string, details: EventDetails = {}): CareEvent {
  return {
    id,
    household_id: 'household-1',
    child_id: 'child-1',
    created_by: 'parent-1',
    subject_parent_id: null,
    event_type: eventType,
    occurred_at: occurredAt,
    ended_at: null,
    client_timezone_offset_minutes: 0,
    details,
    recorded_at: occurredAt,
    updated_at: occurredAt,
    deleted_at: null,
  }
}

describe('Insights screen', () => {
  it('opens with All Actions and all eight action cards', () => {
    render()
    const action = document.querySelector<HTMLSelectElement>('.insights-controls select')
    expect(document.querySelector('h1')?.textContent).toBe('Insights')
    expect(action?.value).toBe('all')
    expect(document.querySelectorAll('.insight-card')).toHaveLength(8)
    expect([...document.querySelectorAll('.insight-card h3')].map((heading) => heading.textContent)).toEqual([
      'Poop', 'Pee', 'Feed', 'Burp', 'Sleep', 'Diaper check', 'Hiccups', 'Pump',
    ])
  })

  it('shows one expanded weekly breakdown at a time', async () => {
    render()
    const week = [...document.querySelectorAll<HTMLButtonElement>('.segmented button')].find((button) => button.textContent === 'Week')
    week?.click()
    await tick()

    const toggles = document.querySelectorAll<HTMLButtonElement>('.breakdown-toggle')
    expect(toggles).toHaveLength(8)
    toggles[0]?.click()
    await tick()
    expect(document.querySelectorAll('.insight-card.expanded')).toHaveLength(1)
    expect(document.querySelector('.insight-card.expanded h3')?.textContent).toBe('Poop')
    expect(document.querySelectorAll('.insight-card.expanded .compact-breakdown li')).toHaveLength(7)

    toggles[1]?.click()
    await tick()
    expect(document.querySelectorAll('.insight-card.expanded')).toHaveLength(1)
    expect(document.querySelector('.insight-card.expanded h3')?.textContent).toBe('Pee')
  })

  it('navigates to a past period and returns to today', async () => {
    render()
    document.querySelector<HTMLButtonElement>('.previous-period')?.click()
    await tick()
    expect(document.querySelector<HTMLButtonElement>('.next-period')?.disabled).toBe(false)
    const today = [...document.querySelectorAll<HTMLButtonElement>('.period-label button')].find((button) => button.textContent === 'Today')
    expect(today).toBeTruthy()
    today?.click()
    await tick()
    expect(document.querySelector<HTMLButtonElement>('.next-period')?.disabled).toBe(true)
  })

  it('keeps the focal date when changing ranges', async () => {
    render()
    document.querySelector<HTMLButtonElement>('.previous-period')?.click()
    await tick()
    const focusedDay = document.querySelector('.period-label strong')?.textContent
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.segmented button')]
    buttons.find((button) => button.textContent === 'Month')?.click()
    await tick()
    buttons.find((button) => button.textContent === 'Day')?.click()
    await tick()
    expect(document.querySelector('.period-label strong')?.textContent).toBe(focusedDay)
  })

  it('returns from action details without losing the selected range or period', async () => {
    render()
    const week = [...document.querySelectorAll<HTMLButtonElement>('.segmented button')]
      .find((button) => button.textContent === 'Week')
    week?.click()
    await tick()
    document.querySelector<HTMLButtonElement>('.previous-period')?.click()
    await tick()

    const selectedPeriod = document.querySelector('.period-label strong')?.textContent
    const feedDetails = document.querySelector<HTMLButtonElement>('[data-insight-action="feed"] .view-insight-details')
    expect(feedDetails?.textContent).toContain('View feed details')
    feedDetails?.click()
    await tick()
    await Promise.resolve()

    expect(document.querySelector<HTMLSelectElement>('.insights-controls select')?.value).toBe('feed')
    expect(document.querySelector<HTMLButtonElement>('.back-to-all-actions')?.textContent).toContain('Back to all actions')
    expect(week?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.period-label strong')?.textContent).toBe(selectedPeriod)

    document.querySelector<HTMLButtonElement>('.back-to-all-actions')?.click()
    await tick()
    await Promise.resolve()

    const restoredFeedDetails = document.querySelector<HTMLButtonElement>('[data-insight-action="feed"] .view-insight-details')
    expect(document.querySelector<HTMLSelectElement>('.insights-controls select')?.value).toBe('all')
    expect(document.querySelectorAll('.insight-card')).toHaveLength(8)
    expect(week?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.period-label strong')?.textContent).toBe(selectedPeriod)
    expect(document.activeElement).toBe(restoredFeedDetails)
  })

  it('shows a helpful live-brief empty state from the latest 8 PM', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T22:46:00.000Z'))
    render()

    const brief = document.querySelector('.brief')
    expect(brief?.textContent).toContain('Latest brief')
    expect(brief?.textContent).toContain('Since 8 PM yesterday · updated through 5:46 PM')
    expect(brief?.textContent).toContain('No entries since 8 PM yesterday. The brief will update as care is logged.')
    expect(brief?.textContent).not.toContain('Latest 8 PM brief')
    expect(brief?.textContent).not.toContain('From one 8 PM to the next')
  })

  it('keeps the live brief independent of the action, range, and period filters', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T22:46:00.000Z'))
    render(true, '2025-01-01', [
      careEvent('feed-1', 'feed', '2026-07-13T14:00:00.000Z', { amount_ml: 70 }),
      careEvent('feed-2', 'feed', '2026-07-13T17:00:00.000Z'),
      careEvent('pee-1', 'pee', '2026-07-13T16:00:00.000Z'),
      careEvent('old-poop', 'poop', '2026-07-13T00:30:00.000Z'),
      careEvent('future-burp', 'burp', '2026-07-13T23:00:00.000Z'),
    ])

    const initialBrief = document.querySelector('.brief')?.textContent
    expect(initialBrief).toContain('2 feeds · typical gap 3h · 70 ml recorded · 1 feed without an amount')
    expect(initialBrief).toContain('1 pee')
    expect(initialBrief).not.toContain('poop')
    expect(initialBrief).not.toContain('burp')

    const month = [...document.querySelectorAll<HTMLButtonElement>('.segmented button')]
      .find((button) => button.textContent === 'Month')
    month?.click()
    await tick()
    document.querySelector<HTMLButtonElement>('.previous-period')?.click()
    await tick()
    document.querySelector<HTMLButtonElement>('[data-insight-action="feed"] .view-insight-details')?.click()
    await tick()
    await Promise.resolve()

    expect(document.querySelector('.brief')?.textContent).toBe(initialBrief)
  })

  it('stops before periods that were not loaded on the device', () => {
    render(true, todayDateKey('America/Chicago'))
    expect(document.querySelector<HTMLButtonElement>('.previous-period')?.disabled).toBe(true)
    expect(document.body.textContent).toContain('past 13 months')
  })

  it('explains why PDF download is unavailable offline', () => {
    render(false)
    const download = [...document.querySelectorAll<HTMLButtonElement>('.report-download > button')]
      .find((button) => button.textContent === 'Download PDF')
    expect(download?.disabled).toBe(true)
    expect(document.body.textContent).toContain('Connect to the internet to download a report.')
  })
})
