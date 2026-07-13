import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayDateKey } from '../lib/insights'
import InsightsScreen from './InsightsScreen.svelte'

vi.mock('../lib/api', () => ({
  downloadInsightsReport: vi.fn(),
}))

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
})

function render(online = true, historyStartDate = '2025-01-01') {
  mounted = mount(InsightsScreen, {
    target: document.body,
    props: {
      events: [],
      interruptions: [],
      summaries: [],
      timezone: 'America/Chicago',
      online,
      pendingCount: 0,
      historyStartDate,
      onSyncPending: async () => 0,
    },
  })
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
