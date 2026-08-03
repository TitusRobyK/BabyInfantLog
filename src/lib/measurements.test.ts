import { afterEach, describe, expect, it, vi } from 'vitest'

const from = vi.hoisted(() => vi.fn())

vi.mock('./supabase', () => ({ supabase: { from } }))

import {
  fetchWeightMeasurements,
  insertWeightMeasurement,
  restoreWeightMeasurement,
  softDeleteWeightMeasurement,
  updateWeightMeasurement,
  weightMeasurementFromPending,
  type WeightMeasurement,
} from './measurements'

const row: WeightMeasurement = {
  id: 'measurement-1',
  household_id: 'household-1',
  child_id: 'child-1',
  measured_on: '2026-08-01',
  weight_grams: 3827,
  created_by: 'parent-1',
  recorded_at: '2026-08-01T15:00:00.000Z',
  updated_at: '2026-08-01T15:00:00.000Z',
  deleted_at: null,
}

afterEach(() => vi.clearAllMocks())

describe('weight measurement storage', () => {
  it('rehydrates a queued offline measurement for household reloads', () => {
    expect(weightMeasurementFromPending({
      id: row.id,
      userId: row.created_by,
      kind: 'insert_weight_measurement',
      payload: {
        id: row.id,
        household_id: row.household_id,
        child_id: row.child_id,
        measured_on: row.measured_on,
        weight_grams: row.weight_grams,
        created_by: row.created_by,
      },
      createdAt: row.recorded_at,
      attempts: 0,
    })).toEqual({ ...row, sync_status: 'offline' })
  })

  it('fetches active measurements for one household child in newest-first order', async () => {
    const builder = fluent()
    builder.range.mockResolvedValue({ data: [row], error: null })
    from.mockReturnValue(builder)

    await expect(fetchWeightMeasurements('household-1', 'child-1')).resolves.toEqual([row])
    expect(from).toHaveBeenCalledWith('weight_measurements')
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'household_id', 'household-1')
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'child_id', 'child-1')
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
    expect(builder.order).toHaveBeenNthCalledWith(1, 'measured_on', { ascending: false })
    expect(builder.order).toHaveBeenNthCalledWith(2, 'recorded_at', { ascending: false })
  })

  it('inserts and updates only the measurement fields supplied by the caller', async () => {
    const insertBuilder = mutationBuilder(row)
    const updated = { ...row, weight_grams: 3900 }
    const updateBuilder = mutationBuilder(updated)
    from.mockReturnValueOnce(insertBuilder).mockReturnValueOnce(updateBuilder)

    await expect(insertWeightMeasurement({
      id: row.id,
      household_id: row.household_id,
      child_id: row.child_id,
      measured_on: row.measured_on,
      weight_grams: row.weight_grams,
      created_by: row.created_by,
    })).resolves.toEqual(row)
    await expect(updateWeightMeasurement(row.id, { weight_grams: 3900 })).resolves.toEqual(updated)

    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ id: row.id, weight_grams: 3827 }))
    expect(updateBuilder.update).toHaveBeenCalledWith({ weight_grams: 3900 })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', row.id)
  })

  it('soft-deletes and restores without physically deleting a measurement', async () => {
    const deleteBuilder = terminalMutationBuilder()
    const restoreBuilder = terminalMutationBuilder()
    from.mockReturnValueOnce(deleteBuilder).mockReturnValueOnce(restoreBuilder)

    await softDeleteWeightMeasurement(row.id)
    await restoreWeightMeasurement(row.id)

    expect(deleteBuilder.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) })
    expect(deleteBuilder.eq).toHaveBeenCalledWith('id', row.id)
    expect(restoreBuilder.update).toHaveBeenCalledWith({ deleted_at: null })
    expect(restoreBuilder.eq).toHaveBeenCalledWith('id', row.id)
  })
})

function fluent() {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.is.mockReturnValue(builder)
  builder.order.mockReturnValue(builder)
  return builder
}

function mutationBuilder(result: WeightMeasurement) {
  const builder = {
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => ({ data: result, error: null })),
  }
  builder.insert.mockReturnValue(builder)
  builder.update.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.select.mockReturnValue(builder)
  return builder
}

function terminalMutationBuilder() {
  const builder = {
    update: vi.fn(),
    eq: vi.fn(async () => ({ error: null })),
  }
  builder.update.mockReturnValue(builder)
  return builder
}
