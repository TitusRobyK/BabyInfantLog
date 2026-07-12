<script lang="ts">
  import { formatDate, formatDuration, formatTime, localDateKey, durationMinutes, netSleepMinutes } from '../lib/time'
  import type { CareEvent, EventType, HouseholdMember, ParentProfile, SleepInterruption } from '../lib/types'

  export let events: CareEvent[]
  export let interruptions: SleepInterruption[]
  export let timezone: string
  export let profile: ParentProfile
  export let members: HouseholdMember[]
  export let onEdit: (event: CareEvent) => void

  let filter: 'all' | EventType = 'all'
  let selectedDate = localDateKey(new Date().toISOString(), timezone)

  $: filtered = events.filter(
    (event) =>
      !event.deleted_at &&
      localDateKey(event.occurred_at, timezone) === selectedDate &&
      (filter === 'all' || event.event_type === filter),
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

  function label(type: EventType) {
    return type === 'diaper_check' ? 'Diaper check' : type.charAt(0).toUpperCase() + type.slice(1)
  }

  function interruptionCount(eventId: string) {
    return interruptions.filter((interruption) => interruption.sleep_event_id === eventId && !interruption.deleted_at).length
  }
</script>

<section class="screen" aria-labelledby="history-title">
  <header class="screen-header">
    <div><p class="eyebrow">Shared record</p><h1 id="history-title">History</h1></div>
  </header>

  <div class="date-nav">
    <button type="button" aria-label="Previous day" on:click={() => moveDate(-1)}>←</button>
    <strong>{formatDate(`${selectedDate}T12:00:00`, timezone)}</strong>
    <button type="button" aria-label="Next day" on:click={() => moveDate(1)}>→</button>
  </div>

  <label class="filter-label">Action
    <select bind:value={filter}>
      <option value="all">All</option>
      <option value="poop">Poop</option>
      <option value="pee">Pee</option>
      <option value="feed">Feed</option>
      <option value="burp">Burp</option>
      <option value="sleep">Sleep</option>
      <option value="diaper_check">Diaper check</option>
      <option value="pump">Pump</option>
    </select>
  </label>

  {#if filtered.length}
    <ul class="event-list history-list">
      {#each filtered as event (event.id)}
        <li>
          <button class="event-row" type="button" on:click={() => onEdit(event)}>
            <span class="event-main">
              <strong>{label(event.event_type)}</strong>
              <small>{actorName(event.created_by)}{event.updated_at !== event.recorded_at ? ' · Edited' : ''}</small>
            </span>
            <span class="event-meta">
              <time datetime={event.occurred_at}>{formatTime(event.occurred_at, timezone)}</time>
              {#if event.event_type === 'sleep' && event.ended_at}
                <small>{formatDuration(netSleepMinutes(event, interruptions))}{interruptionCount(event.id) ? ` · ${interruptionCount(event.id)} interruption${interruptionCount(event.id) === 1 ? '' : 's'}` : ''}</small>
              {:else if event.ended_at}
                <small>{formatDuration(durationMinutes(event.occurred_at, event.ended_at))}</small>
              {:else if event.event_type === 'feed' && event.details.amount_ml}
                <small>{event.details.amount_ml} ml</small>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty-state">No events logged for this day.</p>
  {/if}
</section>
