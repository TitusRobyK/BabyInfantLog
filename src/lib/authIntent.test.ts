import { beforeEach, describe, expect, it } from 'vitest'
import { clearOnboardingIntent, ONBOARDING_INTENT_KEY, readOnboardingIntent, saveOnboardingIntent } from './authIntent'

describe('authentication onboarding intent', () => {
  beforeEach(() => localStorage.clear())

  it.each(['create', 'join'] as const)('preserves the %s journey through an OAuth redirect', (intent) => {
    saveOnboardingIntent(intent)

    expect(readOnboardingIntent()).toBe(intent)
  })

  it('clears a previous intent for a normal login', () => {
    localStorage.setItem(ONBOARDING_INTENT_KEY, 'join')

    saveOnboardingIntent(null)

    expect(readOnboardingIntent()).toBeNull()
  })

  it('ignores an unexpected stored value', () => {
    localStorage.setItem(ONBOARDING_INTENT_KEY, 'unexpected')

    expect(readOnboardingIntent()).toBeNull()
    clearOnboardingIntent()
    expect(localStorage.getItem(ONBOARDING_INTENT_KEY)).toBeNull()
  })
})
