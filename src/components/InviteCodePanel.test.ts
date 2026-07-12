import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InviteCodePanel from './InviteCodePanel.svelte'

let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Invitation code panel', () => {
  it('keeps email delivery parent-controlled and copies the code from its icon', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onEmail = vi.fn(async () => undefined)
    mounted = mount(InviteCodePanel, {
      target: document.body,
      props: {
        code: '7K3QP',
        expiresAt: '2026-07-13T18:00:00.000Z',
        email: 'parent-b@example.com',
        deliveryStatus: 'not_sent',
        onEmail,
      },
    })

    const emailButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Email invitation'))
    const copyButton = document.querySelector<HTMLButtonElement>('button[aria-label="Copy family code"]')
    expect(emailButton).toBeTruthy()
    expect(onEmail).not.toHaveBeenCalled()

    emailButton?.click()
    await tick()
    expect(onEmail).toHaveBeenCalledOnce()

    copyButton?.click()
    await tick()

    expect(writeText).toHaveBeenCalledWith('7K3QP')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Family code copied.'))
  })

  it('shows a non-blocking failure state while keeping the code visible', () => {
    mounted = mount(InviteCodePanel, {
      target: document.body,
      props: {
        code: '7K3QP',
        expiresAt: '2026-07-13T18:00:00.000Z',
        email: 'parent-b@example.com',
        deliveryStatus: 'failed',
        onEmail: async () => undefined,
      },
    })

    expect(document.body.textContent).toContain('7K3QP')
    expect(document.body.textContent).toContain('We couldn’t send the email.')
    expect(document.body.textContent).toContain('Try email again')
  })

  it('disables only email delivery until the successful-send cooldown expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T18:00:00.000Z'))
    const onEmail = vi.fn(async () => undefined)
    mounted = mount(InviteCodePanel, {
      target: document.body,
      props: {
        code: '7K3QP',
        expiresAt: '2026-07-14T18:00:00.000Z',
        email: 'parent-b@example.com',
        deliveryStatus: 'sent',
        cooldownUntil: '2026-07-13T18:30:00.000Z',
        onEmail,
      },
    })

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    const emailButton = buttons.find((button) => button.textContent?.includes('Email sent'))
    const shareButton = buttons.find((button) => button.textContent?.includes('Share invitation'))
    const copyButton = document.querySelector<HTMLButtonElement>('button[aria-label="Copy family code"]')

    expect(emailButton?.disabled).toBe(true)
    expect(emailButton?.textContent).toContain('Available in 30 min')
    expect(shareButton?.disabled).toBe(false)
    expect(copyButton?.disabled).toBe(false)

    await vi.advanceTimersByTimeAsync(30 * 60_000)
    await tick()

    expect(emailButton?.disabled).toBe(false)
    expect(emailButton?.textContent).toContain('Send again')
    expect(onEmail).not.toHaveBeenCalled()
  })
})
