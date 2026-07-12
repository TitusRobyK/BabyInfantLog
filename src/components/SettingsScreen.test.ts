import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsScreen from './SettingsScreen.svelte'
import type { AppContext } from '../lib/types'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
})

describe('Settings volume preference', () => {
  it('presents milliliters and fluid ounces as an accessible radio choice', () => {
    const context: AppContext = {
      profile: {
        user_id: 'parent-1',
        display_name: 'Parent',
        parent_type: 'mother',
        show_pump_action: true,
        volume_unit: 'ml',
        created_at: '2026-07-12T12:00:00.000Z',
        updated_at: '2026-07-12T12:00:00.000Z',
      },
      membership: { household_id: 'household-1', user_id: 'parent-1', role: 'parent', joined_at: '2026-07-12T12:00:00.000Z' },
      household: { id: 'household-1', name: 'Family', timezone: 'America/Chicago', created_at: '2026-07-12T12:00:00.000Z' },
      child: { id: 'child-1', household_id: 'household-1', nickname: 'Baby', birth_date: null, active: true, created_at: '2026-07-12T12:00:00.000Z' },
      members: [
        {
          household_id: 'household-1',
          user_id: 'parent-1',
          role: 'parent',
          joined_at: '2026-07-12T12:00:00.000Z',
          profile: undefined,
        },
      ],
    }

    mounted = mount(SettingsScreen, {
      target: document.body,
      props: {
        context,
        pendingCount: 0,
        onUpdated: async () => undefined,
        onSignOut: async () => undefined,
      },
    })

    const options = document.querySelectorAll<HTMLInputElement>('input[name="preferred-volume-unit"]')
    expect(options).toHaveLength(2)
    expect(options[0]?.value).toBe('ml')
    expect(options[0]?.checked).toBe(true)
    expect(options[1]?.value).toBe('fl_oz')
  })
})
