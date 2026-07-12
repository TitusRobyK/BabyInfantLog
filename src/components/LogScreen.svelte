<script lang="ts">
  import { onMount } from 'svelte'
  import { durationMinutes, formatDuration, formatElapsed, formatTime, netSleepMinutes } from '../lib/time'
  import type { CareEvent, Child, EventType, HouseholdMember, ParentProfile, SleepInterruption } from '../lib/types'

  export let child: Child
  export let timezone: string
  export let profile: ParentProfile
  export let members: HouseholdMember[]
  export let events: CareEvent[]
  export let interruptions: SleepInterruption[]
  export let online: boolean
  export let busySession = false
  export let busyInterruption = false
  export let onLog: (type: EventType) => void
  export let onSession: (type: 'sleep' | 'pump', state: 'start' | 'end') => void
  export let onInterruption: (state: 'start' | 'end') => void
  export let onEdit: (event: CareEvent) => void

  let now = Date.now()
  let timer: ReturnType<typeof setInterval>
  onMount(() => {
    timer = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(timer)
  })

  $: activeSleep = events.find((event) => event.event_type === 'sleep' && !event.ended_at && !event.deleted_at)
  $: activePump = events.find(
    (event) => event.event_type === 'pump' && event.subject_parent_id === profile.user_id && !event.ended_at && !event.deleted_at,
  )
  $: activeInterruption = activeSleep
    ? interruptions.find((interruption) => interruption.sleep_event_id === activeSleep.id && !interruption.ended_at && !interruption.deleted_at)
    : undefined
  $: recent = events.filter((event) => !event.deleted_at).slice(0, 5)
  $: lastPoop = latestEvent('poop')
  $: lastPee = latestEvent('pee')
  $: lastFeed = latestEvent('feed')
  $: lastBurp = latestEvent('burp')
  $: showBurpReminder = Boolean(
    lastFeed &&
    now - new Date(lastFeed.occurred_at).getTime() >= 15 * 60_000 &&
    (!lastBurp || new Date(lastBurp.occurred_at).getTime() < new Date(lastFeed.occurred_at).getTime()),
  )

  const labels: Record<EventType, string> = {
    poop: 'Poop',
    pee: 'Pee',
    feed: 'Feed',
    burp: 'Burp',
    sleep: 'Sleep',
    diaper_check: 'Diaper check',
    pump: 'Pump',
  }

  const icons: Record<EventType, string> = {
    poop: '●',
    pee: '◇',
    feed: '+',
    burp: '○',
    sleep: '—',
    diaper_check: '✓',
    pump: '↕',
  }

  function actorName(userId: string) {
    if (userId === profile.user_id) return 'You'
    return members.find((member) => member.user_id === userId)?.profile?.display_name ?? 'Other parent'
  }

  function parentGreeting() {
    if (profile.parent_type === 'father') return 'Dad'
    if (profile.parent_type === 'mother') return 'Mom'
    return 'there'
  }

  function interruptionCount(eventId: string) {
    return interruptions.filter((interruption) => interruption.sleep_event_id === eventId && !interruption.deleted_at).length
  }

  function latestEvent(type: 'poop' | 'pee' | 'feed' | 'burp') {
    return events
      .filter((event) => event.event_type === type && !event.deleted_at)
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())[0]
  }
</script>

