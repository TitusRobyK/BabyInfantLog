<script lang="ts">
  import { supabase } from '../lib/supabase'

  export let onDone: () => void

  let password = ''
  let confirmPassword = ''
  let showPassword = false
  let error = ''
  let busy = false

  async function updatePassword() {
    error = ''
    if (password.length < 12) {
      error = 'Use at least 12 characters.'
      return
    }
    if (password !== confirmPassword) {
      error = 'The passwords do not match.'
      return
    }
    busy = true
    const { error: updateError } = await supabase.auth.updateUser({ password })
    busy = false
    if (updateError) error = updateError.message
    else onDone()
  }
</script>

<main class="auth-shell">
  <section class="auth-panel">
    <p class="eyebrow">Account recovery</p>
    <h1>Set new password</h1>
    <form on:submit|preventDefault={updatePassword}>
      <label>New password <input bind:value={password} type={showPassword ? 'text' : 'password'} autocomplete="new-password" minlength="12" required /></label>
      <label>Confirm password <input bind:value={confirmPassword} type={showPassword ? 'text' : 'password'} autocomplete="new-password" minlength="12" required /></label>
      <label class="check-row"><input bind:checked={showPassword} type="checkbox" /> Show password</label>
      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
    </form>
  </section>
</main>
