import { mount, tick, unmount, type SvelteComponent } from 'svelte'
import { createClassComponent } from 'svelte/legacy'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LogScreen from './LogScreen.svelte'
import type { CareEvent, EventType, ParentProfile } from '../lib/types'

let mounted: ReturnType<typeof mount> | undefined
let reactiveMounted: SvelteComponent | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  reactiveMounted?.$destroy()
  mounted = undefined
  reactiveMounted = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
})

const profile: ParentProfile = {
  user_id: 'parent-1',
  display_name: 'Adam',
  parent_type: 'father',
  show_pump_action: true,
  volume_unit: 'ml',
  created_at: '2026-07-13T12:00:00Z',
  updated_at: '2026-07-13T12:00:00Z',
}

function render(events: CareEvent[] = [], onLog = vi.fn()) {
  mounted = mount(LogScreen, {
    target: document.body,
    props: logScreenProps(events, onLog),
  })
}

function renderReactive(events: CareEvent[]) {
  reactiveMounted = createClassComponent({
    component: LogScreen,
    target: document.body,
    props: logScreenProps(events),
  })
}

function logScreenProps(events: CareEvent[], onLog = vi.fn()) {
  return {
    child: { id: 'child-1', household_id: 'household-1', nickname: 'Abel', birth_date: null, active: true, created_at: '2026-07-13T12:00:00Z' },
    timezone: 'America/Chicago',
    profile,
    members: [],
    events,
    interruptions: [],
    online: true,
    onLog,
    onSession: () => undefined,
    onInterruption: () => undefined,
    onEdit: () => undefined,
  }
}

function careEvent(id: string, eventType: EventType, occurredAt: string, overrides: Partial<CareEvent> = {}): CareEvent {
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
    details: {},
    recorded_at: occurredAt,
    updated_at: occurredAt,
    deleted_at: null,
    ...overrides,
  }
}

describe('Log actions', () => {
  it('keeps Hiccups in the seventh shared position before Pump', () => {
    const onLog = vi.fn()
    render([], onLog)
    const actions = [...document.querySelectorAll<HTMLButtonElement>('.action-grid .action-button')]
    expect(actions.map((button) => button.textContent?.trim().replace(/^[●◇+○—✓≈↕]\s*/, ''))).toEqual([
      'Poop', 'Pee', 'Feed', 'Burp', 'Sleep', 'Diaper check', 'Hiccups', 'Pump',
    ])
    actions[6]?.click()
    expect(onLog).toHaveBeenCalledWith('hiccups')
  })

  it('shows compact Poop observations in Recent', () => {
    const event = careEvent('poop-1', 'poop', '2026-07-13T12:00:00Z', {
      details: { size: 'medium', consistency: 'liquid', color: 'mustard_yellow' },
    })
    render([event])
    expect(document.querySelector('.recent-section')?.textContent).toContain('Medium · Liquid · Mustard')
  })

  it('dismisses the reminder when either parent records a Burp after the latest Feed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T22:00:00.000Z'))
    const feed = careEvent('feed-1', 'feed', '2026-07-13T21:40:00.000Z')
    const oldBurp = careEvent('old-burp', 'burp', '2026-07-13T21:30:00.000Z')
    const deletedNewBurp = careEvent('deleted-burp', 'burp', '2026-07-13T21:50:00.000Z', {
      created_by: 'parent-2',
      deleted_at: '2026-07-13T21:55:00.000Z',
    })
    renderReactive([deletedNewBurp, feed, oldBurp])

    expect(document.querySelector('.burp-reminder')?.textContent).toContain('No burp yet')

    const sharedBurp = careEvent('shared-burp', 'burp', '2026-07-13T22:00:00.000Z', { created_by: 'parent-2' })
    reactiveMounted?.$set({ events: [sharedBurp, deletedNewBurp, feed, oldBurp] })
    await tick()

    expect(document.querySelector('.burp-reminder')).toBeNull()

    reactiveMounted?.$set({
      events: [{ ...sharedBurp, deleted_at: '2026-07-13T22:01:00.000Z' }, deletedNewBurp, feed, oldBurp],
    })
    await tick()

    expect(document.querySelector('.burp-reminder')?.textContent).toContain('No burp yet')
  })

  it('refreshes Quick update when a newer shared event arrives', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T22:00:00.000Z'))
    const olderFeed = careEvent('feed-1', 'feed', '2026-07-13T21:40:00.000Z')
    renderReactive([olderFeed])

    expect(document.querySelector('.since-last-grid div:last-child dd')?.textContent).toBe('20m ago')

    const currentFeed = careEvent('feed-2', 'feed', '2026-07-13T22:00:00.000Z', { created_by: 'parent-2' })
    reactiveMounted?.$set({ events: [currentFeed, olderFeed] })
    await tick()

    expect(document.querySelector('.since-last-grid div:last-child dd')?.textContent).toBe('Just now')
    expect(document.querySelector('.burp-reminder')).toBeNull()
  })
})
