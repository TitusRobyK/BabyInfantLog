<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { EmailDeliveryStatus } from '../lib/api'

  export let code: string
  export let expiresAt: string
  export let email: string
  export let deliveryStatus: EmailDeliveryStatus
  export let cooldownUntil = ''
  export let busy = false
  export let compact = false
  export let onEmail: () => Promise<void>

  let copied = false
  let copyMessage = ''
  let codeOutput: HTMLOutputElement
  let copyTimer: ReturnType<typeof setTimeout> | null = null
  let cooldownTimer: ReturnType<typeof setInterval> | null = null
  let now = Date.now()

  onMount(() => {
    cooldownTimer = setInterval(() => (now = Date.now()), 1_000)
  })

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer)
    if (cooldownTimer) clearInterval(cooldownTimer)
  })

  function remainingTimeLabel(milliseconds: number): string {
    const minutes = Math.ceil(milliseconds / 60_000)
    return minutes <= 1 ? 'less than 1 min' : `${minutes} min`
  }

  function availableAtLabel(value: string): string {
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  async function copyCode() {
    copyMessage = ''
    try {
      await navigator.clipboard.writeText(code)
      copied = true
      copyMessage = 'Family code copied.'
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => {
        copied = false
        copyMessage = ''
      }, 2_000)
    } catch {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(codeOutput)
      selection?.removeAllRanges()
      selection?.addRange(range)
      copyMessage = 'Couldn’t copy automatically. Press and hold the code to copy it.'
    }
  }

  async function shareCode() {
    const text = `Open ${window.location.origin}, choose “Join a family — Parent B”, and enter code ${code}. The code expires ${new Date(expiresAt).toLocaleString()}.`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join our Baby Log family', text })
      } catch {
        // Closing the native share sheet is not an error that needs UI feedback.
      }
    } else {
      await copyCode()
    }
  }

  $: cooldownTimestamp = Date.parse(cooldownUntil)
  $: cooldownRemaining = Number.isFinite(cooldownTimestamp) ? Math.max(0, cooldownTimestamp - now) : 0
  $: coolingDown = cooldownRemaining > 0
  $: emailButtonLabel = busy
    ? 'Sending…'
    : coolingDown
      ? `${deliveryStatus === 'sent' ? 'Email sent · ' : ''}Available in ${remainingTimeLabel(cooldownRemaining)}`
      : deliveryStatus === 'sent'
      ? 'Send again'
      : deliveryStatus === 'failed'
        ? 'Try email again'
        : 'Email invitation'
</script>

<section class="invite-result" aria-label="Family invitation">
  <div class="invite-code-row">
    <output bind:this={codeOutput} class="invite-code" class:small-code={compact} aria-label={`Family code ${code}`}>{code}</output>
    <button class="copy-code-button" type="button" aria-label="Copy family code" title="Copy family code" on:click={copyCode}>
      {#if copied}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1" /><path d="M16 8V5H5v11h3" /></svg>
      {/if}
    </button>
  </div>

  <p class="invite-expiry">Bound to <strong>{email}</strong>. Expires {new Date(expiresAt).toLocaleString()}.</p>

  {#if deliveryStatus === 'sent'}
    <p class="invite-delivery success" role="status">
      <strong>Invitation emailed.</strong> Sent to {email}.{#if coolingDown} You can send another email after {availableAtLabel(cooldownUntil)}.{/if}
    </p>
  {:else if coolingDown}
    <p class="invite-delivery" role="status">A recent invitation email was sent. You can email this code after {availableAtLabel(cooldownUntil)}.</p>
  {:else if deliveryStatus === 'failed'}
    <p class="invite-delivery attention" role="status"><strong>We couldn’t send the email.</strong> The code is still ready to copy or share.</p>
  {:else}
    <p class="invite-delivery">The code is ready. Choose whether to email, copy, or share it.</p>
  {/if}

  {#if copyMessage}<p class="copy-status" role="status">{copyMessage}</p>{/if}

  <div class="invite-actions">
    <button type="button" disabled={busy || coolingDown} on:click={onEmail}>{emailButtonLabel}</button>
    <button type="button" on:click={shareCode}>Share invitation</button>
  </div>
</section>
