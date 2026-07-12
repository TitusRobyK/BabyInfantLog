export type OnboardingIntent = 'create' | 'join'

export const ONBOARDING_INTENT_KEY = 'baby-log-onboarding-mode'

type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readOnboardingIntent(storage: IntentStorage = localStorage): OnboardingIntent | null {
  const value = storage.getItem(ONBOARDING_INTENT_KEY)
  return value === 'create' || value === 'join' ? value : null
}

export function saveOnboardingIntent(intent: OnboardingIntent | null, storage: IntentStorage = localStorage) {
  if (intent) storage.setItem(ONBOARDING_INTENT_KEY, intent)
  else storage.removeItem(ONBOARDING_INTENT_KEY)
}

export function clearOnboardingIntent(storage: IntentStorage = localStorage) {
  storage.removeItem(ONBOARDING_INTENT_KEY)
}
