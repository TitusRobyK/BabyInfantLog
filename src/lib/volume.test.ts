import { describe, expect, it } from 'vitest'
import {
  canonicalVolumeMl,
  DEFAULT_VOLUME_MAX_ML,
  formatVolume,
  isValidVolumeMaxMl,
  normalizeVolumeMaxMl,
  VOLUME_MAX_SETTING_CONFIG,
  volumeEntrySliderConfig,
  volumeToDisplay,
  volumeToMilliliters,
} from './volume'

describe('volume helpers', () => {
  it('defines one configurable canonical maximum for Feed and Pump', () => {
    expect(DEFAULT_VOLUME_MAX_ML).toBe(350)
    expect(VOLUME_MAX_SETTING_CONFIG).toEqual({ min: 30, max: 600, step: 10 })
    expect(volumeEntrySliderConfig(DEFAULT_VOLUME_MAX_ML, 'ml')).toEqual({ max: 350, step: 1 })
    expect(volumeEntrySliderConfig(DEFAULT_VOLUME_MAX_ML, 'fl_oz')).toEqual({ max: 11.8, step: 0.1 })
  })

  it('normalizes a saved maximum without using it as an event-data limit', () => {
    expect(normalizeVolumeMaxMl(34)).toBe(30)
    expect(normalizeVolumeMaxMl(36)).toBe(40)
    expect(normalizeVolumeMaxMl(10)).toBe(30)
    expect(normalizeVolumeMaxMl(900)).toBe(600)
    expect(normalizeVolumeMaxMl(Number.NaN)).toBe(DEFAULT_VOLUME_MAX_ML)
    expect(volumeEntrySliderConfig(720, 'ml')).toEqual({ max: 720, step: 1 })

    expect(isValidVolumeMaxMl(30)).toBe(true)
    expect(isValidVolumeMaxMl(350)).toBe(true)
    expect(isValidVolumeMaxMl(355)).toBe(false)
    expect(isValidVolumeMaxMl(610)).toBe(false)
  })

  it('converts displayed amounts to canonical milliliters without display rounding loss', () => {
    expect(volumeToMilliliters(2, 'fl_oz')).toBe(59.1)
    expect(volumeToMilliliters(70, 'ml')).toBe(70)

    expect(volumeToDisplay(59.1, 'fl_oz')).toBe(2)
  })

  it('formats canonical volume as whole ml or trimmed one-decimal fl oz', () => {
    expect(formatVolume(70.4, 'ml')).toBe('70 ml')
    expect(formatVolume(59.1, 'fl_oz')).toBe('2 fl oz')
    expect(formatVolume(70, 'fl_oz')).toBe('2.4 fl oz')
  })

  it('prefers canonical event data while supporting legacy amount and unit fields', () => {
    expect(canonicalVolumeMl({ amount_ml: 75, amount: 2, unit: 'fl_oz' })).toBe(75)
    expect(canonicalVolumeMl({ amount: 2, unit: 'fl_oz' })).toBe(59.1)
    expect(canonicalVolumeMl({ amount: 60, unit: 'ml' })).toBe(60)
    expect(canonicalVolumeMl({ amount: 2 })).toBeNull()
    expect(canonicalVolumeMl({ amount_ml: 0, amount: 2, unit: 'fl_oz' })).toBeNull()
    expect(canonicalVolumeMl({ amount: 0, unit: 'ml' })).toBeNull()
    expect(canonicalVolumeMl({})).toBeNull()
  })
})
