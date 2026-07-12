import { describe, expect, it } from 'vitest'
import { convertVolume, FEED_MAX_ML, pumpSliderConfig, volumeInMilliliters } from './volume'

describe('volume helpers', () => {
  it('uses the requested feed and pump milliliter limits', () => {
    expect(FEED_MAX_ML).toBe(350)
    expect(pumpSliderConfig('ml')).toEqual({ max: 60, step: 1 })
  })

  it('converts the pump limit to fluid ounces', () => {
    expect(pumpSliderConfig('fl_oz')).toEqual({ max: 2.03, step: 0.01 })
    expect(convertVolume(60, 'ml', 'fl_oz')).toBe(2.03)
  })

  it('converts a recorded fluid-ounce amount back to normalized milliliters', () => {
    expect(convertVolume(2, 'fl_oz', 'ml')).toBe(59)
    expect(volumeInMilliliters(2, 'fl_oz')).toBe(59.1)
  })
})
