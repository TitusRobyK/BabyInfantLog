<script lang="ts">
  import { onMount } from 'svelte'
  import { hasNativeInstallPrompt, showNativeInstallPrompt, subscribeToInstallPrompt } from '../lib/pwaInstall'

  const sessionDismissalKey = 'baby-log-install-dismissed-this-session'
  const displayDelay = 5_000

  let visible = false
  let ios = false
  let nativeInstallAvailable = false
  let timer: ReturnType<typeof setTimeout> | null = null

  onMount(() => {
    if (isStandalone() || wasDismissedThisSession()) return

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
    const explicitIos = /iPad|iPhone|iPod/i.test(navigator.userAgent)
    const modernIpad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
    const touchSafari = /Safari/i.test(navigator.userAgent)
      && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent)
      && navigator.maxTouchPoints > 0
      && window.matchMedia('(max-width: 820px)').matches
    return explicitIos || modernIpad || touchSafari
  }

  function wasDismissedThisSession() {
    try {
      return sessionStorage.getItem(sessionDismissalKey) === '1'
    } catch {
      return false
    }
  }

  function dismiss() {
    try {
      sessionStorage.setItem(sessionDismissalKey, '1')
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
        <button class="install-button" type="button" on:click={install}>Add Baby Log to your Home Screen for one-tap opening.</button>
      {/if}
      <button class="text-button" type="button" on:click={dismiss}>Not now</button>
    </div>
  </aside>
{/if}
