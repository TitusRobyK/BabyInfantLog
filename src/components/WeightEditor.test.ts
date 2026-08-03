import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WeightEditor from './WeightEditor.svelte'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('Weight editor', () => {
  it('defaults to today and saves a past lb + oz measurement', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T18:00:00.000Z'))
    const onSave = vi.fn(async () => undefined)
    mounted = mount(WeightEditor, {
      target: document.body,
      props: {
        timezone: 'America/Chicago',
        unit: 'lb_oz',
        onClose: () => undefined,
        onSave,
      },
    })

    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!
    const values = document.querySelectorAll<HTMLInputElement>('input[type="number"]')
    expect(date.value).toBe('2026-08-02')
    expect(date.max).toBe('2026-08-02')

    date.value = '2026-07-30'
    date.dispatchEvent(new Event('input', { bubbles: true }))
    values[0].value = '8'
    values[0].dispatchEvent(new Event('input', { bubbles: true }))
    values[1].value = '6.2'
    values[1].dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(document.querySelector('.weight-preview')?.textContent).toContain('8 lb 6.2 oz')
    document.querySelector<HTMLButtonElement>('button.primary')?.click()
    await tick()
    expect(onSave).toHaveBeenCalledWith('2026-07-30', 3805)
  })

  it('uses kg + g fields and rejects a future date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T18:00:00.000Z'))
    const onSave = vi.fn(async () => undefined)
    mounted = mount(WeightEditor, {
      target: document.body,
      props: {
        timezone: 'America/Chicago',
        unit: 'kg_g',
        onClose: () => undefined,
        onSave,
      },
    })
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!
    const values = document.querySelectorAll<HTMLInputElement>('input[type="number"]')
    values[0].value = '3'
    values[0].dispatchEvent(new Event('input', { bubbles: true }))
    values[1].value = '799'
    values[1].dispatchEvent(new Event('input', { bubbles: true }))
    date.value = '2026-08-03'
    date.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    document.querySelector<HTMLButtonElement>('button.primary')?.click()
    await tick()
    expect(onSave).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Choose today or an earlier date.')
  })
})
