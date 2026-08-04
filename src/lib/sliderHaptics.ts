import type { VolumeUnit } from './types'

:wqexport const SLIDER_HAPTIC_ML_INTERVAL = 10
export const SLIDER_HAPTIC_FL_OZ_INTERVAL = 0.5
export const SLIDER_HAPTIC_REGULAR_MS = 8
export const SLIDER_HAPTIC_BOUNDARY_MS = 15
export const SLIDER_HAPTIC_THROTTLE_MS = 80

export type SliderHapticKind = 'regular' | 'boundary'

export interface SliderHapticInput {
  value: number
  unit: VolumeUnit
  max: number
  userTriggered: boolean
}

export interface SliderHapticsOptions {
  initialValue?: number
  isEnabled: () => boolean
  vibrate?: (durationMs: number) => boolean
  isVisible?: () => boolean
  now?: () => number
}

export interface SliderHapticsController {
  handleInput: (input: SliderHapticInput) => void
  reset: (value?: number) => void
  cancel: (value?: number) => void
}

/**
 * Classifies one user-driven slider transition. A jump across several milestones
 * intentionally produces one result, and a boundary always wins over a regular
 * milestone.
 */
export function sliderHapticForTransition(
  previousValue: number,
  value: number,
  unit: VolumeUnit,
  max: number,
): SliderHapticKind | null {
  if (![previousValue, value, max].every(Number.isFinite) || previousValue === value) return null

  const leavesZero = previousValue === 0 && value > 0
  const reachesZero = previousValue > 0 && value === 0
  const reachesTop = max > 0 && previousValue < max && value >= max
  if (leavesZero || reachesZero || reachesTop) return 'boundary'

  const interval = unit === 'fl_oz' ? SLIDER_HAPTIC_FL_OZ_INTERVAL : SLIDER_HAPTIC_ML_INTERVAL
  return milestoneBucket(previousValue, interval) === milestoneBucket(value, interval) ? null : 'regular'
}

/**
 * Creates isolated haptic state for one amount slider. Programmatic values sync
 * the baseline without feedback. Eligible calls inside the throttle window are
 * dropped rather than queued, so no vibration can arrive after interaction ends.
 */
export function createSliderHaptics(options: SliderHapticsOptions): SliderHapticsController {
  let previousValue = finiteValue(options.initialValue)
  let lastPulseAt = Number.NEGATIVE_INFINITY
  const now = options.now ?? (() => Date.now())
  const isVisible = options.isVisible ?? browserDocumentIsVisible
  const vibrate = options.vibrate ?? browserVibrate

  function reset(value?: number) {
    previousValue = finiteValue(value)
    lastPulseAt = Number.NEGATIVE_INFINITY
  }

  function cancel(value?: number) {
    tryVibrate(vibrate, 0)
    reset(value)
  }

  function handleInput(input: SliderHapticInput) {
    const value = finiteValue(input.value)
    if (value === undefined) return

    const previous = previousValue
    previousValue = value
    if (!input.userTriggered || previous === undefined) return

    const kind = sliderHapticForTransition(previous, value, input.unit, input.max)
    if (!kind || !options.isEnabled() || !isVisible()) return

    const timestamp = now()
    if (!Number.isFinite(timestamp) || timestamp - lastPulseAt < SLIDER_HAPTIC_THROTTLE_MS) return

    lastPulseAt = timestamp
    tryVibrate(vibrate, kind === 'boundary' ? SLIDER_HAPTIC_BOUNDARY_MS : SLIDER_HAPTIC_REGULAR_MS)
  }

  return { handleInput, reset, cancel }
}

function milestoneBucket(value: number, interval: number): number {
  return Math.floor((value + Number.EPSILON) / interval)
}

function finiteValue(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function browserDocumentIsVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible'
}

function browserVibrate(durationMs: number): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
  return navigator.vibrate(durationMs)
}

function tryVibrate(vibrate: (durationMs: number) => boolean, durationMs: number): void {
  try {
    vibrate(durationMs)
  } catch {
    // Haptics are optional. Browser, hardware, and system-policy failures are quiet no-ops.
  }
}
