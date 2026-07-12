import type { User } from '@supabase/supabase-js'
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { ONBOARDING_INTENT_KEY } from '../lib/authIntent'
import Onboarding from './Onboarding.svelte'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
  localStorage.clear()
})

describe('Parent B onboarding', () => {
  it('enables Review family when the entered code normalizes to five characters', async () => {
    localStorage.setItem(ONBOARDING_INTENT_KEY, 'join')
    mounted = mount(Onboarding, {
      target: document.body,
      props: {
        user: { id: 'parent-b', email: 'parent-b@example.com' } as User,
        profile: null,
        onComplete: async () => undefined,
      },
    })

    const displayName = document.querySelector<HTMLInputElement>('input[autocomplete="name"]')!
    const codeInput = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!
    const reviewButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Review family',
    )!

    expect(reviewButton.disabled).toBe(true)

    displayName.value = 'Roshin'
    displayName.dispatchEvent(new Event('input', { bubbles: true }))
    codeInput.value = '7k-3qp'
    codeInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(codeInput.value).toBe('7K-3QP')
    expect(reviewButton.disabled).toBe(false)
  })
})
