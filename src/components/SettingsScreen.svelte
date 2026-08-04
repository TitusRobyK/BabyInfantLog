<script lang="ts">
  import InviteCodePanel from './InviteCodePanel.svelte'
  import { emailInvite, generateInvite, InviteEmailCooldownError, type EmailDeliveryStatus } from '../lib/api'
  import { supabase } from '../lib/supabase'
  import type { AppContext, VolumeUnit, WeightUnit } from '../lib/types'
  import {
    DEFAULT_VOLUME_MAX_ML,
    formatVolume,
    VOLUME_MAX_SETTING_CONFIG,
  } from '../lib/volume'

  export let context: AppContext
  export let pendingCount: number
  export let onUpdated: () => Promise<void>
  export let onSignOut: () => Promise<void>
  export let amountSliderVibrationSupported = false
  export let amountSliderVibrationEnabled = false
  export let onAmountSliderVibrationUpdated: (enabled: boolean) => boolean = () => true

  let invitedEmail = ''
  let generatedEmail = ''
  let generatedCode = ''
  let expiresAt = ''
  let cooldownUntil = ''
  let deliveryStatus: EmailDeliveryStatus = 'not_sent'
  let savedShowPump = context.profile?.show_pump_action ?? false
  let savedUnit: VolumeUnit = context.profile?.volume_unit ?? 'ml'
  let savedVolumeMaxMl = context.profile?.volume_slider_max_ml ?? DEFAULT_VOLUME_MAX_ML
  let savedWeightUnit: WeightUnit = context.profile?.weight_unit ?? 'lb_oz'
  let showPump = savedShowPump
  let unit: VolumeUnit = savedUnit
  let volumeMaxMl = savedVolumeMaxMl
  let weightUnit: WeightUnit = savedWeightUnit
  let savedAmountSliderVibration = amountSliderVibrationEnabled
  let amountSliderVibration = savedAmountSliderVibration
  let volumeHelpOpen = false
  let vibrationHelpOpen = false
  let busy = false
  let emailBusy = false
  let preferenceError = ''
  let inviteError = ''

  $: canInvite = context.members.length < 2
  $: profilePreferencesChanged =
    showPump !== savedShowPump ||
    unit !== savedUnit ||
    Number(volumeMaxMl) !== savedVolumeMaxMl ||
    weightUnit !== savedWeightUnit
  $: vibrationPreferenceChanged = amountSliderVibrationSupported && amountSliderVibration !== savedAmountSliderVibration
  $: preferencesChanged = profilePreferencesChanged || vibrationPreferenceChanged

  async function savePreferences() {
    if (!context.profile || !preferencesChanged || busy) return
    preferenceError = ''
    busy = true
    const shouldUpdateProfile = profilePreferencesChanged
    const shouldUpdateVibration = vibrationPreferenceChanged
    if (shouldUpdateProfile) {
      const { error: updateError } = await supabase
        .from('parent_profiles')
        .update({
          show_pump_action: showPump,
          volume_unit: unit,
          volume_slider_max_ml: Number(volumeMaxMl),
          weight_unit: weightUnit,
        })
        .eq('user_id', context.profile.user_id)
      if (updateError) {
        busy = false
        preferenceError = updateError.message
        return
      }
      savedShowPump = showPump
      savedUnit = unit
      savedVolumeMaxMl = Number(volumeMaxMl)
      savedWeightUnit = weightUnit
    }

    if (shouldUpdateVibration) {
      if (!onAmountSliderVibrationUpdated(amountSliderVibration)) {
        busy = false
        preferenceError = 'Slider vibration could not be saved on this device.'
        return
      }
      savedAmountSliderVibration = amountSliderVibration
    }

    busy = false
    if (shouldUpdateProfile) await onUpdated()
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
          <label><input type="radio" name="preferred-volume-unit" bind:group={unit} value="fl_oz" /><span>Fluid ounces (fl oz)</span></label>
        </div>
      </fieldset>
      <div class="amount-field settings-amount-field">
        <div class="amount-heading">
          <div class="settings-label-with-help">
            <label for="volume-slider-maximum">Maximum amount on Feed and Pump sliders</label>
            <span class="help-tooltip" data-open={volumeHelpOpen}>
              <button
                class="help-tooltip-trigger"
                type="button"
                aria-label="About the Feed and Pump maximum"
                aria-expanded={volumeHelpOpen}
                aria-describedby="volume-maximum-help"
                on:click={() => (volumeHelpOpen = !volumeHelpOpen)}
                on:blur={() => (volumeHelpOpen = false)}
              ><span aria-hidden="true">i</span></button>
              <span id="volume-maximum-help" class="help-tooltip-content" role="tooltip">Used for both Feed and Pump. Existing entries won’t change.</span>
            </span>
          </div>
          <output for="volume-slider-maximum">{formatVolume(Number(volumeMaxMl), unit)}</output>
        </div>
        <input
          id="volume-slider-maximum"
          class="amount-slider"
          bind:value={volumeMaxMl}
          type="range"
          min={VOLUME_MAX_SETTING_CONFIG.min}
          max={VOLUME_MAX_SETTING_CONFIG.max}
          step={VOLUME_MAX_SETTING_CONFIG.step}
          aria-valuetext={formatVolume(Number(volumeMaxMl), unit)}
        />
        <div class="amount-scale" aria-hidden="true">
          <span>{formatVolume(VOLUME_MAX_SETTING_CONFIG.min, unit)}</span>
          <span>{formatVolume(VOLUME_MAX_SETTING_CONFIG.max, unit)}</span>
        </div>
      </div>
      {#if amountSliderVibrationSupported}
        <div class="setting-toggle-with-help">
          <label class="check-row"><input bind:checked={amountSliderVibration} type="checkbox" /> Amount slider vibration</label>
          <span class="help-tooltip" data-open={vibrationHelpOpen}>
            <button
              class="help-tooltip-trigger"
              type="button"
              aria-label="About amount slider vibration"
              aria-expanded={vibrationHelpOpen}
              aria-describedby="amount-slider-vibration-help"
              on:click={() => (vibrationHelpOpen = !vibrationHelpOpen)}
              on:blur={() => (vibrationHelpOpen = false)}
            ><span aria-hidden="true">i</span></button>
            <span id="amount-slider-vibration-help" class="help-tooltip-content" role="tooltip">Light vibration with each amount step on supported devices.</span>
          </span>
        </div>
      {/if}
      <fieldset class="unit-choice">
        <legend>Weight unit</legend>
        <div class="unit-segmented">
          <label><input type="radio" name="preferred-weight-unit" bind:group={weightUnit} value="lb_oz" /><span>Pounds + ounces</span></label>
          <label><input type="radio" name="preferred-weight-unit" bind:group={weightUnit} value="kg_g" /><span>Kilograms + grams</span></label>
        </div>
      </fieldset>
      {#if preferenceError}<p class="field-error" role="alert">{preferenceError}</p>{/if}
      <button class="settings-save" type="submit" disabled={busy || !preferencesChanged}>{busy ? 'Saving…' : 'Save preferences'}</button>
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
    <p>{pendingCount ? `${pendingCount} ${pendingCount === 1 ? 'item' : 'items'} waiting to sync.` : 'Everything is synced.'}</p>
  </section>

  <button class="danger logout-button" type="button" on:click={onSignOut}>Log out</button>
</section>
