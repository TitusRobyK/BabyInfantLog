import type { InsightsPeriod } from './insights'
import type { WeightMeasurement } from './types'

export interface WeightInsightDay {
  date: string
  measurements: WeightMeasurement[]
}

export interface WeightInsight {
  measurements: WeightMeasurement[]
  latest: WeightMeasurement | null
  previous: WeightMeasurement | null
  latestBeforePeriod: WeightMeasurement | null
  changeGrams: number | null
  days: WeightInsightDay[]
}

export function buildWeightInsight(
  source: WeightMeasurement[],
  period: InsightsPeriod,
): WeightInsight {
  const active = source
    .filter((measurement) => !measurement.deleted_at)
    .slice()
    .sort(compareAscending)
  const measurements = active.filter(
    (measurement) => measurement.measured_on >= period.startKey && measurement.measured_on < period.endKeyExclusive,
  )
  const latest = measurements.at(-1) ?? null
  const previous = latest
    ? active.filter((measurement) => compareAscending(measurement, latest) < 0).at(-1) ?? null
    : null
  const latestBeforePeriod = active.filter((measurement) => measurement.measured_on < period.startKey).at(-1) ?? null

  return {
    measurements,
    latest,
    previous,
    latestBeforePeriod,
    changeGrams: latest && previous ? latest.weight_grams - previous.weight_grams : null,
    days: period.dateKeys.map((date) => ({
      date,
      measurements: measurements.filter((measurement) => measurement.measured_on === date),
    })),
  }
}

function compareAscending(left: WeightMeasurement, right: WeightMeasurement): number {
  return left.measured_on.localeCompare(right.measured_on)
    || left.recorded_at.localeCompare(right.recorded_at)
    || left.id.localeCompare(right.id)
}
