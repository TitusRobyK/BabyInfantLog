<script lang="ts">
  import { generateInvite } from '../lib/api'
  import { supabase } from '../lib/supabase'
  import type { AppContext, VolumeUnit } from '../lib/types'

  export let context: AppContext
  export let pendingCount: number
  export let onUpdated: () => Promise<void>
  export let onSignOut: () => Promise<void>

  let invitedEmail = ''
  let generatedCode = ''
  let expiresAt = ''
  let showPump = context.profile?.show_pump_action ?? false
  let unit: VolumeUnit = context.profile?.volume_unit ?? 'ml'
  let busy = false
  let error = ''

  $: canInvite = context.members.length < 2

  async function savePreferences() {
    if (!context.profile) return
    busy = true
    const { error: updateError } = await supabase
      .from('parent_profiles')
      .update({ show_pump_action: showPump, volume_unit: unit })
      .eq('user_id', context.profile.user_id)
    busy = false
    if (updateError) error = updateError.message
    else await onUpdated()
  }

  async function createInvite() {
    error = ''
    busy = true
    try {
      const invite = await generateInvite(invitedEmail)
      generatedCode = invite.code
      expiresAt = invite.expiresAt
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The code could not be generated.'
    } finally {
      busy = false
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(generatedCode)
  }
</script>

<section class="screen" aria-labelledby="settings-title">
  <header class="screen-header"><div><p class="eyebrow">Account</p><h1 id="settings-title">Settings</h1></div></header>

  <section class="settings-section">
    <h2>Parent profile</h2>
    <p>{context.profile?.display_name} · {context.profile?.parent_type.replace('_', ' / ')}</p>
    <form class="settings-form" on:submit|preventDefault={savePreferences}>
      <label class="check-row"><input bind:checked={showPump} type="checkbox" /> Show Pump action</label>
      <label>Volume unit <select bind:value={unit}><option value="ml">Milliliters</option><option value="fl_oz">Fluid ounces</option></select></label>
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
      </form>
      {#if generatedCode}
        <output class="invite-code small-code">{generatedCode}</output>
        <p>Expires {new Date(expiresAt).toLocaleString()}.</p>
        <button type="button" on:click={copyCode}>Copy code</button>
      {/if}
    {/if}
  </section>

  <section class="settings-section">
    <h2>Sync</h2>
    <p>{pendingCount ? `${pendingCount} events waiting to sync.` : 'Everything is synced.'}</p>
  </section>

  {#if error}<p class="field-error" role="alert">{error}</p>{/if}
  <button class="danger" type="button" on:click={onSignOut}>Log out</button>
</section>
