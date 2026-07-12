<script lang="ts">
  import Turnstile from './Turnstile.svelte'
  import { supabase } from '../lib/supabase'

  type Mode = 'landing' | 'login' | 'create' | 'join' | 'forgot' | 'check-email'

  let mode: Mode = 'landing'
  let email = ''
  let password = ''
  let confirmPassword = ''
  let showPassword = false
  let error = ''
  let notice = ''
  let busy = false
  let captchaToken = ''
  const turnstileKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

  function resetMessages() {
    error = ''
    notice = ''
  }

  function choose(next: Mode) {
    resetMessages()
    mode = next
  }

  async function login() {
    resetMessages()
    busy = true
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    busy = false
    if (authError) error = 'Email or password is incorrect, or the email is not verified.'
  }

  async function signup(intent: 'create' | 'join') {
    resetMessages()
    if (password.length < 12) {
      error = 'Use at least 12 characters for the password.'
      return
    }
    if (password !== confirmPassword) {
      error = 'The passwords do not match.'
      return
    }
    if (turnstileKey && !captchaToken) {
      error = 'Complete the verification before continuing.'
      return
    }

    busy = true
    localStorage.setItem('baby-log-onboarding-mode', intent)
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        captchaToken: captchaToken || undefined,
      },
    })
    busy = false
    if (authError) {
      error = authError.message
      return
    }
    if (!data.session) mode = 'check-email'
  }

  async function sendReset() {
    resetMessages()
    if (turnstileKey && !captchaToken) {
      error = 'Complete the verification before continuing.'
      return
    }
    busy = true
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/?reset=1`,
      captchaToken: captchaToken || undefined,
    })
    busy = false
    if (resetError) error = resetError.message
    else notice = 'If that email has an account, a reset link is on its way.'
  }

  async function submitAuth() {
    if (mode === 'login') return login()
    if (mode === 'forgot') return sendReset()
    if (mode === 'create' || mode === 'join') return signup(mode)
  }
</script>

<main class="auth-shell">
  <section class="auth-panel" aria-labelledby="auth-title">
    <h1 id="auth-title">Baby Infant Log</h1>

    {#if mode === 'landing'}
      <p class="lede">A fast, shared log for two parents.</p>
      <div class="stack">
        <button class="primary" type="button" on:click={() => choose('login')}>Log in</button>
        <button type="button" on:click={() => choose('create')}>Create a family — Parent A</button>
        <button type="button" on:click={() => choose('join')}>Join a family — Parent B</button>
      </div>
    {:else if mode === 'check-email'}
      <p class="eyebrow">Account created</p>
      <h2>Check your email</h2>
      <p>Open the verification link sent to <strong>{email}</strong>, then return here.</p>
      <button type="button" on:click={() => choose('login')}>Back to login</button>
    {:else}
      <button class="text-button back" type="button" on:click={() => choose('landing')}>← Back</button>
      <p class="eyebrow">
        {mode === 'create' ? 'Create a family' : mode === 'join' ? 'Join a family' : mode === 'forgot' ? 'Account recovery' : 'Welcome back'}
      </p>
      <h2>{mode === 'forgot' ? 'Reset password' : mode === 'login' ? 'Log in' : 'Create account'}</h2>

      <form on:submit|preventDefault={submitAuth}>
        <label>
          Email
          <input bind:value={email} type="email" autocomplete="email" inputmode="email" required />
        </label>

        {#if mode !== 'forgot'}
          <label>
            Password
            <input bind:value={password} type={showPassword ? 'text' : 'password'} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} minlength="12" required />
          </label>
          {#if mode === 'create' || mode === 'join'}
            <p class="hint">At least 12 characters. Password managers and paste are supported.</p>
            <label>
              Confirm password
              <input bind:value={confirmPassword} type={showPassword ? 'text' : 'password'} autocomplete="new-password" minlength="12" required />
            </label>
          {/if}
          <label class="check-row"><input bind:checked={showPassword} type="checkbox" /> Show password</label>
        {/if}

        <Turnstile siteKey={turnstileKey} onToken={(token) => (captchaToken = token)} />

        {#if error}<p class="field-error" role="alert">{error}</p>{/if}
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}

        <button class="primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : mode === 'forgot' ? 'Send reset link' : 'Create account'}
        </button>
      </form>

      {#if mode === 'login'}
        <button class="text-button" type="button" on:click={() => choose('forgot')}>Forgot password?</button>
      {/if}
    {/if}
  </section>
</main>
