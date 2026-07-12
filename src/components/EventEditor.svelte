<script lang="ts">
  import type { CareEvent, EventDetails, VolumeUnit } from '../lib/types'
  import { convertVolume, FEED_MAX_ML, pumpSliderConfig, volumeInMilliliters } from '../lib/volume'

  export let event: CareEvent
  export let defaultUnit: VolumeUnit
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
  let unit: VolumeUnit = details.unit ?? defaultUnit
  let amount = event.event_type === 'feed'
    ? details.amount_ml ?? 0
    : details.amount ?? (details.amount_ml ? convertVolume(details.amount_ml, 'ml', unit) : 0)
  let pumpRange = pumpSliderConfig(unit)
  let pumpMax = Math.max(pumpRange.max, amount)
  let busy = false
  let error = ''

  $: amountLabel = amount > 0
    ? `${unit === 'fl_oz' && event.event_type === 'pump' ? Number(amount.toFixed(2)) : Math.round(amount)} ${event.event_type === 'feed' || unit === 'ml' ? 'ml' : 'fl oz'}`
    : 'Not recorded'

  async function save() {
    busy = true
    error = ''
    try {
      if (event.event_type === 'pump' && endedAt && new Date(endedAt).getTime() <= new Date(occurredAt).getTime()) {
        throw new Error('End time must be after start time.')
      }
      if (event.event_type === 'feed' && amount > 0) {
        details.amount = amount
        details.unit = 'ml'
        details.amount_ml = amount
      } else if (event.event_type === 'feed') {
        delete details.amount
        delete details.unit
        delete details.amount_ml
      } else if (event.event_type === 'pump' && amount > 0) {
        details.amount = amount
        details.unit = unit
        details.amount_ml = volumeInMilliliters(amount, unit)
      } else if (event.event_type === 'pump') {
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

  function changePumpUnit(nextUnit: VolumeUnit) {
    if (nextUnit === unit) return
    amount = convertVolume(amount, unit, nextUnit)
    unit = nextUnit
    pumpRange = pumpSliderConfig(unit)
    pumpMax = Math.max(pumpRange.max, amount)
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
      <h2 id="edit-title">{event.event_type === 'feed' ? 'Feed details' : event.event_type === 'pump' ? 'Pump details' : `Edit ${event.event_type.replace('_', ' ')}`}</h2>
      <button class="text-button" type="button" on:click={onClose}>Close</button>
    </header>
    <form on:submit|preventDefault={save}>
      {#if event.event_type === 'feed'}
        <p class="hint details-saved-note">The feed is already saved. Add details only when they are useful.</p>
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
        <label>Size <select bind:value={details.size}><option value={undefined}>Not recorded</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      {:else if event.event_type === 'diaper_check'}
        <label>Outcome <select bind:value={details.outcome}><option value={undefined}>Not recorded</option><option value="dry">Dry</option><option value="wet">Wet</option><option value="soiled">Soiled</option><option value="mixed">Mixed</option><option value="rash">Rash noticed</option></select></label>
      {:else if event.event_type === 'feed'}
        <label>Milk type <select bind:value={details.feed_type}><option value={undefined}>Not recorded</option><option value="breast_milk">Breast milk</option><option value="formula">Formula</option><option value="mixed">Mixed</option></select></label>
        <div class="amount-field">
          <div class="amount-heading"><label for="feed-amount">Amount consumed <span class="optional">Optional</span></label><output for="feed-amount">{amountLabel}</output></div>
          <input id="feed-amount" class="amount-slider" bind:value={amount} type="range" min="0" max={FEED_MAX_ML} step="1" aria-valuetext={amountLabel} />
          <div class="amount-scale" aria-hidden="true"><span>Not recorded</span><span>{FEED_MAX_ML} ml</span></div>
        </div>
      {:else if event.event_type === 'pump'}
        <fieldset class="unit-choice">
          <legend>Unit</legend>
          <div class="unit-segmented">
            <label><input type="radio" name="pump-unit" value="ml" checked={unit === 'ml'} on:change={() => changePumpUnit('ml')} /><span>ml</span></label>
            <label><input type="radio" name="pump-unit" value="fl_oz" checked={unit === 'fl_oz'} on:change={() => changePumpUnit('fl_oz')} /><span>fl oz</span></label>
          </div>
        </fieldset>
        <div class="amount-field">
          <div class="amount-heading"><label for="pump-amount">Amount pumped <span class="optional">Optional</span></label><output for="pump-amount">{amountLabel}</output></div>
          <input id="pump-amount" class="amount-slider" bind:value={amount} type="range" min="0" max={pumpMax} step={pumpRange.step} aria-valuetext={amountLabel} />
          <div class="amount-scale" aria-hidden="true"><span>Not recorded</span><span>{pumpMax} {unit === 'ml' ? 'ml' : 'fl oz'}</span></div>
        </div>
        <label>Side <select bind:value={details.side}><option value={undefined}>Not recorded</option><option value="left">Left</option><option value="right">Right</option><option value="both">Both</option></select></label>
      {/if}

      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : event.event_type === 'feed' ? 'Save details' : 'Save changes'}</button>
      {#if event.event_type === 'feed'}
        <button type="button" disabled={busy} on:click={saveWithoutAmount}>Save without amount</button>
      {/if}
      <button class="danger" type="button" disabled={busy} on:click={remove}>Remove event</button>
    </form>
  </div>
</div>
