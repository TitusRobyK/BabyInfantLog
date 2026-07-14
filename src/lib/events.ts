import { enqueue, pendingForUser, removePending } from './offlineQueue'
import { supabase } from './supabase'
import type { CareEvent, EventDetails, EventType, PendingOperation, SleepInterruption } from './types'

export const INSIGHTS_HISTORY_DAYS = 400

interface EventScope {
  userId: string
  householdId: string
  childId: string
}

export async function fetchEvents(householdId: string): Promise<CareEvent[]> {
  const since = new Date()
  since.setDate(since.getDate() - (INSIGHTS_HISTORY_DAYS + 1))
  const pageSize = 1000
  const events: CareEvent[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .gte('occurred_at', since.toISOString())
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const page = (data ?? []) as CareEvent[]
    events.push(...page)
    if (page.length < pageSize) break
  }
  return events
}

export async function fetchSleepInterruptions(householdId: string): Promise<SleepInterruption[]> {
  const since = new Date()
  since.setDate(since.getDate() - (INSIGHTS_HISTORY_DAYS + 1))
  const pageSize = 1000
  const interruptions: SleepInterruption[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('sleep_interruptions')
      .select('*')
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const page = (data ?? []) as SleepInterruption[]
    interruptions.push(...page)
    if (page.length < pageSize) break
  }
  return interruptions
}

export function optimisticEvent(
  scope: EventScope,
  eventType: EventType,
  occurredAt: string,
  id = crypto.randomUUID(),
  details: EventDetails = {},
): CareEvent {
  return {
    id,
    household_id: scope.householdId,
    child_id: scope.childId,
    created_by: scope.userId,
    subject_parent_id: eventType === 'pump' ? scope.userId : null,
    event_type: eventType,
    occurred_at: occurredAt,
    ended_at: null,
    client_timezone_offset_minutes: new Date(occurredAt).getTimezoneOffset(),
    details,
    recorded_at: occurredAt,
    updated_at: occurredAt,
    deleted_at: null,
    sync_status: navigator.onLine ? 'syncing' : 'offline',
  }
}

export async function saveDiscreteEvent(event: CareEvent): Promise<CareEvent> {
  const payload = {
    id: event.id,
    household_id: event.household_id,
    child_id: event.child_id,
    created_by: event.created_by,
    subject_parent_id: null,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    client_timezone_offset_minutes: event.client_timezone_offset_minutes,
    details: event.details,
  }

  if (!navigator.onLine) {
    await enqueue({
      id: event.id,
      userId: event.created_by,
      kind: 'insert_event',
      payload,
      createdAt: event.occurred_at,
      attempts: 0,
    })
    return { ...event, sync_status: 'offline' }
  }

  const { data, error } = await supabase.from('events').insert(payload).select().single()
  if (error) throw error
  return { ...(data as CareEvent), sync_status: 'saved' }
}

export async function setSessionState(
  scope: EventScope,
  eventType: 'sleep' | 'pump',
  desiredState: 'start' | 'end',
  occurredAt: string,
  eventId = crypto.randomUUID(),
): Promise<{ action: string; event: CareEvent | null }> {
  const payload = {
    p_event_type: eventType,
    p_desired_state: desiredState,
    p_household_id: scope.householdId,
    p_child_id: scope.childId,
    p_occurred_at: occurredAt,
    p_timezone_offset: new Date(occurredAt).getTimezoneOffset(),
    p_event_id: eventId,
  }

  if (!navigator.onLine) {
    await enqueue({
      id: eventId,
      userId: scope.userId,
      kind: 'session_state',
      payload,
      createdAt: occurredAt,
      attempts: 0,
    })
    return { action: `queued_${desiredState}`, event: null }
  }

  const { data, error } = await supabase.rpc('set_session_state', payload)
  if (error) throw error
  const result = data as { action: string; event: CareEvent | null }
  if (result.event) result.event.sync_status = 'saved'
  return result
}

export async function setSleepInterruptionState(
  scope: EventScope,
  desiredState: 'start' | 'end',
  occurredAt: string,
  interruptionId = crypto.randomUUID(),
): Promise<{ action: string; interruption: SleepInterruption | null }> {
  const payload = {
    p_desired_state: desiredState,
    p_household_id: scope.householdId,
    p_child_id: scope.childId,
    p_occurred_at: occurredAt,
    p_interruption_id: interruptionId,
  }

  if (!navigator.onLine) {
    await enqueue({
      id: interruptionId,
      userId: scope.userId,
      kind: 'sleep_interruption_state',
      payload,
      createdAt: occurredAt,
      attempts: 0,
    })
    return { action: `queued_${desiredState}`, interruption: null }
  }

  const { data, error } = await supabase.rpc('set_sleep_interruption_state', payload)
  if (error) throw error
  const result = data as { action: string; interruption: SleepInterruption | null }
  if (result.interruption) result.interruption.sync_status = 'saved'
  return result
}

export async function updateEvent(id: string, values: { occurred_at?: string; ended_at?: string | null; details?: EventDetails }): Promise<void> {
  const { error } = await supabase.from('events').update(values).eq('id', id)
  if (error) throw error
}

export async function softDeleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function restoreEvent(id: string): Promise<void> {
  const { error } = await supabase.from('events').update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}

export async function flushPending(userId: string): Promise<{ completed: number; failed: number }> {
  if (!navigator.onLine) return { completed: 0, failed: 0 }
  const operations = await pendingForUser(userId)
  let completed = 0
  let failed = 0

  for (const operation of operations) {
    let error: unknown = null
    if (operation.kind === 'insert_event') {
      const result = await supabase.from('events').upsert(operation.payload, { onConflict: 'id', ignoreDuplicates: true })
      error = result.error
    } else if (operation.kind === 'session_state') {
      const result = await supabase.rpc('set_session_state', operation.payload)
      error = result.error
    } else {
      const result = await supabase.rpc('set_sleep_interruption_state', operation.payload)
      error = result.error
    }

    if (!error) {
      await removePending(operation.id)
      completed += 1
    } else {
      failed += 1
      if (!isRetryable(error)) break
    }
  }

  return { completed, failed }
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /fetch|network|timeout|connection/i.test(message)
}

export type { PendingOperation }
