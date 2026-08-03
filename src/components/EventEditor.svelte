<script lang="ts">
  import { POOP_COLORS } from '../lib/actionMeta'
  import type { CareEvent, EventDetails, VolumeUnit } from '../lib/types'
  import {
    canonicalVolumeMl,
    DEFAULT_VOLUME_MAX_ML,
    formatVolume,
    volumeEntrySliderConfig,
    volumeToDisplay,
    volumeToMilliliters,
  } from '../lib/volume'

  export let event: CareEvent
  export let defaultUnit: VolumeUnit
  export let volumeMaxMl = DEFAULT_VOLUME_MAX_ML
  export let onClose: () => void
  export let onSave: (event: CareEvent, occurredAt: string, details: EventDetails, endedAt?: string | null) => Promise<void>
  export let onRemove: (event: CareEvent) => Promise<void>

  function localDateTime(value: string) {
    const date = new Date(value)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  }

  let occurredAt = localDateTime(event.occurred_at)
  let endedAt = event.ended_at ? localDateTime(event.ended_at) : ''
  let details: EventDetails = { ...event.details }
  const storedAmountMl = canonicalVolumeMl(details)
  let amount = storedAmountMl === null ? 0 : volumeToDisplay(storedAmountMl, defaultUnit)
  let amountChanged = false
  $: amountRange = volumeEntrySliderConfig(volumeMaxMl, defaultUnit)
  $: amountMax = Math.max(amountRange.max, amount)
  $: abovePreference = storedAmountMl !== null && storedAmountMl > volumeMaxMl
  let busy = false
  let error = ''

  $: selectedPoopColor = POOP_COLORS.find((option) => option.value === details.color)

  $: amountLabel = amount > 0
    ? formatVolume(volumeToMilliliters(Number(amount), defaultUnit), defaultUnit)
    : 'Not recorded'

  async function save() {
    busy = true
    error = ''
    try {
      if (event.event_type === 'pump' && endedAt && new Date(endedAt).getTime() <= new Date(occurredAt).getTime()) {
        throw new Error('End time must be after start time.')
      }
      if ((event.event_type === 'feed' || event.event_type === 'pump') && amount > 0) {
        if (amountChanged || storedAmountMl === null) {
          details.amount = Number(amount)
          details.unit = defaultUnit
          details.amount_ml = volumeToMilliliters(Number(amount), defaultUnit)
        } else {
          details.amount_ml = storedAmountMl
        }
      } else if (event.event_type === 'feed' || event.event_type === 'pump') {
        delete details.amount
        delete details.unit
        delete details.amount_ml
      }
      await onSave(
        event,
        new Date(occurredAt).toISOString(),
        details,
        event.event_type === 'pump' ? (endedAt ? new Date(endedAt).toISOString() : null) : undefined,
      )
      onClose()
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The event could not be updated.'
    } finally {
      busy = false
    }
  }

  async function saveWithoutAmount() {
    amount = 0
    await save()
  }

  function clearPoopDetail(key: 'size' | 'consistency' | 'color') {
    delete details[key]
    details = { ...details }
  }

  async function remove() {
    busy = true
    await onRemove(event)
    busy = false
    onClose()
  }
</script>

