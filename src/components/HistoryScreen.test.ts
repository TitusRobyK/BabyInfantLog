import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import HistoryScreen from './HistoryScreen.svelte'
import { localDateKey } from '../lib/time'
import type { CareEvent, ParentProfile, WeightMeasurement } from '../lib/types'

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
      volume_slider_max_ml: 350,
      weight_unit: 'lb_oz',
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
      volume_slider_max_ml: 350,
      weight_unit: 'lb_oz',
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
    expect(document.querySelector<HTMLSelectElement>('.filter-label select')?.textContent).toContain('Weight')
    expect(document.querySelector('.history-list')?.textContent).toContain('Large · Solid · Brown')
  })

  it('shows Weight in a separate dated Measurements section', () => {
    const profile: ParentProfile = {
      user_id: 'parent-1', display_name: 'Parent', parent_type: 'parent_guardian', show_pump_action: false,
      volume_unit: 'ml', volume_slider_max_ml: 350, weight_unit: 'kg_g',
      created_at: '2026-08-02T12:00:00Z', updated_at: '2026-08-02T12:00:00Z',
    }
    const measuredOn = localDateKey(new Date().toISOString(), 'America/Chicago')
    const measurement: WeightMeasurement = {
      id: 'weight-1', household_id: 'household-1', child_id: 'child-1', measured_on: measuredOn,
      weight_grams: 3805, created_by: 'parent-1', recorded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), deleted_at: null,
    }
    mounted = mount(HistoryScreen, {
      target: document.body,
      props: {
        events: [], measurements: [measurement], interruptions: [], timezone: 'America/Chicago',
        profile, members: [], onEdit: () => undefined, onEditWeight: () => undefined,
      },
    })
    expect(document.querySelector('.history-measurements')?.textContent).toContain('3 kg 805 g')
    expect(document.body.textContent).not.toContain('No entries recorded for this day.')
  })
})
