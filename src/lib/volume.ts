import type { VolumeUnit } from './types'

export const FEED_MAX_ML = 350
export const PUMP_MAX_ML = 60
export const ML_PER_FL_OZ = 29.5735

function round(value: number, decimals: number) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function pumpSliderConfig(unit: VolumeUnit) {
  return unit === 'fl_oz'
    ? { max: round(PUMP_MAX_ML / ML_PER_FL_OZ, 2), step: 0.01 }
    : { max: PUMP_MAX_ML, step: 1 }
}

export function convertVolume(amount: number, from: VolumeUnit, to: VolumeUnit): number {
  if (!amount || from === to) return amount
  return to === 'fl_oz' ? round(amount / ML_PER_FL_OZ, 2) : Math.round(amount * ML_PER_FL_OZ)
}

export function volumeInMilliliters(amount: number, unit: VolumeUnit): number {
  return unit === 'fl_oz' ? round(amount * ML_PER_FL_OZ, 1) : amount
}
