import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  amountSliderVibrationPreferenceKey,
  isAmountSliderVibrationSupported,
  readAmountSliderVibrationPreference,
  saveAmountSliderVibrationPreference,
} from './sliderVibrationPreference'

const originalVibrate = Object.getOwnPropertyDescriptor(navigator, 'vibrate')

beforeEach(() => localStorage.clear())

afterEach(() => {
  if (originalVibrate) Object.defineProperty(navigator, 'vibrate', originalVibrate)
  else Reflect.deleteProperty(navigator, 'vibrate')
})

describe('amount-slider vibration preference', () => {
  it('defaults to off and keeps the setting device-local for each user', () => {
    expect(readAmountSliderVibrationPreference('parent-a')).toBe(false)
    expect(saveAmountSliderVibrationPreference('parent-a', true)).toBe(true)

    expect(readAmountSliderVibrationPreference('parent-a')).toBe(true)
    expect(readAmountSliderVibrationPreference('parent-b')).toBe(false)
    expect(localStorage.getItem(amountSliderVibrationPreferenceKey('parent-a'))).toBe('true')

    expect(saveAmountSliderVibrationPreference('parent-a', false)).toBe(true)
    expect(readAmountSliderVibrationPreference('parent-a')).toBe(false)
  })

  it('falls back to off when storage is unavailable, invalid, or throws', () => {
    expect(readAmountSliderVibrationPreference('parent-a', null)).toBe(false)
    expect(saveAmountSliderVibrationPreference('parent-a', true, null)).toBe(false)

    localStorage.setItem(amountSliderVibrationPreferenceKey('parent-a'), 'unexpected')
    expect(readAmountSliderVibrationPreference('parent-a')).toBe(false)

    const failingStorage = {
      getItem: vi.fn(() => { throw new Error('blocked') }),
      setItem: vi.fn(() => { throw new Error('blocked') }),
    }
    expect(readAmountSliderVibrationPreference('parent-a', failingStorage)).toBe(false)
    expect(saveAmountSliderVibrationPreference('parent-a', true, failingStorage)).toBe(false)
  })

  it('detects vibration support without invoking the browser API', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })

    expect(isAmountSliderVibrationSupported()).toBe(true)
    expect(vibrate).not.toHaveBeenCalled()

    Reflect.deleteProperty(navigator, 'vibrate')
    expect(isAmountSliderVibrationSupported()).toBe(false)
  })

  it('treats a missing user id as disabled and does not write a shared key', () => {
    expect(readAmountSliderVibrationPreference('')).toBe(false)
    expect(saveAmountSliderVibrationPreference('', true)).toBe(false)
    expect(localStorage.length).toBe(0)
  })
})
