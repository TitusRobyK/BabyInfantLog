<script lang="ts">
  import { durationMinutes, formatDuration, formatTime, localDateKey, netSleepMinutes, startOfRange, timeOfDayPercent } from '../lib/time'
  import type { CareEvent, DailySummary, EventType, SleepInterruption } from '../lib/types'

  export let events: CareEvent[]
  export let interruptions: SleepInterruption[]
  export let summaries: DailySummary[]
  export let timezone: string

  let action: EventType = 'feed'
  let range: 'day' | 'week' | 'month' = 'day'

  $: rangeStart = startOfRange(range)
  $: rangeEnd = new Date()
  $: sessionAction = action === 'sleep' || action === 'pump'
  $: selected = events.filter((event) => {
    if (event.deleted_at || event.event_type !== action) return false
    const eventStart = new Date(event.occurred_at)
    if (!sessionAction) return eventStart >= rangeStart && eventStart <= rangeEnd
    const eventEnd = new Date(event.ended_at ?? rangeEnd)
    return eventStart <= rangeEnd && eventEnd >= rangeStart
  })
  $: dayItems = [...selected].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
  $: grouped = groupEvents(selected)
  $: maxValue = Math.max(1, ...grouped.map((item) => item.value))
  $: totalDuration = selected.reduce((total, event) => total + sessionMinutes(event), 0)
  $: recordedVolume = selected.reduce((total, event) => total + (event.details.amount_ml ?? 0), 0)
  $: selectedInterruptions = action === 'sleep'
    ? interruptions.filter((interruption) => selected.some((event) => event.id === interruption.sleep_event_id) && !interruption.deleted_at)
    : []

  function sessionMinutes(event: CareEvent) {
    const start = new Date(Math.max(new Date(event.occurred_at).getTime(), rangeStart.getTime())).toISOString()
    const end = new Date(Math.min(new Date(event.ended_at ?? rangeEnd).getTime(), rangeEnd.getTime())).toISOString()
    return event.event_type === 'sleep'
      ? netSleepMinutes(event, interruptions, start, end)
      : durationMinutes(start, end)
  }

  function groupEvents(items: CareEvent[]) {
    const map = new Map<string, { value: number; count: number }>()
    for (const event of items) {
      const key = localDateKey(event.occurred_at, timezone)
      const current = map.get(key) ?? { value: 0, count: 0 }
      current.count += 1
      current.value += sessionAction ? sessionMinutes(event) : 1
      map.set(key, current)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, ...value }))
  }

  function label(type: EventType) {
    return type === 'diaper_check' ? 'Diaper check' : type.charAt(0).toUpperCase() + type.slice(1)
  }

  function rangeLabel() {
    if (range === 'day') return 'Today'
    if (range === 'week') return 'This week'
    return 'This month'
  }

  function chartExplanation() {
    if (range === 'day' && sessionAction) return `Blocks show when ${label(action).toLowerCase()} sessions happened. Exact times are listed below.`
    if (range === 'day') return `Dots show when each ${label(action).toLowerCase()} was logged. Exact times are listed below.`
    return `Each row is one day. Longer bars mean ${sessionAction ? 'more total time' : 'more events'}; the exact total is shown at the right.`
  }

  function sessionStartPercent(event: CareEvent) {
    return new Date(event.occurred_at) < rangeStart ? 0 : timeOfDayPercent(event.occurred_at, timezone)
  }

  function sessionEndPercent(event: CareEvent) {
    const end = event.ended_at ? new Date(event.ended_at) : rangeEnd
    return end > rangeEnd ? timeOfDayPercent(rangeEnd.toISOString(), timezone) : timeOfDayPercent(end.toISOString(), timezone)
  }

  function sessionWidthPercent(event: CareEvent) {
    return Math.max(1, sessionEndPercent(event) - sessionStartPercent(event))
  }

  function dailyValue(item: { value: number; count: number }) {
    return sessionAction ? formatDuration(item.value) : `${item.count} ${item.count === 1 ? 'event' : 'events'}`
  }

  function shortDate(date: string) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${date}T12:00:00Z`))
  }

  function eventTimeLabel(event: CareEvent) {
    if (!sessionAction) return formatTime(event.occurred_at, timezone)
    return `${formatTime(event.occurred_at, timezone)}–${event.ended_at ? formatTime(event.ended_at, timezone) : 'ongoing'}`
  }

  function eventValueLabel(event: CareEvent) {
    if (sessionAction) return formatDuration(sessionMinutes(event))
    if (event.event_type === 'feed' && event.details.amount_ml) return `${event.details.amount_ml} ml`
    return 'Recorded'
  }
</script>

<section class="screen" aria-labelledby="trends-title">
  <header class="screen-header"><div><p class="eyebrow">Patterns</p><h1 id="trends-title">Trends</h1></div></header>

  {#if summaries[0]}
    <section class="brief" aria-labelledby="brief-title">
      <p class="eyebrow">Latest 8 PM brief</p>
      <h2 id="brief-title">Last 24 hours</h2>
      <ul>
        {#each Object.values(summaries[0].metrics?.sentences ?? {}) as sentence}
          <li>{sentence}</li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="trend-controls">
    <label>Action
      <select bind:value={action}>
        <option value="poop">Poop</option><option value="pee">Pee</option><option value="feed">Feed</option>
        <option value="burp">Burp</option><option value="sleep">Sleep</option><option value="diaper_check">Diaper check</option><option value="pump">Pump</option>
      </select>
    </label>
    <div class="segmented" aria-label="Date range">
      <button class:active={range === 'day'} type="button" on:click={() => (range = 'day')}>Day</button>
      <button class:active={range === 'week'} type="button" on:click={() => (range = 'week')}>Week</button>
      <button class:active={range === 'month'} type="button" on:click={() => (range = 'month')}>Month</button>
    </div>
  </div>

  <section class="metric-summary">
    <strong>{label(action)} · {rangeLabel()}</strong>
    {#if sessionAction}
      <span>{selected.length} {selected.length === 1 ? 'session' : 'sessions'} · {formatDuration(totalDuration)}</span>
      {#if action === 'sleep' && selectedInterruptions.length}<span>{selectedInterruptions.length} interruption{selectedInterruptions.length === 1 ? '' : 's'}</span>{/if}
      {#if action === 'pump' && recordedVolume}<span>{Math.round(recordedVolume)} ml recorded</span>{/if}
    {:else}
      <span>{selected.length} {selected.length === 1 ? 'event' : 'events'}</span>
      {#if action === 'feed' && recordedVolume}<span>{Math.round(recordedVolume)} ml recorded</span>{/if}
    {/if}
  </section>

  <p class="chart-explanation">{chartExplanation()}</p>

  {#if range === 'day' && selected.length}
    <section class="day-chart" aria-label={`${label(action)} today`}>
      <div class="day-axis" aria-hidden="true"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
      <div class="day-track" aria-hidden="true">
        <i style="left: 25%"></i><i style="left: 50%"></i><i style="left: 75%"></i>
        {#each dayItems as event (event.id)}
          {#if sessionAction}
            <span class="day-session" style={`left: ${sessionStartPercent(event)}%; width: ${sessionWidthPercent(event)}%`}></span>
          {:else}
            <span class="day-point" style={`left: ${timeOfDayPercent(event.occurred_at, timezone)}%`}></span>
          {/if}
        {/each}
      </div>
    </section>
    <ul class="chart-detail-list">
      {#each dayItems as event (event.id)}
        <li><time datetime={event.occurred_at}>{eventTimeLabel(event)}</time><strong>{eventValueLabel(event)}</strong></li>
      {/each}
    </ul>
  {:else if range !== 'day' && grouped.length}
    <div class="daily-chart" aria-label={`${label(action)} by day`}>
      {#each grouped as item}
        <div class="daily-row">
          <time datetime={item.date}>{shortDate(item.date)}</time>
          <div class="daily-bar-track" aria-hidden="true"><span style={`width: ${Math.max(3, (item.value / maxValue) * 100)}%`}></span></div>
          <strong>{dailyValue(item)}</strong>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty-state">No {label(action).toLowerCase()} recorded for {rangeLabel().toLowerCase()}.</p>
  {/if}
</section>
