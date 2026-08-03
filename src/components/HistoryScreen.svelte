<script lang="ts">
  import { actionLabel, poopDetailsLabel } from '../lib/actionMeta'
  import { formatDate, formatDuration, formatTime, localDateKey, durationMinutes, netSleepMinutes } from '../lib/time'
  import type { CareEvent, EventType, HouseholdMember, ParentProfile, SleepInterruption, WeightMeasurement } from '../lib/types'
  import { canonicalVolumeMl, formatVolume } from '../lib/volume'
  import { formatWeight } from '../lib/weight'

  export let events: CareEvent[]
  export let measurements: WeightMeasurement[] = []
  export let interruptions: SleepInterruption[]
  export let timezone: string
  export let profile: ParentProfile
  export let members: HouseholdMember[]
  export let onEdit: (event: CareEvent) => void
  export let onEditWeight: (measurement: WeightMeasurement) => void = () => undefined

  let filter: 'all' | EventType | 'weight' = 'all'
  let selectedDate = localDateKey(new Date().toISOString(), timezone)
  const today = localDateKey(new Date().toISOString(), timezone)

  $: filtered = events.filter(
    (event) =>
      !event.deleted_at &&
      localDateKey(event.occurred_at, timezone) === selectedDate &&
      filter !== 'weight' &&
      (filter === 'all' || event.event_type === filter),
  )
  $: filteredWeights = measurements.filter(
    (measurement) =>
      !measurement.deleted_at &&
      measurement.measured_on === selectedDate &&
      (filter === 'all' || filter === 'weight'),
  )

  function moveDate(days: number) {
    const date = new Date(`${selectedDate}T12:00:00`)
    date.setDate(date.getDate() + days)
    selectedDate = date.toISOString().slice(0, 10)
  }

  function actorName(userId: string) {
    if (userId === profile.user_id) return 'You'
    return members.find((member) => member.user_id === userId)?.profile?.display_name ?? 'Other parent'
  }

  function interruptionCount(eventId: string) {
    return interruptions.filter((interruption) => interruption.sleep_event_id === eventId && !interruption.deleted_at).length
  }

  function volumeLabel(event: CareEvent): string {
    const amountMl = canonicalVolumeMl(event.details)
    return amountMl === null ? '' : formatVolume(amountMl, profile.volume_unit)
  }
</script>

<section class="screen" aria-labelledby="history-title">
  <header class="screen-header">
    <div><p class="eyebrow">Shared record</p><h1 id="history-title">History</h1></div>
  </header>

  <div class="date-nav">
    <button class="previous-day" type="button" aria-label="Previous day" on:click={() => moveDate(-1)}><span aria-hidden="true">←</span> Previous</button>
    <strong>{selectedDate === today ? 'Today' : formatDate(`${selectedDate}T12:00:00`, timezone)}</strong>
    <button class="next-day" type="button" aria-label="Next day" disabled={selectedDate >= today} on:click={() => moveDate(1)}>Next <span aria-hidden="true">→</span></button>
  </div>

  <label class="filter-label">Action
    <select bind:value={filter}>
      <option value="all">All</option>
      <optgroup label="Care actions">
        <option value="poop">Poop</option>
        <option value="pee">Pee</option>
        <option value="feed">Feed</option>
        <option value="burp">Burp</option>
        <option value="sleep">Sleep</option>
        <option value="diaper_check">Diaper check</option>
        <option value="hiccups">Hiccups</option>
        <option value="pump">Pump</option>
      </optgroup>
      <optgroup label="Measurements"><option value="weight">Weight</option></optgroup>
    </select>
  </label>

  {#if filteredWeights.length}
    <section class="history-measurements" aria-labelledby="history-measurements-title">
      <h2 id="history-measurements-title">Measurements</h2>
      <ul class="event-list history-list">
        {#each filteredWeights as measurement (measurement.id)}
          <li>
            <button class="event-row" type="button" on:click={() => onEditWeight(measurement)}>
              <span class="event-main">
                <strong>Weight</strong>
                <small>{actorName(measurement.created_by)}{measurement.updated_at !== measurement.recorded_at ? ' · Edited' : ''}</small>
              </span>
              <span class="event-meta">
                <strong>{formatWeight(measurement.weight_grams, profile.weight_unit)}</strong>
                {#if measurement.sync_status === 'offline'}<small>Waiting to sync</small>{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if filtered.length}
    <ul class="event-list history-list">
      {#each filtered as event (event.id)}
        <li>
          <button class="event-row" type="button" on:click={() => onEdit(event)}>
            <span class="event-main">
              <strong>{actionLabel(event.event_type)}</strong>
              <small>{actorName(event.created_by)}{event.updated_at !== event.recorded_at ? ' · Edited' : ''}</small>
            </span>
            <span class="event-meta">
              <time datetime={event.occurred_at}>{formatTime(event.occurred_at, timezone)}</time>
              {#if event.event_type === 'sleep' && event.ended_at}
                <small>{formatDuration(netSleepMinutes(event, interruptions))}{interruptionCount(event.id) ? ` · ${interruptionCount(event.id)} interruption${interruptionCount(event.id) === 1 ? '' : 's'}` : ''}</small>
              {:else if event.event_type === 'pump' && event.ended_at}
                <small>{formatDuration(durationMinutes(event.occurred_at, event.ended_at))}{volumeLabel(event) ? ` · ${volumeLabel(event)}` : ''}</small>
              {:else if event.ended_at}
                <small>{formatDuration(durationMinutes(event.occurred_at, event.ended_at))}</small>
              {:else if event.event_type === 'feed' && volumeLabel(event)}
                <small>{volumeLabel(event)}</small>
              {:else if event.event_type === 'poop' && poopDetailsLabel(event.details)}
                <small>{poopDetailsLabel(event.details)}</small>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if !filteredWeights.length}
    <p class="empty-state">No entries recorded for this day.</p>
  {/if}
</section>
