import type { User } from '@supabase/supabase-js'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ONBOARDING_INTENT_KEY } from '../lib/authIntent'
import Onboarding from './Onboarding.svelte'

const mocks = vi.hoisted(() => ({
  generateInvite: vi.fn(),
  profileUpsert: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  claimInvite: vi.fn(),
  emailInvite: vi.fn(),
  generateInvite: mocks.generateInvite,
  InviteEmailCooldownError: class InviteEmailCooldownError extends Error {},
  previewInvite: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ upsert: mocks.profileUpsert })),
    rpc: mocks.rpc,
  },
}))

let mounted: ReturnType<typeof mount> | undefined

beforeEach(() => {
  mocks.profileUpsert.mockReset().mockResolvedValue({ error: null })
  mocks.rpc.mockReset().mockResolvedValue({ error: null })
  mocks.generateInvite.mockReset()
})

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

function enterValue(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function startParentACreation() {
  localStorage.setItem(ONBOARDING_INTENT_KEY, 'create')
  mounted = mount(Onboarding, {
    target: document.body,
    props: {
      user: { id: 'parent-a', email: 'parent-a@example.com' } as User,
      profile: null,
      onComplete: async () => undefined,
    },
  })

  const nameInputs = document.querySelectorAll<HTMLInputElement>('input[maxlength="60"]')
  enterValue(nameInputs[0], 'Titus')
  enterValue(nameInputs[1], 'Hannah')
  enterValue(document.querySelector<HTMLInputElement>('input[type="email"]')!, 'parent-b@example.com')
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === 'Create family',
  )!.click()
}

describe('Parent A invitation creation', () => {
  it('shows progress rather than an error while the invitation request is pending', async () => {
    let resolveInvitation!: (value: {
      code: string
      expiresAt: string
      emailDelivery: { status: 'not_sent' }
    }) => void
    mocks.generateInvite.mockReturnValue(
      new Promise((resolve) => {
        resolveInvitation = resolve
      }),
    )

    startParentACreation()

    await vi.waitFor(() => expect(document.body.textContent).toContain('Preparing your family invitation…'))
    expect(document.body.textContent).not.toContain('We couldn’t create the invitation')

    resolveInvitation({
      code: '7K3QP',
      expiresAt: '2026-07-13T18:00:00.000Z',
      emailDelivery: { status: 'not_sent' },
    })

    await vi.waitFor(() => expect(document.body.textContent).toContain('7K3QP'))
    expect(document.body.textContent).not.toContain('We couldn’t create the invitation')
  })

  it('shows the invitation error screen only after a genuine request failure', async () => {
    mocks.generateInvite.mockRejectedValue(new Error('Invitation service unavailable.'))

    startParentACreation()

    await vi.waitFor(() => expect(document.body.textContent).toContain('We couldn’t create the invitation'))
    expect(document.body.textContent).toContain('Invitation service unavailable.')
    const failureActions = document.querySelector('.invitation-failure-actions')!
    expect(Array.from(failureActions.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
      'Try again',
      'Continue to log',
    ])
  })
})
