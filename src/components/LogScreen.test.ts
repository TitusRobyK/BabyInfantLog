import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LogScreen from './LogScreen.svelte'
import type { CareEvent, ParentProfile } from '../lib/types'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
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
    props: {
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
    },
  })
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
    const event: CareEvent = {
      id: 'poop-1',
      household_id: 'household-1',
      child_id: 'child-1',
      created_by: 'parent-1',
      subject_parent_id: null,
      event_type: 'poop',
      occurred_at: '2026-07-13T12:00:00Z',
      ended_at: null,
      client_timezone_offset_minutes: 0,
      details: { size: 'medium', consistency: 'liquid', color: 'mustard_yellow' },
      recorded_at: '2026-07-13T12:00:00Z',
      updated_at: '2026-07-13T12:00:00Z',
      deleted_at: null,
    }
    render([event])
    expect(document.querySelector('.recent-section')?.textContent).toContain('Medium · Liquid · Mustard')
  })
})
