import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EventEditor from './EventEditor.svelte'
import type { CareEvent, EventDetails, EventType } from '../lib/types'

let mounted: ReturnType<typeof mount> | undefined
type SaveHandler = (event: CareEvent, occurredAt: string, details: EventDetails, endedAt?: string | null) => Promise<void>

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
})

function careEvent(eventType: EventType, details: EventDetails): CareEvent {
  return {
    id: `${eventType}-1`,
    household_id: 'household-1',
    child_id: 'child-1',
    created_by: 'parent-1',
    subject_parent_id: eventType === 'pump' ? 'parent-1' : null,
    event_type: eventType,
    occurred_at: '2026-07-12T12:00:00.000Z',
    ended_at: eventType === 'pump' ? '2026-07-12T12:20:00.000Z' : null,
    client_timezone_offset_minutes: 0,
    details,
    recorded_at: '2026-07-12T12:00:00.000Z',
    updated_at: '2026-07-12T12:00:00.000Z',
    deleted_at: null,
  }
}

function renderEditor(event: CareEvent, onSave: SaveHandler = async () => undefined) {
  mounted = mount(EventEditor, {
    target: document.body,
    props: {
      event,
      defaultUnit: 'ml',
      onClose: () => undefined,
      onSave,
      onRemove: async () => undefined,
    },
  })
}

describe('event amount sliders', () => {
  it('shows an optional 0 to 350 ml feed slider with one-milliliter steps', async () => {
    renderEditor(careEvent('feed', {}))

    const slider = document.querySelector<HTMLInputElement>('#feed-amount')
    const output = document.querySelector<HTMLOutputElement>('output[for="feed-amount"]')
    expect(slider?.min).toBe('0')
    expect(slider?.max).toBe('350')
    expect(slider?.step).toBe('1')
    expect(output?.textContent).toContain('Not recorded')

    if (!slider) throw new Error('Feed amount slider was not rendered')
    slider.value = '125'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(output?.textContent).toContain('125 ml')
  })

  it('converts the 60 ml pump limit and value when fluid ounces are selected', async () => {
    const pumpEvent = careEvent('pump', { amount: 60, amount_ml: 60, unit: 'ml' })
    const onSave = vi.fn<SaveHandler>(async () => undefined)
    renderEditor(pumpEvent, onSave)

    const unit = document.querySelector<HTMLInputElement>('input[name="pump-unit"][value="fl_oz"]')
    const slider = document.querySelector<HTMLInputElement>('#pump-amount')
    const output = document.querySelector<HTMLOutputElement>('output[for="pump-amount"]')
    const times = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')
    expect(slider?.max).toBe('60')
    expect(times).toHaveLength(2)
    expect(times[0]?.value).not.toBe('')
    expect(times[1]?.value).not.toBe('')

    if (!unit) throw new Error('Pump unit selector was not rendered')
    unit.click()
    await tick()

    expect(unit.checked).toBe(true)
    expect(slider?.max).toBe('2.03')
    expect(slider?.step).toBe('0.01')
    expect(slider?.value).toBe('2.03')
    expect(output?.textContent).toContain('2.03 fl oz')

    const save = document.querySelector<HTMLButtonElement>('button.primary')
    save?.click()
    await tick()

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0]?.[1]).toBe(pumpEvent.occurred_at)
    expect(onSave.mock.calls[0]?.[3]).toBe(pumpEvent.ended_at)
  })
})
