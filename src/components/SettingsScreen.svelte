<script lang="ts">
  import InviteCodePanel from './InviteCodePanel.svelte'
  import { emailInvite, generateInvite, InviteEmailCooldownError, type EmailDeliveryStatus } from '../lib/api'
  import { supabase } from '../lib/supabase'
  import type { AppContext, VolumeUnit } from '../lib/types'

  export let context: AppContext
  export let pendingCount: number
  export let onUpdated: () => Promise<void>
  export let onSignOut: () => Promise<void>

  let invitedEmail = ''
  let generatedEmail = ''
  let generatedCode = ''
  let expiresAt = ''
  let cooldownUntil = ''
  let deliveryStatus: EmailDeliveryStatus = 'not_sent'
  let showPump = context.profile?.show_pump_action ?? false
  let unit: VolumeUnit = context.profile?.volume_unit ?? 'ml'
  let busy = false
  let emailBusy = false
  let preferenceError = ''
  let inviteError = ''

  $: canInvite = context.members.length < 2

  async function savePreferences() {
    if (!context.profile) return
    preferenceError = ''
    busy = true
    const { error: updateError } = await supabase
      .from('parent_profiles')
      .update({ show_pump_action: showPump, volume_unit: unit })
      .eq('user_id', context.profile.user_id)
    busy = false
    if (updateError) preferenceError = updateError.message
    else await onUpdated()
  }

  async function createInvite() {
    inviteError = ''
    busy = true
    try {
      const invite = await generateInvite(invitedEmail)
      generatedCode = invite.code
      generatedEmail = invitedEmail.trim()
      expiresAt = invite.expiresAt
      deliveryStatus = invite.emailDelivery.status
      cooldownUntil = invite.emailDelivery.cooldownUntil ?? ''
    } catch (caught) {
      inviteError = caught instanceof Error ? caught.message : 'The code could not be generated.'
    } finally {
      busy = false
    }
  }

  async function sendInvitationEmail() {
    inviteError = ''
    emailBusy = true
    try {
      const result = await emailInvite(generatedCode)
      deliveryStatus = result.emailDelivery.status
      cooldownUntil = result.emailDelivery.cooldownUntil ?? ''
    } catch (caught) {
      if (caught instanceof InviteEmailCooldownError) {
        deliveryStatus = 'sent'
        cooldownUntil = caught.cooldownUntil
      } else {
        inviteError = caught instanceof Error ? caught.message : 'The email could not be sent.'
      }
    } finally {
      emailBusy = false
    }
  }
</script>

<section class="screen" aria-labelledby="settings-title">
  <header class="screen-header"><div><p class="eyebrow">Account</p><h1 id="settings-title">Settings</h1></div></header>

  <section class="settings-section">
    <h2>Parent profile</h2>
    <p>{context.profile?.display_name} · {context.profile?.parent_type.replace('_', ' / ')}</p>
    <form class="settings-form" on:submit|preventDefault={savePreferences}>
      <label class="check-row"><input bind:checked={showPump} type="checkbox" /> Show Pump action</label>
      <fieldset class="unit-choice">
        <legend>Volume unit</legend>
        <div class="unit-segmented">
          <label><input type="radio" name="preferred-volume-unit" bind:group={unit} value="ml" /><span>Milliliters</span></label>
          <label><input type="radio" name="preferred-volume-unit" bind:group={unit} value="fl_oz" /><span>Fluid ounces</span></label>
        </div>
      </fieldset>
      {#if preferenceError}<p class="field-error" role="alert">{preferenceError}</p>{/if}
      <button class="settings-save" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save preferences'}</button>
    </form>
  </section>

  <section class="settings-section">
    <h2>Family</h2>
    <p>{context.child?.nickname} · {context.household?.timezone}</p>
    <ul class="plain-list">
      {#each context.members as member}<li>{member.profile?.display_name ?? 'Parent'} · {member.profile?.parent_type.replace('_', ' / ')}</li>{/each}
    </ul>

    {#if canInvite}
      <form class="settings-form" on:submit|preventDefault={createInvite}>
        <label>Parent B email <input bind:value={invitedEmail} type="email" required /></label>
        <button type="submit" disabled={busy}>Generate family code</button>
        {#if inviteError}<p class="field-error" role="alert">{inviteError}</p>{/if}
      </form>
      {#if generatedCode}
        <InviteCodePanel
          code={generatedCode}
          {expiresAt}
          email={generatedEmail}
          {deliveryStatus}
          {cooldownUntil}
          busy={emailBusy}
          compact
          onEmail={sendInvitationEmail}
        />
      {/if}
    {/if}
  </section>

  <section class="settings-section">
    <h2>Sync</h2>
    <p>{pendingCount ? `${pendingCount} events waiting to sync.` : 'Everything is synced.'}</p>
  </section>

  <button class="danger logout-button" type="button" on:click={onSignOut}>Log out</button>
</section>
