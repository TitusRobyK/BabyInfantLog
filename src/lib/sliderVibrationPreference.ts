const AMOUNT_SLIDER_VIBRATION_KEY_PREFIX = 'baby-log-amount-slider-vibration'

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function amountSliderVibrationPreferenceKey(userId: string): string {
  return `${AMOUNT_SLIDER_VIBRATION_KEY_PREFIX}:${userId}`
}

export function isAmountSliderVibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

export function readAmountSliderVibrationPreference(
  userId: string,
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  if (!userId || !storage) return false
  try {
    return storage.getItem(amountSliderVibrationPreferenceKey(userId)) === 'true'
  } catch {
    return false
  }
}

export function saveAmountSliderVibrationPreference(
  userId: string,
  enabled: boolean,
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  if (!userId || !storage) return false
  try {
    storage.setItem(amountSliderVibrationPreferenceKey(userId), enabled ? 'true' : 'false')
    return true
  } catch {
    return false
  }
}
