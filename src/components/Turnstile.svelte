<script lang="ts">
  import { onMount } from 'svelte'

  export let siteKey = ''
  export let onToken: (token: string) => void

  let container: HTMLDivElement
  let unavailable = false

  onMount(() => {
    if (!siteKey) return

    const render = () => {
      if (!window.turnstile || !container) return
      window.turnstile.render(container, {
        sitekey: siteKey,
        theme: 'light',
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(''),
        'error-callback': () => {
          unavailable = true
          onToken('')
        },
      })
    }

    if (window.turnstile) {
      render()
      return
    }

    window.onTurnstileLoaded = render
    const existing = document.querySelector('script[data-turnstile]')
    if (!existing) {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoaded&render=explicit'
      script.async = true
      script.defer = true
      script.dataset.turnstile = 'true'
      script.onerror = () => (unavailable = true)
      document.head.appendChild(script)
    }
  })
</script>

{#if siteKey}
  <div class="turnstile-wrap">
    <div bind:this={container}></div>
    {#if unavailable}<p class="field-error">Verification could not load. Check your connection.</p>{/if}
  </div>
{/if}
