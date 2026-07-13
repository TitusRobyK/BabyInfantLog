<script lang="ts">
  import { onMount } from 'svelte'
  import { ACTIONS, ACTION_BY_TYPE, actionLabel, poopDetailsLabel } from '../lib/actionMeta'
  import { downloadInsightsReport } from '../lib/api'
  import {
    buildActionInsight,
    clampPeriodAnchor,
    dailyInsightValue,
    movePeriodAnchor,
    periodFor,
    sessionMinutes,
    todayDateKey,
    type ActionInsight,
    type InsightsAction,
    type InsightsRange,
  } from '../lib/insights'
  import { formatDuration, formatTime, timeOfDayPercent } from '../lib/time'
  import type { CareEvent, DailySummary, EventType, SleepInterruption } from '../lib/types'

  export let events: CareEvent[]
  export let interruptions: SleepInterruption[]
  export let summaries: DailySummary[]
  export let timezone: string
  export let online: boolean
  export let pendingCount: number
  export let historyStartDate: string
  export let onSyncPending: () => Promise<number>

  let action: InsightsAction = 'all'
  let range: InsightsRange = 'day'
  let anchorDate = todayDateKey(timezone)
  let expandedAction: EventType | null = null
  let now = new Date()
  let clock: ReturnType<typeof setInterval>
  let reportBusy = false
  let reportStatus = ''
  let reportError = ''

  onMount(() => {
    clock = setInterval(() => (now = new Date()), 60_000)
    return () => clearInterval(clock)
  })

  $: period = periodFor(range, anchorDate, timezone, now)
  $: actionInsights = ACTIONS.map((meta) => buildActionInsight(meta.type, events, interruptions, period, timezone))
  $: selectedInsight = action === 'all' ? null : actionInsights.find((insight) => insight.action === action) ?? null
  $: briefSentences = summaries[0] ? Object.values(summaries[0].metrics?.sentences ?? {}) as string[] : []
  $: previousPeriod = periodFor(range, movePeriodAnchor(range, period.anchorDate, -1), timezone, now)
  $: canMovePrevious = previousPeriod.startKey >= historyStartDate

  function chooseRange(nextRange: InsightsRange) {
    anchorDate = clampPeriodAnchor(nextRange, anchorDate, historyStartDate)
    range = nextRange
    expandedAction = null
  }

  function movePeriod(amount: number) {
    if (amount < 0 && !canMovePrevious) return
    anchorDate = movePeriodAnchor(range, period.anchorDate, amount)
    expandedAction = null
  }

  function returnToToday() {
    anchorDate = todayDateKey(timezone, now)
    expandedAction = null
  }

  function chooseAction(nextAction: InsightsAction) {
    action = nextAction
    expandedAction = null
  }

  function toggleExpanded(type: EventType) {
    expandedAction = expandedAction === type ? null : type
  }

  function hasData(insight: ActionInsight) {
    return insight.events.length > 0
  }

  function headline(insight: ActionInsight): string {
    if (!hasData(insight)) return 'No entries'
    if (ACTION_BY_TYPE[insight.action].session) {
      const sessions = `${insight.count} ${insight.count === 1 ? 'session' : 'sessions'}`
      const duration = formatDuration(insight.minutes)
      if (insight.action === 'sleep' && insight.interruptions) {
        return `${sessions} · ${duration} · longest ${formatDuration(insight.longestMinutes)} · ${insight.interruptions} interruption${insight.interruptions === 1 ? '' : 's'}`
      }
      if (insight.action === 'sleep') return `${sessions} · ${duration} · longest ${formatDuration(insight.longestMinutes)}`
      if (insight.action === 'pump' && insight.volumeEntries) return `${sessions} · ${duration} · ${Math.round(insight.volumeMl)} ml`
      return `${sessions} · ${duration}`
    }
    const singular = insight.action === 'hiccups' ? 'episode' : 'entry'
    const plural = insight.action === 'hiccups' ? 'episodes' : 'entries'
    const base = `${insight.count} ${insight.count === 1 ? singular : plural}`
    const showsGap = ['poop', 'pee', 'feed', 'hiccups'].includes(insight.action)
    const gap = showsGap && insight.medianIntervalMinutes !== null ? ` · typical gap ${formatDuration(insight.medianIntervalMinutes)}` : ''
    if (insight.action === 'feed' && insight.volumeEntries) return `${base}${gap} · ${Math.round(insight.volumeMl)} ml recorded`
    if (insight.action === 'diaper_check') {
      const outcomes = diaperOutcomeSummary(insight)
      return `${base}${outcomes ? ` · ${outcomes}` : ''}`
    }
    return `${base}${gap}`
  }

  function diaperOutcomeSummary(insight: ActionInsight): string {
    const order = ['wet', 'soiled', 'mixed', 'dry', 'rash'] as const
    const labels = { wet: 'wet', soiled: 'soiled', mixed: 'mixed', dry: 'dry', rash: 'rash noticed' }
    return order
      .map((outcome) => ({ outcome, count: insight.events.filter((event) => event.details.outcome === outcome).length }))
      .filter(({ count }) => count)
      .map(({ outcome, count }) => `${count} ${labels[outcome]}`)
      .join(', ')
  }

  function dailyValueLabel(insight: ActionInsight, dayIndex: number): string {
    const day = insight.days[dayIndex]
    if (!day) return 'No entries'
    if (ACTION_BY_TYPE[insight.action].session) {
      const duration = formatDuration(day.minutes)
      const volume = insight.action === 'pump' && day.volumeMl ? ` · ${Math.round(day.volumeMl)} ml` : ''
      return day.count ? `${duration} · ${day.count} ${day.count === 1 ? 'session' : 'sessions'}${volume}` : duration === '0m' ? 'No entries' : duration
    }
    if (!day.count) return 'No entries'
    const volume = (insight.action === 'feed' || insight.action === 'pump') && day.volumeMl ? ` · ${Math.round(day.volumeMl)} ml` : ''
    return `${day.count} ${day.count === 1 ? 'entry' : 'entries'}${volume}`
  }

  function shortDate(date: string, includeWeekday = true): string {
    return new Intl.DateTimeFormat(undefined, {
      ...(includeWeekday ? { weekday: 'short' as const } : {}),
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`))
  }

  function dayNumber(date: string): string {
    return String(Number(date.slice(-2)))
  }

  function calendarColumn(date: string): number {
    return new Date(`${date}T12:00:00Z`).getUTCDay() || 7
  }

  function calendarValue(insight: ActionInsight, dayIndex: number): string {
    const day = insight.days[dayIndex]
    if (!day) return '–'
    if (ACTION_BY_TYPE[insight.action].session) return compactDuration(day.minutes)
    return day.count ? String(day.count) : '–'
  }

  function compactDuration(minutes: number): string {
    if (!minutes) return '–'
    if (minutes < 60) return `${Math.round(minutes)}m`
    const hours = Math.round((minutes / 60) * 10) / 10
    return `${hours}h`
  }

  function maxDailyValue(insight: ActionInsight): number {
    return Math.max(1, ...insight.days.map((day) => dailyInsightValue(insight.action, day)))
  }

  function eventTimeLabel(event: CareEvent): string {
    if (!ACTION_BY_TYPE[event.event_type].session) return formatTime(event.occurred_at, timezone)
    const rawStart = new Date(event.occurred_at)
    const rawEnd = new Date(event.ended_at ?? period.effectiveEnd)
    const clippedStart = new Date(Math.max(rawStart.getTime(), period.start.getTime()))
    const clippedEnd = new Date(Math.min(rawEnd.getTime(), period.effectiveEnd.getTime()))
    const start = `${formatTime(clippedStart.toISOString(), timezone)}${rawStart < period.start ? ' (continued)' : ''}`
    const end = !event.ended_at && period.isCurrent
      ? 'ongoing'
      : `${formatTime(clippedEnd.toISOString(), timezone)}${rawEnd > period.effectiveEnd || !event.ended_at ? ' (continues)' : ''}`
    return `${start}–${end}`
  }

  function eventValueLabel(event: CareEvent): string {
    if (ACTION_BY_TYPE[event.event_type].session) {
      const duration = sessionMinutes(event, interruptions, period.start, period.effectiveEnd)
      const volume = event.event_type === 'pump' && event.details.amount_ml ? ` · ${Math.round(event.details.amount_ml)} ml` : ''
      return `${formatDuration(duration)}${volume}`
    }
    if (event.event_type === 'feed' && event.details.amount_ml) return `${Math.round(event.details.amount_ml)} ml`
    if (event.event_type === 'poop' && poopDetailsLabel(event.details)) return poopDetailsLabel(event.details)
    return 'Recorded'
  }

  function eventStartPercent(event: CareEvent): number {
    return new Date(event.occurred_at) < period.start ? 0 : timeOfDayPercent(event.occurred_at, timezone)
  }

  function eventEndPercent(event: CareEvent): number {
    const end = new Date(event.ended_at ?? period.effectiveEnd)
    if (end >= period.effectiveEnd) {
      return period.effectiveEnd.getTime() === period.end.getTime()
        ? 100
        : timeOfDayPercent(period.effectiveEnd.toISOString(), timezone)
    }
    return timeOfDayPercent(end.toISOString(), timezone)
  }

  function sessionWidth(event: CareEvent): number {
    return Math.max(1, eventEndPercent(event) - eventStartPercent(event))
  }

  function chartExplanation(type: EventType): string {
    if (range === 'day' && ACTION_BY_TYPE[type].session) return `Blocks show when ${actionLabel(type).toLowerCase()} sessions happened. Exact times are listed below.`
    if (range === 'day') return `Dots show when each ${actionLabel(type).toLowerCase()} was logged. Exact times are listed below.`
    return `Each row is one day. Longer bars mean ${ACTION_BY_TYPE[type].session ? 'more total time' : 'more entries'}; the exact value is shown at the right.`
  }

  async function downloadReport() {
    if (reportBusy || !online) return
    reportBusy = true
    reportError = ''
    reportStatus = ''
    try {
      if (pendingCount) {
        reportStatus = 'Syncing recent entries before preparing your report.'
        const remaining = await onSyncPending()
        if (remaining) throw new Error('Some recent entries have not synced yet. Try again when they are saved.')
      }
      reportStatus = 'Preparing report…'
      const report = await downloadInsightsReport({ action, range, anchorDate: period.anchorDate })
      const url = URL.createObjectURL(report.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = report.filename
      link.rel = 'noopener'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      reportStatus = isIosSafari()
        ? 'Report ready. If it opened in Safari, tap Share, then Save to Files.'
        : 'Report downloaded.'
    } catch (caught) {
      reportStatus = ''
      reportError = caught instanceof Error ? caught.message : 'We couldn’t prepare the report. Try again.'
    } finally {
      reportBusy = false
    }
  }

  function isIosSafari(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent)
  }
</script>

<section class="screen insights-screen" aria-labelledby="insights-title">
  <header class="screen-header"><div><p class="eyebrow">Patterns</p><h1 id="insights-title">Insights</h1></div></header>

  {#if briefSentences.length}
    <section class="brief" aria-labelledby="brief-title">
      <p class="eyebrow">Latest 8 PM brief</p>
      <h2 id="brief-title">From one 8 PM to the next</h2>
      <ul>
        {#each briefSentences as sentence}<li>{sentence}</li>{/each}
      </ul>
    </section>
  {/if}

  <div class="insights-controls">
    <label>Action
      <select value={action} on:change={(event) => chooseAction((event.currentTarget as HTMLSelectElement).value as InsightsAction)}>
        <option value="all">All Actions</option>
        {#each ACTIONS as meta}<option value={meta.type}>{meta.label}</option>{/each}
      </select>
    </label>

    <div class="segmented" aria-label="Date range">
      <button class:active={range === 'day'} aria-pressed={range === 'day'} type="button" on:click={() => chooseRange('day')}>Day</button>
      <button class:active={range === 'week'} aria-pressed={range === 'week'} type="button" on:click={() => chooseRange('week')}>Week</button>
      <button class:active={range === 'month'} aria-pressed={range === 'month'} type="button" on:click={() => chooseRange('month')}>Month</button>
    </div>

    <div class="insights-period-nav" aria-label="Selected period">
      <button class="previous-period" type="button" disabled={!canMovePrevious} on:click={() => movePeriod(-1)}><span aria-hidden="true">←</span> Previous</button>
      <div class="period-label">
        <strong>{period.label}</strong>
        {#if period.isCurrent}<small>Current {range}</small>{:else}<button type="button" on:click={returnToToday}>Today</button>{/if}
      </div>
      <button class="next-period" type="button" disabled={period.isCurrent} on:click={() => movePeriod(1)}>Next <span aria-hidden="true">→</span></button>
    </div>
    {#if !canMovePrevious}<p class="history-limit">Insights on this screen cover about the past 13 months.</p>{/if}

    <div class="report-download">
      <button type="button" disabled={!online || reportBusy} on:click={downloadReport}>{reportBusy ? 'Preparing report…' : 'Download PDF'}</button>
      {#if !online}<p>Connect to the internet to download a report.</p>{/if}
      {#if reportStatus}<p class="report-status" role="status">{reportStatus}</p>{/if}
      {#if reportError}<p class="field-error" role="alert">{reportError} <button type="button" disabled={!online || reportBusy} on:click={downloadReport}>Retry</button></p>{/if}
    </div>
  </div>

  {#if action === 'all'}
    <section class="at-a-glance" aria-labelledby="glance-title">
      <p class="eyebrow">At a glance</p>
      <h2 id="glance-title">{period.label}</h2>
      <p>{actionInsights.filter(hasData).length} of {ACTIONS.length} actions have entries in this {range}.</p>
    </section>

    <div class="insights-card-grid">
      {#each actionInsights as insight (insight.action)}
        <article class:expanded={expandedAction === insight.action} class="insight-card" style={`--chart-color: ${ACTION_BY_TYPE[insight.action].color}`}>
          <header class:tappable={range !== 'day'} class="insight-card-header">
            <span class="insight-icon" aria-hidden="true">{ACTION_BY_TYPE[insight.action].icon}</span>
            <div><h3>{actionLabel(insight.action)}</h3><p>{headline(insight)}</p></div>
            {#if range !== 'day'}
              <button
                class="card-header-hit"
                type="button"
                aria-label={`${expandedAction === insight.action ? 'Hide' : 'Show'} daily breakdown for ${actionLabel(insight.action)}`}
                aria-expanded={expandedAction === insight.action}
                on:click={() => toggleExpanded(insight.action)}
              ></button>
            {/if}
          </header>

          {#if range === 'day'}
            <div class="mini-day-track" role="img" aria-label={`${actionLabel(insight.action)}: ${headline(insight)}`}>
              <i style="left: 25%"></i><i style="left: 50%"></i><i style="left: 75%"></i>
              {#each insight.events as event (event.id)}
                {#if ACTION_BY_TYPE[insight.action].session}
                  <span class="mini-session" style={`left: ${eventStartPercent(event)}%; width: ${sessionWidth(event)}%`}></span>
                {:else}
                  <span class="mini-point" style={`left: ${timeOfDayPercent(event.occurred_at, timezone)}%`}></span>
                {/if}
              {/each}
            </div>
            <div class="mini-axis" aria-hidden="true"><span>12am</span><span>12pm</span><span>12am</span></div>
          {:else}
            <div class:month={range === 'month'} class="mini-bars" role="img" aria-label={`${actionLabel(insight.action)} daily graph. ${headline(insight)}. Use Show daily breakdown for exact daily values.`}>
              {#each insight.days as day}
                <span title={`${shortDate(day.date)}: ${dailyValueLabel(insight, insight.days.indexOf(day))}`} style={`height: ${dailyInsightValue(insight.action, day) ? Math.max(8, (dailyInsightValue(insight.action, day) / maxDailyValue(insight)) * 100) : 2}%`}></span>
              {/each}
            </div>
          {/if}

          {#if range !== 'day'}
            <button class="breakdown-toggle" type="button" aria-expanded={expandedAction === insight.action} on:click={() => toggleExpanded(insight.action)}>
              {expandedAction === insight.action ? 'Hide daily breakdown' : 'Show daily breakdown'}
              <span aria-hidden="true">{expandedAction === insight.action ? '⌃' : '⌄'}</span>
            </button>
          {/if}

          {#if expandedAction === insight.action && range === 'week'}
            <ul class="compact-breakdown">
              {#each insight.days as day, index}<li><time datetime={day.date}>{shortDate(day.date)}</time><strong>{dailyValueLabel(insight, index)}</strong></li>{/each}
            </ul>
          {:else if expandedAction === insight.action && range === 'month'}
            <div class="month-breakdown" aria-label={`${actionLabel(insight.action)} daily values for ${period.label}`}>
              {#each insight.days as day, index}
                <div style={index === 0 ? `grid-column: ${calendarColumn(day.date)}` : undefined} title={`${shortDate(day.date)}: ${dailyValueLabel(insight, index)}`}><time datetime={day.date}>{dayNumber(day.date)}</time><strong aria-label={dailyValueLabel(insight, index)}>{calendarValue(insight, index)}</strong></div>
              {/each}
            </div>
          {/if}

          <button class="view-insight-details" type="button" on:click={() => chooseAction(insight.action)}>View {actionLabel(insight.action).toLowerCase()} details</button>
        </article>
      {/each}
    </div>
  {:else if selectedInsight}
    <section class="metric-summary">
      <strong>{actionLabel(selectedInsight.action)} · {period.label}</strong>
      <span>{headline(selectedInsight)}</span>
      {#if (selectedInsight.action === 'feed' || selectedInsight.action === 'pump') && selectedInsight.missingVolume}
        <span>{selectedInsight.missingVolume} {selectedInsight.missingVolume === 1 ? 'entry has' : 'entries have'} no amount recorded</span>
      {/if}
    </section>

    <p class="chart-explanation">{chartExplanation(selectedInsight.action)}</p>

    {#if range === 'day' && hasData(selectedInsight)}
      <section class="day-chart" aria-label={`${actionLabel(selectedInsight.action)} on ${period.label}`} style={`--chart-color: ${ACTION_BY_TYPE[selectedInsight.action].color}`}>
        <div class="day-axis" aria-hidden="true"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
        <div class="day-track" aria-hidden="true">
          <i style="left: 25%"></i><i style="left: 50%"></i><i style="left: 75%"></i>
          {#each selectedInsight.events as event (event.id)}
            {#if ACTION_BY_TYPE[selectedInsight.action].session}
              <span class="day-session" style={`left: ${eventStartPercent(event)}%; width: ${sessionWidth(event)}%`}></span>
            {:else}
              <span class="day-point" style={`left: ${timeOfDayPercent(event.occurred_at, timezone)}%`}></span>
            {/if}
          {/each}
        </div>
      </section>
      <ul class="chart-detail-list">
        {#each selectedInsight.events as event (event.id)}
          <li><time datetime={event.occurred_at}>{eventTimeLabel(event)}</time><strong>{eventValueLabel(event)}</strong></li>
        {/each}
      </ul>
    {:else if range !== 'day' && hasData(selectedInsight)}
      <div class="daily-chart" aria-label={`${actionLabel(selectedInsight.action)} by day`} style={`--chart-color: ${ACTION_BY_TYPE[selectedInsight.action].color}`}>
        {#each selectedInsight.days as day, index}
          <div class="daily-row">
            <time datetime={day.date}>{shortDate(day.date)}</time>
            <div class="daily-bar-track" aria-hidden="true"><span style={`width: ${dailyInsightValue(selectedInsight.action, day) ? Math.max(3, (dailyInsightValue(selectedInsight.action, day) / maxDailyValue(selectedInsight)) * 100) : 0}%`}></span></div>
            <strong>{dailyValueLabel(selectedInsight, index)}</strong>
          </div>
        {/each}
      </div>
    {:else}
      <p class="empty-state">No {actionLabel(selectedInsight.action).toLowerCase()} recorded for this {range}.</p>
    {/if}
  {/if}
</section>
