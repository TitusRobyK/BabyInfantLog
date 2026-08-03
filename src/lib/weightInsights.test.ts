import { describe, expect, it } from 'vitest'
import { periodFor } from './insights'
import type { WeightMeasurement } from './types'
import { buildWeightInsight } from './weightInsights'

describe('weight insights', () => {
  it('uses date-only measurements and the previous reading for a neutral change', () => {
    const period = periodFor('week', '2026-07-27', 'America/Chicago', new Date('2026-08-03T18:00:00Z'))
    const insight = buildWeightInsight([
      measurement('before', '2026-07-20', 3500),
      measurement('first', '2026-07-27', 3680),
      measurement('latest', '2026-08-02', 3805),
      { ...measurement('deleted', '2026-08-01', 9999), deleted_at: '2026-08-02T00:00:00Z' },
    ], period)

    expect(insight.measurements.map((item) => item.id)).toEqual(['first', 'latest'])
    expect(insight.latest?.id).toBe('latest')
    expect(insight.previous?.id).toBe('first')
    expect(insight.changeGrams).toBe(125)
    expect(insight.days.find((day) => day.date === '2026-08-02')?.measurements).toHaveLength(1)
  })

  it('provides the latest earlier reading without plotting it in an empty period', () => {
    const period = periodFor('day', '2026-08-02', 'UTC', new Date('2026-08-03T00:00:00Z'))
    const insight = buildWeightInsight([measurement('older', '2026-08-01', 3700)], period)
    expect(insight.measurements).toEqual([])
    expect(insight.latestBeforePeriod?.id).toBe('older')
  })
})

function measurement(id: string, measuredOn: string, weightGrams: number): WeightMeasurement {
  return {
    id,
    household_id: 'household-1',
    child_id: 'child-1',
    measured_on: measuredOn,
    weight_grams: weightGrams,
    created_by: 'parent-1',
    recorded_at: `${measuredOn}T12:00:00Z`,
    updated_at: `${measuredOn}T12:00:00Z`,
    deleted_at: null,
  }
}
