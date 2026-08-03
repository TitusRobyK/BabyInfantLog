import { supabase } from './supabase'
import { enqueue } from './offlineQueue'
import type { PendingOperation, WeightMeasurement } from './types'

export type { WeightMeasurement } from './types'

export interface NewWeightMeasurement {
  id?: string
  household_id: string
  child_id: string
  measured_on: string
  weight_grams: number
  created_by: string
}

export interface WeightMeasurementChanges {
  measured_on?: string
  weight_grams?: number
}

interface MeasurementScope {
  userId: string
  householdId: string
  childId: string
}

export function optimisticWeightMeasurement(
  scope: MeasurementScope,
  measuredOn: string,
  weightGrams: number,
  id = crypto.randomUUID(),
): WeightMeasurement {
  const now = new Date().toISOString()
  return {
    id,
    household_id: scope.householdId,
    child_id: scope.childId,
    measured_on: measuredOn,
    weight_grams: weightGrams,
    created_by: scope.userId,
    recorded_at: now,
    updated_at: now,
    deleted_at: null,
    sync_status: navigator.onLine ? 'syncing' : 'offline',
  }
}

export function weightMeasurementFromPending(operation: PendingOperation): WeightMeasurement | null {
  if (operation.kind !== 'insert_weight_measurement') return null
  const payload = operation.payload
  if (
    typeof payload.id !== 'string' ||
    typeof payload.household_id !== 'string' ||
    typeof payload.child_id !== 'string' ||
    typeof payload.measured_on !== 'string' ||
    typeof payload.weight_grams !== 'number' ||
    typeof payload.created_by !== 'string'
  ) return null

  return {
    id: payload.id,
    household_id: payload.household_id,
    child_id: payload.child_id,
    measured_on: payload.measured_on,
    weight_grams: payload.weight_grams,
    created_by: payload.created_by,
    recorded_at: operation.createdAt,
    updated_at: operation.createdAt,
    deleted_at: null,
    sync_status: 'offline',
  }
}

export async function fetchWeightMeasurements(householdId: string, childId: string): Promise<WeightMeasurement[]> {
  const pageSize = 1000
  const measurements: WeightMeasurement[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('weight_measurements')
      .select('*')
      .eq('household_id', householdId)
      .eq('child_id', childId)
      .is('deleted_at', null)
      .order('measured_on', { ascending: false })
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error

    const page = (data ?? []) as WeightMeasurement[]
    measurements.push(...page)
    if (page.length < pageSize) break
  }

  return measurements
}

export async function insertWeightMeasurement(input: NewWeightMeasurement): Promise<WeightMeasurement> {
  const payload = { ...input, id: input.id ?? crypto.randomUUID() }
  const { data, error } = await supabase.from('weight_measurements').insert(payload).select().single()
  if (error) throw error
  return data as WeightMeasurement
}

export async function saveWeightMeasurement(measurement: WeightMeasurement): Promise<WeightMeasurement> {
  const payload = {
    id: measurement.id,
    household_id: measurement.household_id,
    child_id: measurement.child_id,
    measured_on: measurement.measured_on,
    weight_grams: measurement.weight_grams,
    created_by: measurement.created_by,
  }

  if (!navigator.onLine) {
    await enqueue({
      id: measurement.id,
      userId: measurement.created_by,
      kind: 'insert_weight_measurement',
      payload,
      createdAt: measurement.recorded_at,
      attempts: 0,
    })
    return { ...measurement, sync_status: 'offline' }
  }

  const saved = await insertWeightMeasurement(payload)
  return { ...saved, sync_status: 'saved' }
}

export async function updateWeightMeasurement(id: string, changes: WeightMeasurementChanges): Promise<WeightMeasurement> {
  const { data, error } = await supabase.from('weight_measurements').update(changes).eq('id', id).select().single()
  if (error) throw error
  return data as WeightMeasurement
}

export async function softDeleteWeightMeasurement(id: string): Promise<void> {
  const { error } = await supabase.from('weight_measurements').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function restoreWeightMeasurement(id: string): Promise<void> {
  const { error } = await supabase.from('weight_measurements').update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}
