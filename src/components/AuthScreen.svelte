<script lang="ts">
  import Turnstile from './Turnstile.svelte'
  import { saveOnboardingIntent } from '../lib/authIntent'
  import { supabase } from '../lib/supabase'

  type Mode = 'landing' | 'login' | 'create' | 'join' | 'forgot' | 'check-email'

  let mode: Mode = 'landing'
  let email = ''
  let password = ''
  let confirmPassword = ''
  let showPassword = false
  let error = ''
  let oauthError = ''
  let notice = ''
  let busy = false
  let captchaToken = ''
  const turnstileKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

  function resetMessages() {
    error = ''
    oauthError = ''
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

  async function continueWithGoogle() {
    if (mode !== 'login' && mode !== 'create' && mode !== 'join') return

    resetMessages()
    saveOnboardingIntent(mode === 'login' ? null : mode)
    busy = true
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })

    if (authError) {
      busy = false
      oauthError = 'Google sign-in could not start. Try again or continue with email.'
    }
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
    saveOnboardingIntent(intent)
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
    <h1 id="auth-title">Baby Log</h1>

    {#if mode === 'landing'}
      <p class="lede">Keep up with your baby's day, together.</p>
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

      {#if mode === 'login' || mode === 'create' || mode === 'join'}
        <div class="oauth-method">
          {#if mode === 'join'}
            <p class="oauth-guidance">Use the Google account that received the family invitation.</p>
          {/if}
          <button class="google-button" type="button" on:click={continueWithGoogle} disabled={busy}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285f4" d="M17.64 9.21c0-.64-.06-1.25-.16-1.85H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.91c1.7-1.57 2.68-3.88 2.68-6.61Z" />
              <path fill="#34a853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
              <path fill="#fbbc05" d="M3.96 10.71A5.42 5.42 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96h-3A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33Z" />
              <path fill="#ea4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33C4.67 5.17 6.66 3.58 9 3.58Z" />
            </svg>
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </button>
          {#if oauthError}<p class="field-error" role="alert">{oauthError}</p>{/if}
          <div class="auth-divider" aria-hidden="true"><span>or continue with email</span></div>
        </div>
      {/if}

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