<div class="modal-backdrop" role="presentation" on:click|self={onClose}>
  <div class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-title">
    <header class="modal-header">
      <h2 id="edit-title">{event.event_type === 'feed' ? 'Feed details' : event.event_type === 'pump' ? 'Pump details' : event.event_type === 'poop' ? 'Poop details' : `Edit ${event.event_type.replace('_', ' ')}`}</h2>
      <button class="text-button" type="button" on:click={onClose}>Close</button>
    </header>
    <form on:submit|preventDefault={save}>
      {#if event.event_type === 'feed'}
        <p class="hint details-saved-note">The feed is already saved. Add details only when they are useful.</p>
      {:else if event.event_type === 'poop'}
        <p class="hint details-saved-note">The poop is already saved. Add only the details that are useful.</p>
      {:else if event.event_type === 'pump' && event.ended_at}
        <p class="hint details-saved-note">The pump session is saved. Add details or correct the times if needed.</p>
      {/if}
      {#if event.event_type === 'pump'}
        <div class="pump-time-fields">
          <label>Start time <input bind:value={occurredAt} type="datetime-local" required /></label>
          <label>End time <input bind:value={endedAt} type="datetime-local" min={occurredAt} required={Boolean(event.ended_at)} /></label>
        </div>
      {:else}
        <label>Time <input bind:value={occurredAt} type="datetime-local" required /></label>
      {/if}

      {#if event.event_type === 'poop'}
        <fieldset class="detail-choice detail-choice-four">
          <legend class="visually-hidden">Amount</legend>
          <div class="detail-choice-heading">
            <span>Amount</span>
            {#if details.size}<button class="clear-selection" type="button" on:click={() => clearPoopDetail('size')}>Clear selection</button>{/if}
          </div>
          <div class="detail-segmented">
            <label><input type="radio" name="poop-size" value="spotted" bind:group={details.size} /><span>Spotted</span></label>
            <label><input type="radio" name="poop-size" value="small" bind:group={details.size} /><span>Small</span></label>
            <label><input type="radio" name="poop-size" value="medium" bind:group={details.size} /><span>Medium</span></label>
            <label><input type="radio" name="poop-size" value="large" bind:group={details.size} /><span>Large</span></label>
          </div>
          <p class="hint">Spotted means only a trace or smear.</p>
        </fieldset>

        <fieldset class="detail-choice">
          <legend class="visually-hidden">Type</legend>
          <div class="detail-choice-heading">
            <span>Type</span>
            {#if details.consistency}<button class="clear-selection" type="button" on:click={() => clearPoopDetail('consistency')}>Clear selection</button>{/if}
          </div>
          <div class="detail-segmented">
            <label><input type="radio" name="poop-consistency" value="formed" bind:group={details.consistency} /><span>Solid</span></label>
            <label><input type="radio" name="poop-consistency" value="liquid" bind:group={details.consistency} /><span>Liquid</span></label>
          </div>
        </fieldset>

        <fieldset class="poop-color-choice">
          <legend class="visually-hidden">Color</legend>
          <div class="detail-choice-heading">
            <span>Color</span>
            {#if details.color}<button class="clear-selection" type="button" on:click={() => clearPoopDetail('color')}>Clear selection</button>{/if}
          </div>
          <p class="hint">Choose the closest match.</p>
          <div class="poop-color-grid">
            {#each POOP_COLORS as option}
              <label>
                <input type="radio" name="poop-color" value={option.value} bind:group={details.color} />
                <span class="poop-swatch" style={`--poop-swatch: ${option.swatch}`} aria-hidden="true"><i>✓</i></span>
                <span class="poop-color-label">{option.label}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        {#if selectedPoopColor?.attention}
          <p class="poop-attention" role="status" aria-live="polite">{selectedPoopColor.attention}</p>
        {/if}
      {:else if event.event_type === 'diaper_check'}
        <label>Outcome <select bind:value={details.outcome}><option value={undefined}>Not recorded</option><option value="dry">Dry</option><option value="wet">Wet</option><option value="soiled">Soiled</option><option value="mixed">Mixed</option><option value="rash">Rash noticed</option></select></label>
      {:else if event.event_type === 'feed'}
        <label>Milk type <select bind:value={details.feed_type}><option value={undefined}>Not recorded</option><option value="breast_milk">Breast milk</option><option value="formula">Formula</option><option value="mixed">Mixed</option></select></label>
        <div class="amount-field">
          <div class="amount-heading"><label for="feed-amount">Amount consumed <span class="optional">Optional</span></label><output for="feed-amount">{amountLabel}</output></div>
          <input id="feed-amount" class="amount-slider" bind:value={amount} on:input={() => (amountChanged = true)} type="range" min="0" max={amountMax} step={amountRange.step} aria-valuetext={amountLabel} />
          <div class="amount-scale" aria-hidden="true"><span>Not recorded</span><span>{formatVolume(volumeToMilliliters(amountMax, defaultUnit), defaultUnit)}</span></div>
          {#if abovePreference}<p class="hint">This entry is above your current slider maximum.</p>{/if}
        </div>
      {:else if event.event_type === 'pump'}
        <div class="amount-field">
          <div class="amount-heading"><label for="pump-amount">Amount pumped <span class="optional">Optional</span></label><output for="pump-amount">{amountLabel}</output></div>
          <input id="pump-amount" class="amount-slider" bind:value={amount} on:input={() => (amountChanged = true)} type="range" min="0" max={amountMax} step={amountRange.step} aria-valuetext={amountLabel} />
          <div class="amount-scale" aria-hidden="true"><span>Not recorded</span><span>{formatVolume(volumeToMilliliters(amountMax, defaultUnit), defaultUnit)}</span></div>
          {#if abovePreference}<p class="hint">This entry is above your current slider maximum.</p>{/if}
        </div>
        <label>Side <select bind:value={details.side}><option value={undefined}>Not recorded</option><option value="left">Left</option><option value="right">Right</option><option value="both">Both</option></select></label>
      {/if}

      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : event.event_type === 'feed' || event.event_type === 'poop' ? 'Save details' : 'Save changes'}</button>
      {#if event.event_type === 'feed'}
        <button type="button" disabled={busy} on:click={saveWithoutAmount}>Save without amount</button>
      {/if}
      <button class="danger" type="button" disabled={busy} on:click={remove}>Remove event</button>
    </form>
  </div>
</div>
