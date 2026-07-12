<script lang="ts">
  import type { User } from '@supabase/supabase-js'
  import { claimInvite, generateInvite, previewInvite, type InvitePreview } from '../lib/api'
  import { clearOnboardingIntent, readOnboardingIntent } from '../lib/authIntent'
  import { supabase } from '../lib/supabase'
  import type { ParentProfile, ParentType } from '../lib/types'

  export let user: User
  export let profile: ParentProfile | null
  export let onComplete: () => Promise<void>

  type Mode = 'choose' | 'create' | 'join'
  let mode: Mode = readOnboardingIntent() ?? 'choose'

  let displayName = profile?.display_name ?? ''
  let parentType: ParentType = profile?.parent_type ?? 'mother'
  let babyNickname = ''
  let birthDate = ''
  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
  let invitedEmail = ''
  let code = ''
  let preview: InvitePreview | null = null
  let generatedCode = ''
  let expiresAt = ''
  let familyCreated = false
  let busy = false
  let error = ''

  async function saveProfile() {
    const { error: profileError } = await supabase.from('parent_profiles').upsert({
      user_id: user.id,
      display_name: displayName.trim(),
      parent_type: parentType,
      show_pump_action: parentType === 'mother' ? true : (profile?.show_pump_action ?? false),
    })
    if (profileError) throw profileError
  }

  async function createFamily() {
    error = ''
    busy = true
    try {
      await saveProfile()
      const { error: familyError } = await supabase.rpc('create_family', {
        p_baby_nickname: babyNickname.trim(),
        p_birth_date: birthDate || null,
        p_timezone: timezone,
      })
      if (familyError) throw familyError
      familyCreated = true

      if (invitedEmail.trim()) {
        const invite = await generateInvite(invitedEmail.trim())
        generatedCode = invite.code
        expiresAt = invite.expiresAt
      } else {
        await finish()
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The family could not be created.'
    } finally {
      busy = false
    }
  }

  async function checkCode() {
    error = ''
    busy = true
    try {
      await saveProfile()
      preview = await previewInvite(normalizedCode())
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'That code could not be used.'
    } finally {
      busy = false
    }
  }

  async function joinFamily() {
    error = ''
    busy = true
    try {
      await claimInvite(normalizedCode())
      await finish()
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The family could not be joined.'
    } finally {
      busy = false
    }
  }

  function normalizedCode() {
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
  }

  async function finish() {
    clearOnboardingIntent()
    await onComplete()
  }

  async function copyCode() {
    await navigator.clipboard.writeText(generatedCode)
  }

  async function shareCode() {
    const text = `Use code ${generatedCode} to join our Baby Infant Log. It expires ${new Date(expiresAt).toLocaleString()}.`
    if (navigator.share) await navigator.share({ text })
    else await navigator.clipboard.writeText(text)
  }
</script>

<main class="auth-shell">
  <section class="auth-panel wide" aria-labelledby="onboarding-title">
    <h1 id="onboarding-title">Set up your family</h1>

    {#if mode === 'choose'}
      <p class="lede">Your account is verified. Choose how to continue.</p>
      <div class="stack">
        <button class="primary" type="button" on:click={() => (mode = 'create')}>Create a family — Parent A</button>
        <button type="button" on:click={() => (mode = 'join')}>Join a family — Parent B</button>
      </div>
    {:else if generatedCode}
      <p class="eyebrow">Invite Parent B</p>
      <h2>Family code</h2>
      <output class="invite-code" aria-label="Family code">{generatedCode}</output>
      <p>Bound to {invitedEmail}. Expires {new Date(expiresAt).toLocaleString()}.</p>
      <div class="button-row">
        <button type="button" on:click={copyCode}>Copy code</button>
        <button type="button" on:click={shareCode}>Share code</button>
      </div>
      <button class="primary" type="button" on:click={finish}>Continue to log</button>
    {:else if familyCreated}
      <p class="eyebrow">Family created</p>
      <h2>Invite can be completed later</h2>
      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
      <p>Your family is ready. Generate Parent B's code from Settings when the invitation service is available.</p>
      <button class="primary" type="button" on:click={finish}>Continue to log</button>
    {:else}
      <button class="text-button back" type="button" on:click={() => (mode = 'choose')}>← Back</button>
      <p class="eyebrow">{mode === 'create' ? 'Parent A · family creator' : 'Parent B · joining parent'}</p>

      <form on:submit|preventDefault={mode === 'create' ? createFamily : preview ? joinFamily : checkCode}>
        <fieldset>
          <legend>Parent profile</legend>
          <label>
            Display name
            <input bind:value={displayName} autocomplete="name" maxlength="60" required />
          </label>
          <label>
            Parent type
            <select bind:value={parentType}>
              <option value="mother">Mother</option>
              <option value="father">Father</option>
              <option value="parent_guardian">Parent / Guardian</option>
            </select>
          </label>
        </fieldset>

        {#if mode === 'create'}
          <fieldset>
            <legend>Baby and family</legend>
            <label>
              Baby name or nickname
              <input bind:value={babyNickname} maxlength="60" required />
            </label>
            <label>
              Date of birth <span class="optional">Optional</span>
              <input bind:value={birthDate} type="date" />
            </label>
            <label>
              Household timezone
              <input bind:value={timezone} required />
            </label>
            <label>
              Parent B email <span class="optional">Optional now</span>
              <input bind:value={invitedEmail} type="email" autocomplete="email" />
            </label>
            <p class="hint">Adding the email binds the five-character code to Parent B's verified account.</p>
          </fieldset>
        {:else if !preview}
          <fieldset>
            <legend>Family code</legend>
            <label>
              Five-character code
              <input
                value={code}
                on:input={(event) => (code = (event.currentTarget as HTMLInputElement).value.toUpperCase())}
                maxlength="7"
                autocomplete="one-time-code"
                autocapitalize="characters"
                placeholder="7K3QP"
                required
              />
            </label>
          </fieldset>
        {:else}
          <section class="confirm-box">
            <p class="eyebrow">Confirm family</p>
            <h2>Join {preview.babyNickname}'s family?</h2>
            <p>Created by {preview.parentName}.</p>
          </section>
        {/if}

        {#if error}<p class="field-error" role="alert">{error}</p>{/if}
        <button class="primary" type="submit" disabled={busy || (mode === 'join' && !preview && normalizedCode().length !== 5)}>
          {busy ? 'Please wait…' : mode === 'create' ? 'Create family' : preview ? 'Join family' : 'Review family'}
        </button>
      </form>
    {/if}
  </section>
</main>
