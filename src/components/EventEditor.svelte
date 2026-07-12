<script lang="ts">
  import type { CareEvent, EventDetails, VolumeUnit } from '../lib/types'

  export let event: CareEvent
  export let defaultUnit: VolumeUnit
  export let onClose: () => void
  export let onSave: (event: CareEvent, occurredAt: string, details: EventDetails) => Promise<void>
  export let onRemove: (event: CareEvent) => Promise<void>

  const initial = new Date(event.occurred_at)
  const localDateTime = new Date(initial.getTime() - initial.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  let occurredAt = localDateTime
  let details: EventDetails = { ...event.details }
  let unit: VolumeUnit = details.unit ?? defaultUnit
  let amount = event.event_type === 'feed'
    ? details.amount_ml?.toString() ?? ''
    : details.amount?.toString() ?? ''
  let busy = false
  let error = ''

  async function save() {
    busy = true
    error = ''
    try {
      if (event.event_type === 'feed' && amount) {
        const numeric = Number(amount)
        details.amount = numeric
        details.unit = 'ml'
        details.amount_ml = numeric
      } else if (event.event_type === 'feed') {
        delete details.amount
        delete details.unit
        delete details.amount_ml
      } else if (event.event_type === 'pump' && amount) {
        const numeric = Number(amount)
        details.amount = numeric
        details.unit = unit
        details.amount_ml = unit === 'fl_oz' ? Math.round(numeric * 29.5735 * 10) / 10 : numeric
      } else if (event.event_type === 'pump') {
        delete details.amount
        delete details.unit
        delete details.amount_ml
      }
      await onSave(event, new Date(occurredAt).toISOString(), details)
      onClose()
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The event could not be updated.'
    } finally {
      busy = false
    }
  }

  async function saveWithoutAmount() {
    amount = ''
    await save()
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
      <h2 id="edit-title">{event.event_type === 'feed' ? 'Feed details' : `Edit ${event.event_type.replace('_', ' ')}`}</h2>
      <button class="text-button" type="button" on:click={onClose}>Close</button>
    </header>
    <form on:submit|preventDefault={save}>
      {#if event.event_type === 'feed'}
        <p class="hint feed-saved-note">The feed is already saved. Add details only when they are useful.</p>
      {/if}
      <label>Time <input bind:value={occurredAt} type="datetime-local" required /></label>

      {#if event.event_type === 'poop'}
        <label>Size <select bind:value={details.size}><option value={undefined}>Not recorded</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      {:else if event.event_type === 'diaper_check'}
        <label>Outcome <select bind:value={details.outcome}><option value={undefined}>Not recorded</option><option value="dry">Dry</option><option value="wet">Wet</option><option value="soiled">Soiled</option><option value="mixed">Mixed</option><option value="rash">Rash noticed</option></select></label>
      {:else if event.event_type === 'feed'}
        <label>Milk type <select bind:value={details.feed_type}><option value={undefined}>Not recorded</option><option value="breast_milk">Breast milk</option><option value="formula">Formula</option><option value="mixed">Mixed</option></select></label>
        <label>Amount consumed <span class="optional">Optional · ml</span><input bind:value={amount} type="number" min="0" step="1" inputmode="numeric" placeholder="Leave blank if unknown" /></label>
      {:else if event.event_type === 'pump'}
        <div class="field-pair"><label>Amount <input bind:value={amount} type="number" min="0" step="0.1" inputmode="decimal" /></label><label>Unit <select bind:value={unit}><option value="ml">ml</option><option value="fl_oz">fl oz</option></select></label></div>
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
