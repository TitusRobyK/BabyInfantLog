import type { WeightUnit } from './types'

export type { WeightUnit } from './types'

export interface PoundsAndOunces {
  pounds: number
  ounces: number
}

export interface KilogramsAndGrams {
  kilograms: number
  grams: number
}

export const GRAMS_PER_OUNCE = 28.349523125
export const OUNCES_PER_POUND = 16
export const GRAMS_PER_KILOGRAM = 1000

export function poundsAndOuncesToGrams(pounds: number, ounces: number): number {
  requireWholeNonNegative(pounds, 'Pounds')
  requireFiniteNonNegative(ounces, 'Ounces')
  if (ounces >= OUNCES_PER_POUND) throw new RangeError('Ounces must be less than 16.')
  return Math.round((pounds * OUNCES_PER_POUND + ounces) * GRAMS_PER_OUNCE)
}

export function kilogramsAndGramsToGrams(kilograms: number, grams: number): number {
  requireWholeNonNegative(kilograms, 'Kilograms')
  requireWholeNonNegative(grams, 'Grams')
  if (grams >= GRAMS_PER_KILOGRAM) throw new RangeError('Grams must be less than 1,000.')
  return kilograms * GRAMS_PER_KILOGRAM + grams
}

export function gramsToPoundsAndOunces(weightGrams: number): PoundsAndOunces {
  requireFiniteNonNegative(weightGrams, 'Weight')
  const roundedTenths = Math.round((weightGrams / GRAMS_PER_OUNCE) * 10) / 10
  let pounds = Math.floor(roundedTenths / OUNCES_PER_POUND)
  let ounces = Math.round((roundedTenths - pounds * OUNCES_PER_POUND) * 10) / 10

  if (ounces >= OUNCES_PER_POUND) {
    pounds += 1
    ounces = 0
  }

  return { pounds, ounces }
}

export function gramsToKilogramsAndGrams(weightGrams: number): KilogramsAndGrams {
  requireFiniteNonNegative(weightGrams, 'Weight')
  const roundedGrams = Math.round(weightGrams)
  return {
    kilograms: Math.floor(roundedGrams / GRAMS_PER_KILOGRAM),
    grams: roundedGrams % GRAMS_PER_KILOGRAM,
  }
}

export function formatWeight(weightGrams: number, unit: WeightUnit): string {
  if (unit === 'kg_g') {
    const { kilograms, grams } = gramsToKilogramsAndGrams(weightGrams)
    return `${kilograms} kg ${grams} g`
  }

  const { pounds, ounces } = gramsToPoundsAndOunces(weightGrams)
  return `${pounds} lb ${formatTenths(ounces)} oz`
}

export function formatWeightChange(changeGrams: number, unit: WeightUnit): string {
  if (!Number.isFinite(changeGrams)) throw new RangeError('Weight change must be a finite number.')
  const sign = changeGrams > 0 ? '+' : changeGrams < 0 ? '−' : ''
  const absolute = Math.abs(changeGrams)
  if (unit === 'kg_g') return `${sign}${Math.round(absolute)} g`
  const ounces = Math.round((absolute / GRAMS_PER_OUNCE) * 10) / 10
  return `${sign}${formatTenths(ounces)} oz`
}

function formatTenths(value: number): string {
  return Number(value.toFixed(1)).toString()
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative number.`)
}

function requireWholeNonNegative(value: number, label: string): void {
  requireFiniteNonNegative(value, label)
  if (!Number.isInteger(value)) throw new RangeError(`${label} must be a whole number.`)
}
