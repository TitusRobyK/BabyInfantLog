import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsScreen from './SettingsScreen.svelte'
import type { AppContext } from '../lib/types'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
})

function settingsContext(): AppContext {
  return {
    profile: {
      user_id: 'parent-1',
      display_name: 'Parent',
      parent_type: 'mother',
      show_pump_action: true,
      volume_unit: 'ml',
      volume_slider_max_ml: 350,
      weight_unit: 'lb_oz',
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
}

describe('Settings volume preference', () => {
  it('presents global volume and weight preferences with one shared maximum', async () => {
    const context = settingsContext()

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

    const savePreferences = document.querySelector<HTMLButtonElement>('button.settings-save')
    expect(savePreferences?.disabled).toBe(true)
    expect(document.querySelector('.setting-toggle-with-help')).toBeNull()

    const maximum = document.querySelector<HTMLInputElement>('#volume-slider-maximum')
    expect(maximum?.min).toBe('30')
    expect(maximum?.max).toBe('600')
    expect(maximum?.step).toBe('10')
    expect(maximum?.value).toBe('350')

    const helpButton = document.querySelector<HTMLButtonElement>('.help-tooltip-trigger')
    expect(helpButton?.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.settings-amount-field > .hint')).toBeNull()
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Used for both Feed and Pump. Existing entries won’t change.')
    helpButton?.click()
    await tick()
    expect(helpButton?.getAttribute('aria-expanded')).toBe('true')

    options[1]?.click()
    await tick()
    expect(document.querySelector<HTMLOutputElement>('output[for="volume-slider-maximum"]')?.textContent).toBe('11.8 fl oz')
    expect(savePreferences?.disabled).toBe(false)

    options[0]?.click()
    await tick()
    expect(savePreferences?.disabled).toBe(true)

    if (maximum) {
      maximum.value = '90'
      maximum.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await tick()
    expect(savePreferences?.disabled).toBe(false)

    const weightOptions = document.querySelectorAll<HTMLInputElement>('input[name="preferred-weight-unit"]')
    expect([...weightOptions].map((option) => option.value)).toEqual(['lb_oz', 'kg_g'])
    expect(weightOptions[0]?.checked).toBe(true)
  })

  it('shows and saves the device vibration preference only when supported', async () => {
    const onAmountSliderVibrationUpdated = vi.fn(() => true)
    const onUpdated = vi.fn(async () => undefined)
    mounted = mount(SettingsScreen, {
      target: document.body,
      props: {
        context: settingsContext(),
        pendingCount: 0,
        amountSliderVibrationSupported: true,
        amountSliderVibrationEnabled: false,
        onAmountSliderVibrationUpdated,
        onUpdated,
        onSignOut: async () => undefined,
      },
    })

    const vibration = document.querySelector<HTMLInputElement>('.setting-toggle-with-help input[type="checkbox"]')
    const save = document.querySelector<HTMLButtonElement>('button.settings-save')
    expect(vibration?.checked).toBe(false)
    expect(save?.disabled).toBe(true)

    vibration?.click()
    await tick()
    expect(save?.disabled).toBe(false)

    vibration?.click()
    await tick()
    expect(save?.disabled).toBe(true)

    vibration?.click()
    await tick()
    expect(save?.disabled).toBe(false)

    save?.click()
    await vi.waitFor(() => expect(onAmountSliderVibrationUpdated).toHaveBeenCalledWith(true))
    expect(onUpdated).not.toHaveBeenCalled()
    expect(save?.disabled).toBe(true)
  })
})
