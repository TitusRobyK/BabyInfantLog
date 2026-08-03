import type { VolumeUnit } from './types'

export const ML_PER_FL_OZ = 29.5735

export const DEFAULT_VOLUME_MAX_ML = 350
export const MIN_VOLUME_MAX_ML = 30
export const MAX_VOLUME_MAX_ML = 600
export const VOLUME_MAX_STEP_ML = 10

export const VOLUME_ENTRY_STEP_ML = 1
export const VOLUME_ENTRY_STEP_FL_OZ = 0.1

export const VOLUME_MAX_SETTING_CONFIG = {
  min: MIN_VOLUME_MAX_ML,
  max: MAX_VOLUME_MAX_ML,
  step: VOLUME_MAX_STEP_ML,
} as const

export interface StoredVolumeDetails {
  amount_ml?: number
  amount?: number
  unit?: VolumeUnit
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Normalizes the persisted slider preference to the supported canonical-ml range.
 * The preference is intentionally separate from event validation: an older event
 * may contain more than the current slider maximum and must not be clamped.
 */
export function normalizeVolumeMaxMl(value: number, fallback = DEFAULT_VOLUME_MAX_ML): number {
  if (!Number.isFinite(value)) return normalizeVolumeMaxMl(fallback, DEFAULT_VOLUME_MAX_ML)
  const bounded = Math.min(Math.max(value, MIN_VOLUME_MAX_ML), MAX_VOLUME_MAX_ML)
  return Math.round(bounded / VOLUME_MAX_STEP_ML) * VOLUME_MAX_STEP_ML
}

export function isValidVolumeMaxMl(value: unknown): value is number {
  return finiteNonNegative(value)
    && value >= MIN_VOLUME_MAX_ML
    && value <= MAX_VOLUME_MAX_ML
    && value % VOLUME_MAX_STEP_ML === 0
}

/** Converts a displayed amount into the canonical milliliter value stored on an event. */
export function volumeToMilliliters(amount: number, unit: VolumeUnit): number {
  if (!finiteNonNegative(amount)) return 0
  return unit === 'fl_oz' ? round(amount * ML_PER_FL_OZ, 1) : round(amount, 1)
}

/** Converts canonical milliliters into the current parent's display unit. */
export function volumeToDisplay(amountMl: number, unit: VolumeUnit): number {
  if (!finiteNonNegative(amountMl)) return 0
  return unit === 'fl_oz' ? round(amountMl / ML_PER_FL_OZ, 1) : Math.round(amountMl)
}

/** Formats canonical milliliters without exposing floating-point conversion noise. */
export function formatVolume(amountMl: number, unit: VolumeUnit): string {
  const amount = volumeToDisplay(amountMl, unit)
  return unit === 'fl_oz' ? `${Number(amount.toFixed(1))} fl oz` : `${amount} ml`
}

export function volumeEntrySliderConfig(maxMl: number, unit: VolumeUnit) {
  const safeMaxMl = finiteNonNegative(maxMl) ? maxMl : DEFAULT_VOLUME_MAX_ML
  return {
    max: volumeToDisplay(safeMaxMl, unit),
    step: unit === 'fl_oz' ? VOLUME_ENTRY_STEP_FL_OZ : VOLUME_ENTRY_STEP_ML,
  }
}

/**
 * Reads canonical volume from both current and legacy event-detail shapes.
 * `amount_ml` always wins; legacy `amount` is converted only when its unit exists.
 */
export function canonicalVolumeMl(details: StoredVolumeDetails): number | null {
  if (details.amount_ml !== undefined) return finiteNonNegative(details.amount_ml) && details.amount_ml > 0 ? details.amount_ml : null
  if (finiteNonNegative(details.amount) && details.amount > 0 && details.unit) {
    return volumeToMilliliters(details.amount, details.unit)
  }
  return null
}
