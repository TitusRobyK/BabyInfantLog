import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import HistoryScreen from './HistoryScreen.svelte'
import type { ParentProfile } from '../lib/types'

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
})
