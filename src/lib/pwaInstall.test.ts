import { describe, expect, it, vi } from 'vitest'
import { hasNativeInstallPrompt, showNativeInstallPrompt } from './pwaInstall'
import type { BeforeInstallPromptEvent } from './pwaInstall'

describe('PWA install prompt', () => {
  it('captures and invokes the Android install prompt once', async () => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
    event.prompt = vi.fn().mockResolvedValue(undefined)
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(hasNativeInstallPrompt()).toBe(true)
    await expect(showNativeInstallPrompt()).resolves.toBe('accepted')
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(hasNativeInstallPrompt()).toBe(false)
  })
})
