import { describe, expect, it, vi } from 'vitest'
import {
  createSliderHaptics,
  SLIDER_HAPTIC_BOUNDARY_MS,
  SLIDER_HAPTIC_REGULAR_MS,
  sliderHapticForTransition,
} from './sliderHaptics'

describe('slider haptic transitions', () => {
  it('uses boundary feedback when leaving or returning to Not recorded', () => {
    expect(sliderHapticForTransition(0, 1, 'ml', 350)).toBe('boundary')
    expect(sliderHapticForTransition(1, 0, 'ml', 350)).toBe('boundary')
  })

  it('uses one regular result when crossing one or several unit milestones', () => {
    expect(sliderHapticForTransition(9, 10, 'ml', 350)).toBe('regular')
    expect(sliderHapticForTransition(11, 49, 'ml', 350)).toBe('regular')
    expect(sliderHapticForTransition(0.4, 0.5, 'fl_oz', 11.8)).toBe('regular')
    expect(sliderHapticForTransition(0.6, 2.4, 'fl_oz', 11.8)).toBe('regular')
  })

  it('does not repeat feedback while the value stays in one milestone bucket', () => {
    expect(sliderHapticForTransition(11, 19, 'ml', 350)).toBeNull()
    expect(sliderHapticForTransition(0.6, 0.9, 'fl_oz', 11.8)).toBeNull()
    expect(sliderHapticForTransition(10, 10, 'ml', 350)).toBeNull()
  })

  it('gives the actual upper endpoint boundary priority, including an extended editor', () => {
    expect(sliderHapticForTransition(340, 350, 'ml', 350)).toBe('boundary')
    expect(sliderHapticForTransition(80, 90, 'ml', 120)).toBe('regular')
    expect(sliderHapticForTransition(110, 120, 'ml', 120)).toBe('boundary')
    expect(sliderHapticForTransition(0, 350, 'ml', 350)).toBe('boundary')
    expect(sliderHapticForTransition(350, 349, 'ml', 350)).toBe('regular')
  })
})

describe('slider haptic controller', () => {
  it('emits light milestone and firmer boundary durations for trusted input', () => {
    const vibrate = vi.fn(() => true)
    let time = 0
    const haptics = createSliderHaptics({
      initialValue: 0,
      isEnabled: () => true,
      isVisible: () => true,
      vibrate,
      now: () => time,
    })

    haptics.handleInput({ value: 1, unit: 'ml', max: 350, userTriggered: true })
    time = 100
    haptics.handleInput({ value: 10, unit: 'ml', max: 350, userTriggered: true })
    time = 200
    haptics.handleInput({ value: 350, unit: 'ml', max: 350, userTriggered: true })

    expect(vibrate.mock.calls).toEqual([
      [SLIDER_HAPTIC_BOUNDARY_MS],
      [SLIDER_HAPTIC_REGULAR_MS],
      [SLIDER_HAPTIC_BOUNDARY_MS],
    ])
  })

  it('syncs untrusted and initial values without vibrating', () => {
    const vibrate = vi.fn(() => true)
    const haptics = createSliderHaptics({
      isEnabled: () => true,
      isVisible: () => true,
      vibrate,
      now: () => 100,
    })

    haptics.handleInput({ value: 0, unit: 'ml', max: 350, userTriggered: false })
    haptics.handleInput({ value: 10, unit: 'ml', max: 350, userTriggered: false })
    expect(vibrate).not.toHaveBeenCalled()

    haptics.handleInput({ value: 20, unit: 'ml', max: 350, userTriggered: true })
    expect(vibrate).toHaveBeenCalledWith(SLIDER_HAPTIC_REGULAR_MS)
  })

  it('drops throttled crossings without queuing a delayed pulse', () => {
    const vibrate = vi.fn(() => true)
    let time = 0
    const haptics = createSliderHaptics({
      initialValue: 0,
      isEnabled: () => true,
      isVisible: () => true,
      vibrate,
      now: () => time,
    })

    haptics.handleInput({ value: 1, unit: 'ml', max: 350, userTriggered: true })
    time = 20
    haptics.handleInput({ value: 10, unit: 'ml', max: 350, userTriggered: true })
    time = 100
    haptics.handleInput({ value: 20, unit: 'ml', max: 350, userTriggered: true })

    expect(vibrate.mock.calls).toEqual([[SLIDER_HAPTIC_BOUNDARY_MS], [SLIDER_HAPTIC_REGULAR_MS]])
  })

  it('guards disabled, hidden, and unsupported devices while keeping input state current', () => {
    const vibrate = vi.fn(() => true)
    let enabled = false
    let visible = true
    let time = 0
    const haptics = createSliderHaptics({
      initialValue: 0,
      isEnabled: () => enabled,
      isVisible: () => visible,
      vibrate,
      now: () => time,
    })

    haptics.handleInput({ value: 10, unit: 'ml', max: 350, userTriggered: true })
    enabled = true
    visible = false
    time = 100
    haptics.handleInput({ value: 20, unit: 'ml', max: 350, userTriggered: true })
    visible = true
    time = 200
    haptics.handleInput({ value: 30, unit: 'ml', max: 350, userTriggered: true })
    expect(vibrate).toHaveBeenCalledOnce()

    const unsupported = createSliderHaptics({ initialValue: 0, isEnabled: () => true })
    expect(() => unsupported.handleInput({ value: 10, unit: 'ml', max: 350, userTriggered: true })).not.toThrow()
  })

  it('ignores false returns and exceptions and still applies throttling', () => {
    let time = 0
    const vibrate = vi.fn()
      .mockReturnValueOnce(false)
      .mockImplementationOnce(() => { throw new Error('blocked') })
    const haptics = createSliderHaptics({
      initialValue: 0,
      isEnabled: () => true,
      isVisible: () => true,
      vibrate,
      now: () => time,
    })

    expect(() => haptics.handleInput({ value: 1, unit: 'ml', max: 350, userTriggered: true })).not.toThrow()
    time = 20
    haptics.handleInput({ value: 10, unit: 'ml', max: 350, userTriggered: true })
    time = 100
    expect(() => haptics.handleInput({ value: 20, unit: 'ml', max: 350, userTriggered: true })).not.toThrow()
    expect(vibrate).toHaveBeenCalledTimes(2)
  })

  it('can reset silently or cancel active vibration before starting a fresh gesture', () => {
    const vibrate = vi.fn(() => true)
    const haptics = createSliderHaptics({
      initialValue: 0,
      isEnabled: () => true,
      isVisible: () => true,
      vibrate,
      now: () => 0,
    })

    haptics.reset(9)
    expect(vibrate).not.toHaveBeenCalled()
    haptics.handleInput({ value: 10, unit: 'ml', max: 350, userTriggered: true })
    haptics.cancel(0)
    haptics.handleInput({ value: 1, unit: 'ml', max: 350, userTriggered: true })

    expect(vibrate.mock.calls).toEqual([
      [SLIDER_HAPTIC_REGULAR_MS],
      [0],
      [SLIDER_HAPTIC_BOUNDARY_MS],
    ])
  })
})
