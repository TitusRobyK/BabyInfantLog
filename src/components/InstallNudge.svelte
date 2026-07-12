<script lang="ts">
  import { onMount } from 'svelte'
  import { hasNativeInstallPrompt, showNativeInstallPrompt, subscribeToInstallPrompt } from '../lib/pwaInstall'

  const dismissalKey = 'baby-log-install-dismissed-at'
  const dismissalDuration = 14 * 24 * 60 * 60_000
  const displayDelay = 20_000

  let visible = false
  let ios = false
  let nativeInstallAvailable = false
  let timer: ReturnType<typeof setTimeout> | null = null

  onMount(() => {
    if (isStandalone() || wasRecentlyDismissed()) return

    ios = isIosDevice()
    const android = /Android/i.test(navigator.userAgent)
    if (!ios && !android) return

    const schedule = () => {
      nativeInstallAvailable = hasNativeInstallPrompt()
      if (!timer && (ios || nativeInstallAvailable)) {
        timer = setTimeout(() => (visible = true), displayDelay)
      }
    }

    const unsubscribe = subscribeToInstallPrompt(schedule)
    schedule()

    const installed = () => {
      visible = false
      if (timer) clearTimeout(timer)
      timer = null
    }
    window.addEventListener('appinstalled', installed)

    return () => {
      unsubscribe()
      window.removeEventListener('appinstalled', installed)
      if (timer) clearTimeout(timer)
    }
  })

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  }

  function isIosDevice() {
    return /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  }

  function wasRecentlyDismissed() {
    try {
      const dismissedAt = Number(localStorage.getItem(dismissalKey) ?? 0)
      return dismissedAt > 0 && Date.now() - dismissedAt < dismissalDuration
    } catch {
      return false
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(dismissalKey, String(Date.now()))
    } catch {
      // The nudge can still be dismissed for this page when storage is unavailable.
    }
    visible = false
  }

  async function install() {
    try {
      const outcome = await showNativeInstallPrompt()
      if (outcome === 'accepted') visible = false
      else dismiss()
    } catch {
      dismiss()
    }
  }
</script>

{#if visible}
  <aside class="install-nudge" aria-labelledby="install-nudge-title">
    <div class="install-nudge-copy">
      <strong id="install-nudge-title">Faster access when your hands are full</strong>
      <p>{ios ? 'Tap Share, then Add to Home Screen.' : 'Add Baby Log to your Home Screen for one-tap opening.'}</p>
    </div>
    <div class="install-nudge-actions">
      {#if nativeInstallAvailable}
        <button class="install-button" type="button" on:click={install}>Add to Home Screen</button>
      {/if}
      <button class="text-button" type="button" on:click={dismiss}>Not now</button>
    </div>
  </aside>
{/if}
