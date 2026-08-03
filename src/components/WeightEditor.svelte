<script lang="ts">
  import { todayDateKey } from '../lib/insights'
  import type { WeightMeasurement, WeightUnit } from '../lib/types'
  import {
    formatWeight,
    gramsToKilogramsAndGrams,
    gramsToPoundsAndOunces,
    kilogramsAndGramsToGrams,
    poundsAndOuncesToGrams,
  } from '../lib/weight'

  export let measurement: WeightMeasurement | null = null
  export let timezone: string
  export let unit: WeightUnit
  export let onClose: () => void
  export let onSave: (measuredOn: string, weightGrams: number) => Promise<void>
  export let onRemove: ((measurement: WeightMeasurement) => Promise<void>) | undefined = undefined

  const today = todayDateKey(timezone)
  const poundsAndOunces = measurement ? gramsToPoundsAndOunces(measurement.weight_grams) : { pounds: 0, ounces: 0 }
  const kilogramsAndGrams = measurement ? gramsToKilogramsAndGrams(measurement.weight_grams) : { kilograms: 0, grams: 0 }

  let measuredOn = measurement?.measured_on ?? today
  let pounds = poundsAndOunces.pounds
  let ounces = poundsAndOunces.ounces
  let kilograms = kilogramsAndGrams.kilograms
  let grams = kilogramsAndGrams.grams
  let busy = false
  let error = ''

  $: previewGrams = safeWeightGrams(pounds, ounces, kilograms, grams, unit)
  $: preview = previewGrams > 0 ? formatWeight(previewGrams, unit) : 'Enter a weight'

  function safeWeightGrams(
    currentPounds: number,
    currentOunces: number,
    currentKilograms: number,
    currentGrams: number,
    currentUnit: WeightUnit,
  ): number {
    try {
      return currentUnit === 'lb_oz'
        ? poundsAndOuncesToGrams(Number(currentPounds || 0), Number(currentOunces || 0))
        : kilogramsAndGramsToGrams(Number(currentKilograms || 0), Number(currentGrams || 0))
    } catch {
      return 0
    }
  }

  async function save() {
    error = ''
    if (!measuredOn || measuredOn > today) {
      error = 'Choose today or an earlier date.'
      return
    }

    let weightGrams: number
    try {
      weightGrams = unit === 'lb_oz'
        ? poundsAndOuncesToGrams(Number(pounds || 0), Number(ounces || 0))
        : kilogramsAndGramsToGrams(Number(kilograms || 0), Number(grams || 0))
      if (weightGrams <= 0) throw new Error('Enter a weight greater than zero.')
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Enter a valid weight.'
      return
    }

    busy = true
    try {
      await onSave(measuredOn, weightGrams)
      onClose()
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The weight could not be saved.'
    } finally {
      busy = false
    }
  }

  async function remove() {
    if (!measurement || !onRemove) return
    busy = true
    error = ''
    try {
      await onRemove(measurement)
      onClose()
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The weight could not be removed.'
    } finally {
      busy = false
    }
  }
</script>

<div class="modal-backdrop" role="presentation" on:click|self={onClose}>
  <div class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="weight-editor-title">
    <header class="modal-header">
      <h2 id="weight-editor-title">{measurement ? 'Edit weight' : 'Record weight'}</h2>
      <button class="text-button" type="button" on:click={onClose}>Close</button>
    </header>

    <form novalidate on:submit|preventDefault={save}>
      <label>Date measured
        <input bind:value={measuredOn} type="date" max={today} required />
      </label>

      {#if unit === 'lb_oz'}
        <fieldset class="weight-fields">
          <legend>Weight</legend>
          <div class="field-pair">
            <label>Pounds
              <input bind:value={pounds} type="number" min="0" step="1" inputmode="numeric" required />
            </label>
            <label>Ounces
              <input bind:value={ounces} type="number" min="0" max="15.9" step="0.1" inputmode="decimal" required />
            </label>
          </div>
        </fieldset>
      {:else}
        <fieldset class="weight-fields">
          <legend>Weight</legend>
          <div class="field-pair">
            <label>Kilograms
              <input bind:value={kilograms} type="number" min="0" step="1" inputmode="numeric" required />
            </label>
            <label>Grams
              <input bind:value={grams} type="number" min="0" max="999" step="1" inputmode="numeric" required />
            </label>
          </div>
        </fieldset>
      {/if}

      <p class="weight-preview" aria-live="polite"><span>Weight to save</span><strong>{preview}</strong></p>
      <p class="hint">Using {unit === 'lb_oz' ? 'pounds + ounces' : 'kilograms + grams'} from Settings.</p>

      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy || previewGrams <= 0}>{busy ? 'Saving…' : 'Save weight'}</button>
      {#if measurement && onRemove}
        <button class="danger" type="button" disabled={busy} on:click={remove}>Remove measurement</button>
      {/if}
    </form>
  </div>
</div>
