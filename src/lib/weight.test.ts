import { describe, expect, it } from 'vitest'
import {
  formatWeight,
  formatWeightChange,
  gramsToKilogramsAndGrams,
  gramsToPoundsAndOunces,
  kilogramsAndGramsToGrams,
  poundsAndOuncesToGrams,
} from './weight'

describe('weight conversion', () => {
  it('converts pounds and tenths of an ounce to canonical whole grams', () => {
    expect(poundsAndOuncesToGrams(8, 6.2)).toBe(3805)
    expect(gramsToPoundsAndOunces(3805)).toEqual({ pounds: 8, ounces: 6.2 })
  })

  it('converts split kilograms and grams without losing whole-gram precision', () => {
    expect(kilogramsAndGramsToGrams(3, 799)).toBe(3799)
    expect(gramsToKilogramsAndGrams(3799)).toEqual({ kilograms: 3, grams: 799 })
  })

  it('carries rounded ounces into the next pound', () => {
    const justBelowOnePound = 15.96 * 28.349523125
    expect(gramsToPoundsAndOunces(justBelowOnePound)).toEqual({ pounds: 1, ounces: 0 })
    expect(formatWeight(justBelowOnePound, 'lb_oz')).toBe('1 lb 0 oz')
  })

  it('carries rounded grams into the next kilogram', () => {
    expect(gramsToKilogramsAndGrams(999.6)).toEqual({ kilograms: 1, grams: 0 })
    expect(formatWeight(999.6, 'kg_g')).toBe('1 kg 0 g')
  })

  it('formats both supported display systems', () => {
    expect(formatWeight(3827, 'lb_oz')).toBe('8 lb 7 oz')
    expect(formatWeight(3827, 'kg_g')).toBe('3 kg 827 g')
  })

  it('formats neutral signed changes in the selected unit', () => {
    expect(formatWeightChange(119, 'lb_oz')).toBe('+4.2 oz')
    expect(formatWeightChange(-119, 'kg_g')).toBe('−119 g')
    expect(formatWeightChange(0, 'kg_g')).toBe('0 g')
  })

  it('rejects invalid split-unit inputs', () => {
    expect(() => poundsAndOuncesToGrams(8, 16)).toThrow('Ounces must be less than 16.')
    expect(() => poundsAndOuncesToGrams(8.5, 0)).toThrow('Pounds must be a whole number.')
    expect(() => kilogramsAndGramsToGrams(3, 1000)).toThrow('Grams must be less than 1,000.')
    expect(() => kilogramsAndGramsToGrams(3, 0.5)).toThrow('Grams must be a whole number.')
    expect(() => formatWeight(-1, 'kg_g')).toThrow('Weight must be a non-negative number.')
  })
})
