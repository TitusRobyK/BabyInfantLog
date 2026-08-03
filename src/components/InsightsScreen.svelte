<script lang="ts">
  import { onMount, tick } from 'svelte'
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
  import { buildLiveBrief } from '../lib/liveBrief'
  import { formatDuration, formatTime, timeOfDayPercent } from '../lib/time'
  import type { CareEvent, EventType, SleepInterruption, VolumeUnit, WeightMeasurement, WeightUnit } from '../lib/types'
  import { canonicalVolumeMl, formatVolume } from '../lib/volume'
  import { formatWeight, formatWeightChange } from '../lib/weight'
  import { buildWeightInsight, type WeightInsight } from '../lib/weightInsights'

  export let events: CareEvent[]
  export let measurements: WeightMeasurement[] = []
  export let interruptions: SleepInterruption[]
  export let timezone: string
  export let volumeUnit: VolumeUnit = 'ml'
  export let weightUnit: WeightUnit = 'lb_oz'
  export let online: boolean
  export let pendingCount: number
  export let historyStartDate: string
  export let onSyncPending: () => Promise<number>

  const WEIGHT_CHART_COLOR = '#5B6178'

  let action: InsightsAction = 'all'
  let range: InsightsRange = 'day'
  let anchorDate = todayDateKey(timezone)
  let expandedAction: Exclude<InsightsAction, 'all'> | null = null
  let now = new Date()
  let clock: ReturnType<typeof setInterval>
  let reportBusy = false
  let reportStatus = ''
  let reportError = ''
  let detailHeading: HTMLElement | null = null

  onMount(() => {
    clock = setInterval(() => (now = new Date()), 60_000)
    return () => clearInterval(clock)
  })

  $: period = periodFor(range, anchorDate, timezone, now)
  $: actionInsights = ACTIONS.map((meta) => buildActionInsight(meta.type, events, interruptions, period, timezone))
  $: selectedInsight = action === 'all' || action === 'weight' ? null : actionInsights.find((insight) => insight.action === action) ?? null
  $: weightInsight = buildWeightInsight(measurements, period)
  $: latestBrief = buildLiveBrief(events, interruptions, timezone, now, volumeUnit)
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

  async function openActionDetails(nextAction: Exclude<InsightsAction, 'all'>) {
    chooseAction(nextAction)
    await tick()
    detailHeading?.focus()
    if (typeof detailHeading?.scrollIntoView === 'function') detailHeading.scrollIntoView({ block: 'start' })
  }

  async function returnToAllActions() {
    const previousAction = action === 'all' ? null : action
    chooseAction('all')
    await tick()
    if (!previousAction) return
    const target = document.querySelector<HTMLButtonElement>(`[data-insight-action="${previousAction}"] .view-insight-details`)
    target?.focus()
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' })
  }

  function toggleExpanded(type: Exclude<InsightsAction, 'all'>) {
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
      if (insight.action === 'pump' && insight.volumeEntries) return `${sessions} · ${duration} · ${formatVolume(insight.volumeMl, volumeUnit)}`
      return `${sessions} · ${duration}`
    }
    const singular = insight.action === 'hiccups' ? 'episode' : 'entry'
    const plural = insight.action === 'hiccups' ? 'episodes' : 'entries'
    const base = `${insight.count} ${insight.count === 1 ? singular : plural}`
    const showsGap = ['poop', 'pee', 'feed', 'hiccups'].includes(insight.action)
    const gap = showsGap && insight.medianIntervalMinutes !== null ? ` · typical gap ${formatDuration(insight.medianIntervalMinutes)}` : ''
    if (insight.action === 'feed' && insight.volumeEntries) return `${base}${gap} · ${formatVolume(insight.volumeMl, volumeUnit)} recorded`
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
      const volume = insight.action === 'pump' && day.volumeMl ? ` · ${formatVolume(day.volumeMl, volumeUnit)}` : ''
      return day.count ? `${duration} · ${day.count} ${day.count === 1 ? 'session' : 'sessions'}${volume}` : duration === '0m' ? 'No entries' : duration
    }
    if (!day.count) return 'No entries'
    const volume = (insight.action === 'feed' || insight.action === 'pump') && day.volumeMl ? ` · ${formatVolume(day.volumeMl, volumeUnit)}` : ''
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
    const amountMl = canonicalVolumeMl(event.details)
    if (ACTION_BY_TYPE[event.event_type].session) {
      const duration = sessionMinutes(event, interruptions, period.start, period.effectiveEnd)
      const volume = event.event_type === 'pump' && amountMl !== null ? ` · ${formatVolume(amountMl, volumeUnit)}` : ''
      return `${formatDuration(duration)}${volume}`
    }
    if (event.event_type === 'feed' && amountMl !== null) return formatVolume(amountMl, volumeUnit)
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

  function weightHeadline(insight: WeightInsight): string {
    if (insight.latest) {
      const change = insight.changeGrams !== null && insight.previous
        ? ` · ${formatWeightChange(insight.changeGrams, weightUnit)} since ${shortDate(insight.previous.measured_on, false)}`
        : ''
      return `${formatWeight(insight.latest.weight_grams, weightUnit)} · ${shortDate(insight.latest.measured_on, false)}${change}`
    }
    if (insight.latestBeforePeriod) {
      return `No weight this period · latest ${formatWeight(insight.latestBeforePeriod.weight_grams, weightUnit)} on ${shortDate(insight.latestBeforePeriod.measured_on, false)}`
    }
    return 'No weight recorded'
  }

  function weightPointX(measurement: WeightMeasurement, insight: WeightInsight): number {
    if (period.dateKeys.length <= 1) {
      const matching = insight.measurements.filter((item) => item.measured_on === measurement.measured_on)
      const index = matching.findIndex((item) => item.id === measurement.id)
      return matching.length <= 1 ? 50 : 5 + (index / (matching.length - 1)) * 90
    }
    const dayIndex = Math.max(0, period.dateKeys.indexOf(measurement.measured_on))
    return 5 + (dayIndex / (period.dateKeys.length - 1)) * 90
  }

  function weightPointY(measurement: WeightMeasurement, insight: WeightInsight): number {
    const values = insight.measurements.map((item) => item.weight_grams)
    const minimum = Math.min(...values)
    const maximum = Math.max(...values)
    return maximum === minimum ? 50 : 87.5 - ((measurement.weight_grams - minimum) / (maximum - minimum)) * 75
  }

  function weightPoints(insight: WeightInsight): string {
    return insight.measurements.map((measurement) => `${weightPointX(measurement, insight)},${weightPointY(measurement, insight)}`).join(' ')
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

  <section class="brief" aria-labelledby="brief-title">
    <h2 id="brief-title" class="eyebrow">{latestBrief.title}</h2>
    <p class="brief-timeframe">{latestBrief.timeframeLabel}</p>
    {#if latestBrief.empty}
      <p class="brief-empty">{latestBrief.emptyMessage}</p>
    {:else}
      <ul>
        {#each latestBrief.lines as line}<li>{line}</li>{/each}
      </ul>
    {/if}
  </section>

  <div class="insights-controls">
    <label>Action
      <select value={action} on:change={(event) => chooseAction((event.currentTarget as HTMLSelectElement).value as InsightsAction)}>
        <option value="all">All Actions</option>
        <optgroup label="Care actions">{#each ACTIONS as meta}<option value={meta.type}>{meta.label}</option>{/each}</optgroup>
        <optgroup label="Measurements"><option value="weight">Weight</option></optgroup>
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
      <p>{actionInsights.filter(hasData).length + (weightInsight.measurements.length ? 1 : 0)} of {ACTIONS.length + 1} actions and measurements have entries in this {range}.</p>
    </section>

    <div class="insights-card-grid">
      {#each actionInsights as insight (insight.action)}
        <article data-insight-action={insight.action} class:expanded={expandedAction === insight.action} class="insight-card" style={`--chart-color: ${ACTION_BY_TYPE[insight.action].color}`}>
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

          <button class="view-insight-details" type="button" on:click={() => openActionDetails(insight.action)}>View {actionLabel(insight.action).toLowerCase()} details</button>
        </article>
      {/each}

      <article data-insight-action="weight" class:expanded={expandedAction === 'weight'} class="insight-card" style={`--chart-color: ${WEIGHT_CHART_COLOR}`}>
        <header class:tappable={range !== 'day'} class="insight-card-header">
          <span class="insight-icon" aria-hidden="true">↗</span>
          <div><h3>Weight</h3><p>{weightHeadline(weightInsight)}</p></div>
          {#if range !== 'day'}
            <button
              class="card-header-hit"
              type="button"
              aria-label={`${expandedAction === 'weight' ? 'Hide' : 'Show'} recorded weights`}
              aria-expanded={expandedAction === 'weight'}
              on:click={() => toggleExpanded('weight')}
            ></button>
          {/if}
        </header>

        <div class="weight-mini-chart" role="img" aria-label={`Weight: ${weightHeadline(weightInsight)}`}>
          {#if weightInsight.measurements.length > 1}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={weightPoints(weightInsight)}></polyline>
            </svg>
          {:else if !weightInsight.measurements.length}
            <span class="no-weight-point" aria-hidden="true"></span>
          {/if}
          {#each weightInsight.measurements as measurement (measurement.id)}
            <span class="weight-chart-point" style={`left: ${weightPointX(measurement, weightInsight)}%; top: ${weightPointY(measurement, weightInsight)}%`} aria-hidden="true"></span>
          {/each}
        </div>

        {#if range !== 'day'}
          <button class="breakdown-toggle" type="button" aria-expanded={expandedAction === 'weight'} on:click={() => toggleExpanded('weight')}>
            {expandedAction === 'weight' ? 'Hide recorded weights' : 'Show recorded weights'}
            <span aria-hidden="true">{expandedAction === 'weight' ? '⌃' : '⌄'}</span>
          </button>
        {/if}

        {#if expandedAction === 'weight' && range !== 'day'}
          {#if weightInsight.measurements.length}
            <ul class="compact-breakdown">
              {#each weightInsight.measurements as measurement (measurement.id)}
                <li><time datetime={measurement.measured_on}>{shortDate(measurement.measured_on)}</time><strong>{formatWeight(measurement.weight_grams, weightUnit)}</strong></li>
              {/each}
            </ul>
          {:else}
            <p class="compact-empty">No weight recorded in this period.</p>
          {/if}
        {/if}

        <button class="view-insight-details" type="button" on:click={() => openActionDetails('weight')}>View weight details</button>
      </article>
    </div>
  {:else if action === 'weight'}
    <button class="back-to-all-actions" type="button" on:click={returnToAllActions}><span aria-hidden="true">←</span> Back to all actions</button>
    <section class="metric-summary" aria-labelledby="selected-insight-title">
      <h2 id="selected-insight-title" class="metric-summary-title" tabindex="-1" bind:this={detailHeading}>Weight · {period.label}</h2>
      <span>{weightHeadline(weightInsight)}</span>
    </section>

    <p class="chart-explanation">Points show recorded measurements by date. Exact values are listed below.</p>

    {#if weightInsight.measurements.length}
      <section class="weight-detail-chart" style={`--chart-color: ${WEIGHT_CHART_COLOR}`} role="img" aria-label={`Weight measurements for ${period.label}. ${weightHeadline(weightInsight)}`}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {#if weightInsight.measurements.length > 1}<polyline points={weightPoints(weightInsight)}></polyline>{/if}
        </svg>
        {#each weightInsight.measurements as measurement (measurement.id)}
          <span class="weight-chart-point" style={`left: ${weightPointX(measurement, weightInsight)}%; top: ${weightPointY(measurement, weightInsight)}%`} aria-hidden="true"></span>
        {/each}
      </section>
      <ul class="chart-detail-list">
        {#each weightInsight.measurements as measurement (measurement.id)}
          <li><time datetime={measurement.measured_on}>{shortDate(measurement.measured_on)}</time><strong>{formatWeight(measurement.weight_grams, weightUnit)}</strong></li>
        {/each}
      </ul>
    {:else}
      <p class="empty-state">No weight recorded for this {range}.</p>
    {/if}
  {:else if selectedInsight}
    <button class="back-to-all-actions" type="button" on:click={returnToAllActions}><span aria-hidden="true">←</span> Back to all actions</button>
    <section class="metric-summary" aria-labelledby="selected-insight-title">
      <h2 id="selected-insight-title" class="metric-summary-title" tabindex="-1" bind:this={detailHeading}>{actionLabel(selectedInsight.action)} · {period.label}</h2>
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