<section class="screen log-screen" aria-labelledby="log-title">
  <header class="screen-header">
    <div>
      <p class="eyebrow">Baby Log</p>
      <p class="parent-greeting">Hi {parentGreeting()},</p>
      <h1 id="log-title">{child.nickname}’s day</h1>
    </div>
    {#if !online}<span class="status-dot attention">Offline</span>{/if}
  </header>

  <div class="action-grid" aria-label="Care actions">
    <button class="action-button" type="button" on:click={() => onLog('poop')}><span aria-hidden="true">{icons.poop}</span>Poop</button>
    <button class="action-button" type="button" on:click={() => onLog('pee')}><span aria-hidden="true">{icons.pee}</span>Pee</button>
    <button class="action-button" type="button" on:click={() => onLog('feed')}><span aria-hidden="true">{icons.feed}</span>Feed</button>
    <button class="action-button" type="button" on:click={() => onLog('burp')}><span aria-hidden="true">{icons.burp}</span>Burp</button>
    <button
      class:active-action={activeSleep}
      class="action-button"
      type="button"
      disabled={busySession}
      aria-pressed={Boolean(activeSleep)}
      on:click={() => onSession('sleep', activeSleep ? 'end' : 'start')}
    >
      <span aria-hidden="true">{icons.sleep}</span>
      {activeSleep ? `Wake · ${formatDuration(durationMinutes(activeSleep.occurred_at, new Date(now).toISOString()))}` : 'Sleep'}
    </button>
    <button class="action-button" type="button" on:click={() => onLog('diaper_check')}><span aria-hidden="true">{icons.diaper_check}</span>Diaper check</button>
    {#if profile.show_pump_action}
      <button
        class:active-action={activePump}
        class="action-button pump-action"
        type="button"
        disabled={busySession}
        aria-pressed={Boolean(activePump)}
        on:click={() => onSession('pump', activePump ? 'end' : 'start')}
      >
        <span aria-hidden="true">{icons.pump}</span>
        {activePump ? `End pump · ${formatDuration(durationMinutes(activePump.occurred_at, new Date(now).toISOString()))}` : 'Pump'}
      </button>
    {/if}
  </div>

  {#if activeSleep}
    <button
      class:active-interruption={activeInterruption}
      class="sleep-interruption-button"
      type="button"
      disabled={busySession || busyInterruption}
      aria-pressed={Boolean(activeInterruption)}
      on:click={() => onInterruption(activeInterruption ? 'end' : 'start')}
    >
      {#if activeInterruption}
        Resume sleep · {formatDuration(durationMinutes(activeInterruption.started_at, new Date(now).toISOString()))}
      {:else}
        Sleep Interrupted
      {/if}
    </button>
    <p class="sleep-helper">Use this only when the baby wakes during the current sleep.</p>
  {/if}

  <section class="since-last" aria-labelledby="since-last-title">
    <h2 id="since-last-title">Quick update</h2>
    <dl class="since-last-grid" aria-live="polite">
      <div><dt>Last poop</dt><dd>{lastPoop ? formatElapsed(lastPoop.occurred_at, now) : 'No poop yet'}</dd></div>
      <div><dt>Last pee</dt><dd>{lastPee ? formatElapsed(lastPee.occurred_at, now) : 'No pee yet'}</dd></div>
      <div><dt>Last feed</dt><dd>{lastFeed ? formatElapsed(lastFeed.occurred_at, now) : 'No feed yet'}</dd></div>
    </dl>
    {#if showBurpReminder && lastFeed}
      <p class="burp-reminder" role="status"><strong>No burp yet</strong><span>Last feed was {formatElapsed(lastFeed.occurred_at, now)}.</span></p>
    {/if}
  </section>

  <section class="recent-section" aria-labelledby="recent-title">
    <h2 id="recent-title">Recent</h2>
    {#if recent.length}
      <ul class="event-list compact-list">
        {#each recent as event (event.id)}
          <li>
            <button class="event-row" type="button" on:click={() => onEdit(event)}>
              <span class="event-mark" aria-hidden="true">{icons[event.event_type]}</span>
              <span class="event-main">
                <strong>{labels[event.event_type]}</strong>
                {#if event.event_type === 'sleep' && event.ended_at}
                  <small>{formatDuration(netSleepMinutes(event, interruptions))}{interruptionCount(event.id) ? ` · ${interruptionCount(event.id)} interruption${interruptionCount(event.id) === 1 ? '' : 's'}` : ''}</small>
                {:else if event.ended_at}
                  <small>{formatDuration(durationMinutes(event.occurred_at, event.ended_at))}</small>
                {:else if event.event_type === 'feed' && event.details.amount_ml}
                  <small>{event.details.amount_ml} ml</small>
                {/if}
              </span>
              <span class="event-meta">
                <time datetime={event.occurred_at}>{formatTime(event.occurred_at, timezone)}</time>
                <small>{actorName(event.created_by)}{event.sync_status === 'offline' ? ' · Offline' : ''}</small>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty-state">No events yet.</p>
    {/if}
  </section>
</section>
