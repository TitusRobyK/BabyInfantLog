import type { Config } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface CareEvent {
  id: string
  event_type: string
  occurred_at: string
  ended_at: string | null
  details: { amount_ml?: number }
}

interface SleepInterruption {
  sleep_event_id: string
  started_at: string
  ended_at: string | null
}

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

function durationMinutes(event: CareEvent, start: Date, end: Date): number {
  const eventStart = Math.max(new Date(event.occurred_at).getTime(), start.getTime())
  const eventEnd = Math.min(event.ended_at ? new Date(event.ended_at).getTime() : end.getTime(), end.getTime())
  return Math.max(0, Math.round((eventEnd - eventStart) / 60_000))
}

function netSleepMinutes(event: CareEvent, interruptions: SleepInterruption[], start: Date, end: Date): number {
  const gross = durationMinutes(event, start, end)
  const eventStart = Math.max(new Date(event.occurred_at).getTime(), start.getTime())
  const eventEnd = Math.min(event.ended_at ? new Date(event.ended_at).getTime() : end.getTime(), end.getTime())
  const interrupted = interruptions
    .filter((interruption) => interruption.sleep_event_id === event.id)
    .reduce((total, interruption) => {
      const interruptionStart = Math.max(eventStart, new Date(interruption.started_at).getTime())
      const interruptionEnd = Math.min(
        eventEnd,
        interruption.ended_at ? new Date(interruption.ended_at).getTime() : end.getTime(),
      )
      return total + Math.max(0, Math.round((interruptionEnd - interruptionStart) / 60_000))
    }, 0)
  return Math.max(0, gross - interrupted)
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function medianInterval(events: CareEvent[]): number | null {
  if (events.length < 2) return null
  const ordered = events.map((event) => new Date(event.occurred_at).getTime()).sort((a, b) => a - b)
  const gaps = ordered.slice(1).map((value, index) => Math.round((value - ordered[index]) / 60_000)).sort((a, b) => a - b)
  const middle = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[middle] : Math.round((gaps[middle - 1] + gaps[middle]) / 2)
}

function buildMetrics(events: CareEvent[], interruptions: SleepInterruption[], start: Date, end: Date) {
  const discreteTypes = ['poop', 'pee', 'feed', 'burp', 'diaper_check']
  const inWindow = events.filter((event) => {
    const time = new Date(event.occurred_at)
    return time >= start && time < end
  })
  const counts = Object.fromEntries(discreteTypes.map((type) => [type, inWindow.filter((event) => event.event_type === type).length]))
  const feeds = inWindow.filter((event) => event.event_type === 'feed')
  const sleep = events.filter((event) => event.event_type === 'sleep')
  const pump = events.filter((event) => event.event_type === 'pump')
  const sleepDurations = sleep.map((event) => netSleepMinutes(event, interruptions, start, end))
  const pumpDurations = pump.map((event) => durationMinutes(event, start, end))
  const sleepTotal = sleepDurations.reduce((sum, value) => sum + value, 0)
  const pumpTotal = pumpDurations.reduce((sum, value) => sum + value, 0)
  const volumeEvents = pump.filter((event) => typeof event.details?.amount_ml === 'number')
  const pumpVolumeMl = volumeEvents.reduce((sum, event) => sum + (event.details.amount_ml ?? 0), 0)
  const feedVolumeEvents = feeds.filter((event) => typeof event.details?.amount_ml === 'number')
  const feedVolumeMl = feedVolumeEvents.reduce((sum, event) => sum + (event.details.amount_ml ?? 0), 0)
  const sleepInterruptions = interruptions.filter((interruption) => {
    const interruptionStart = new Date(interruption.started_at)
    const interruptionEnd = new Date(interruption.ended_at ?? end)
    return interruptionStart < end && interruptionEnd > start
  })
  const feedGap = medianInterval(feeds)

  const sentences = [
    `${counts.feed} feeds${feedGap ? `; median gap ${formatDuration(feedGap)}` : ''}${feedVolumeEvents.length ? `; ${Math.round(feedVolumeMl)} ml recorded across ${feedVolumeEvents.length}` : ''}.`,
    `${formatDuration(sleepTotal)} sleep across ${sleep.length} sessions${sleepDurations.length ? `; longest ${formatDuration(Math.max(...sleepDurations))}` : ''}${sleepInterruptions.length ? `; ${sleepInterruptions.length} interruption${sleepInterruptions.length === 1 ? '' : 's'}` : ''}.`,
    `${counts.pee} pee, ${counts.poop} poop, ${counts.diaper_check} diaper checks.`,
    `${counts.burp} burps recorded.`,
  ]
  if (pump.length) {
    sentences.push(
      `${pump.length} pump sessions totaling ${formatDuration(pumpTotal)}${volumeEvents.length ? `; ${Math.round(pumpVolumeMl)} ml recorded across ${volumeEvents.length}` : '; volume not recorded'}.`,
    )
  }

  return {
    counts,
    feed: { sessions: feeds.length, median_interval_minutes: feedGap, volume_ml: feedVolumeMl, sessions_with_volume: feedVolumeEvents.length },
    sleep: { sessions: sleep.length, total_minutes: sleepTotal, longest_minutes: sleepDurations.length ? Math.max(...sleepDurations) : 0, interruptions: sleepInterruptions.length },
    pump: { sessions: pump.length, total_minutes: pumpTotal, volume_ml: pumpVolumeMl, sessions_with_volume: volumeEvents.length },
    sentences,
  }
}

async function processHousehold(client: SupabaseClient, household: { id: string; timezone: string }, now: Date) {
  const parts = localParts(now, household.timezone)
  if (parts.hour !== 20) return false

  const periodEnd = new Date(now.getTime() - (parts.minute * 60 + parts.second) * 1000 - now.getMilliseconds())
  const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60_000)
  const { data: child, error: childError } = await client
    .from('children')
    .select('id')
    .eq('household_id', household.id)
    .eq('active', true)
    .single()
  if (childError) throw childError

  const { data: existing } = await client
    .from('daily_summaries')
    .select('id')
    .eq('child_id', child.id)
    .eq('period_end', periodEnd.toISOString())
    .maybeSingle()
  if (existing) return false

  const [{ data: discrete, error: discreteError }, { data: sessions, error: sessionsError }] = await Promise.all([
    client
      .from('events')
      .select('id, event_type, occurred_at, ended_at, details')
      .eq('child_id', child.id)
      .is('deleted_at', null)
      .in('event_type', ['poop', 'pee', 'feed', 'burp', 'diaper_check'])
      .gte('occurred_at', periodStart.toISOString())
      .lt('occurred_at', periodEnd.toISOString()),
    client
      .from('events')
      .select('id, event_type, occurred_at, ended_at, details')
      .eq('child_id', child.id)
      .is('deleted_at', null)
      .in('event_type', ['sleep', 'pump'])
      .lt('occurred_at', periodEnd.toISOString())
      .or(`ended_at.is.null,ended_at.gt.${periodStart.toISOString()}`),
  ])
  if (discreteError) throw discreteError
  if (sessionsError) throw sessionsError

  const sleepIds = (sessions ?? []).filter((event) => event.event_type === 'sleep').map((event) => event.id)
  let interruptions: SleepInterruption[] = []
  if (sleepIds.length) {
    const { data, error: interruptionError } = await client
      .from('sleep_interruptions')
      .select('sleep_event_id, started_at, ended_at')
      .in('sleep_event_id', sleepIds)
      .is('deleted_at', null)
      .lt('started_at', periodEnd.toISOString())
      .or(`ended_at.is.null,ended_at.gt.${periodStart.toISOString()}`)
    if (interruptionError) throw interruptionError
    interruptions = (data ?? []) as SleepInterruption[]
  }

  const metrics = buildMetrics([...(discrete ?? []), ...(sessions ?? [])] as CareEvent[], interruptions, periodStart, periodEnd)
  const { error: insertError } = await client.from('daily_summaries').upsert(
    {
      household_id: household.id,
      child_id: child.id,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      metrics,
      comparison: {},
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'child_id,period_end', ignoreDuplicates: true },
  )
  if (insertError) throw insertError
  return true
}

export default async (): Promise<Response> => {
  try {
    const client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: households, error } = await client.from('households').select('id, timezone')
    if (error) throw error

    const now = new Date()
    let generated = 0
    for (const household of households ?? []) {
      try {
        if (await processHousehold(client, household, now)) generated += 1
      } catch (householdError) {
        console.error('daily-summary household failed', household.id, householdError instanceof Error ? householdError.message : 'unknown error')
      }
    }
    return Response.json({ generated })
  } catch (error) {
    console.error('daily-summary failed', error instanceof Error ? error.message : 'unknown error')
    return Response.json({ error: 'Summary generation failed.' }, { status: 500 })
  }
}

export const config: Config = {
  schedule: '*/15 * * * *',
}
