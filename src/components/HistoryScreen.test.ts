import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import HistoryScreen from './HistoryScreen.svelte'
import type { CareEvent, ParentProfile } from '../lib/types'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
})

describe('History date navigation', () => {
  it('uses labelled day controls and prevents moving beyond today', async () => {
    const profile: ParentProfile = {
      user_id: 'parent-1',
      display_name: 'Parent',
      parent_type: 'parent_guardian',
      show_pump_action: false,
      volume_unit: 'ml',
      created_at: '2026-07-12T12:00:00.000Z',
      updated_at: '2026-07-12T12:00:00.000Z',
    }
    mounted = mount(HistoryScreen, {
      target: document.body,
      props: {
        events: [],
        interruptions: [],
        timezone: 'America/Chicago',
        profile,
        members: [],
        onEdit: () => undefined,
      },
    })

    const previous = document.querySelector<HTMLButtonElement>('.previous-day')
    const next = document.querySelector<HTMLButtonElement>('.next-day')
    expect(previous?.textContent).toContain('Previous')
    expect(next?.textContent).toContain('Next')
    expect(next?.disabled).toBe(true)

    previous?.click()
    await tick()

    expect(next?.disabled).toBe(false)
  })

  it('offers Hiccups filtering and displays Poop observations', () => {
    const profile: ParentProfile = {
      user_id: 'parent-1',
      display_name: 'Parent',
      parent_type: 'parent_guardian',
      show_pump_action: false,
      volume_unit: 'ml',
      created_at: '2026-07-13T12:00:00.000Z',
      updated_at: '2026-07-13T12:00:00.000Z',
    }
    const now = new Date().toISOString()
    const event: CareEvent = {
      id: 'poop-1', household_id: 'household-1', child_id: 'child-1', created_by: 'parent-1', subject_parent_id: null,
      event_type: 'poop', occurred_at: now, ended_at: null, client_timezone_offset_minutes: 0,
      details: { size: 'large', consistency: 'formed', color: 'brown' }, recorded_at: now, updated_at: now, deleted_at: null,
    }
    mounted = mount(HistoryScreen, {
      target: document.body,
      props: { events: [event], interruptions: [], timezone: 'America/Chicago', profile, members: [], onEdit: () => undefined },
    })

    expect(document.querySelector<HTMLSelectElement>('.filter-label select')?.textContent).toContain('Hiccups')
    expect(document.querySelector('.history-list')?.textContent).toContain('Large · Formed · Brown')
  })
})
