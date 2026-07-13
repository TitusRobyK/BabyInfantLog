import type { Config } from '@netlify/functions'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { ACTIONS, ACTION_BY_TYPE } from '../../src/lib/actionMeta'
import { buildActionInsight, periodFor, type InsightsAction, type InsightsRange } from '../../src/lib/insights'
import type { CareEvent, EventType, SleepInterruption } from '../../src/lib/types'
import { buildInsightsPdf } from '../lib/insightsPdf'

interface ReportBody {
  action?: InsightsAction
  range?: InsightsRange
  anchorDate?: string
}

const actionValues = new Set<InsightsAction>(['all', ...ACTIONS.map((action) => action.type)])
const rangeValues = new Set<InsightsRange>(['day', 'week', 'month'])
const pageSize = 1000
const maximumRows = 12_000

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'private, no-store, max-age=0', pragma: 'no-cache', 'x-content-type-options': 'nosniff' },
  })
}

async function authenticatedUser(client: SupabaseClient, request: Request): Promise<User | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

function validBody(value: unknown): value is Required<ReportBody> {
  if (!value || typeof value !== 'object') return false
  const body = value as ReportBody
  return Boolean(
    body.action && actionValues.has(body.action) &&
    body.range && rangeValues.has(body.range) &&
    body.anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(body.anchorDate),
  )
}

async function paged<T>(loader: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loader(from, from + pageSize - 1)
    if (error) throw new Error('Report data query failed.')
    const page = data ?? []
    rows.push(...page)
    if (rows.length > maximumRows) throw new ReportTooLargeError()
    if (page.length < pageSize) return rows
  }
}

class ReportTooLargeError extends Error {
  constructor() {
    super('Report is too large.')
    this.name = 'ReportTooLargeError'
  }
}

async function fetchEvents(
  client: SupabaseClient,
  householdId: string,
  childId: string,
  action: InsightsAction,
  start: Date,
  end: Date,
): Promise<CareEvent[]> {
  const selectedTypes = action === 'all' ? ACTIONS.map((item) => item.type) : [action]
  const discreteTypes = selectedTypes.filter((type) => !ACTION_BY_TYPE[type].session)
  const sessionTypes = selectedTypes.filter((type) => ACTION_BY_TYPE[type].session)
  const rows: CareEvent[] = []

  if (discreteTypes.length) {
    rows.push(...await paged<CareEvent>((from, to) => client
      .from('events')
      .select('*')
      .eq('household_id', householdId)
      .eq('child_id', childId)
      .is('deleted_at', null)
      .in('event_type', discreteTypes)
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', end.toISOString())
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)))
  }

  if (sessionTypes.length) {
    rows.push(...await paged<CareEvent>((from, to) => client
      .from('events')
      .select('*')
      .eq('household_id', householdId)
      .eq('child_id', childId)
      .is('deleted_at', null)
      .in('event_type', sessionTypes)
      .lt('occurred_at', end.toISOString())
      .or(`ended_at.is.null,ended_at.gt.${start.toISOString()}`)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)))
  }

  return rows.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
}

async function fetchInterruptions(
  client: SupabaseClient,
  householdId: string,
  childId: string,
  start: Date,
  end: Date,
): Promise<SleepInterruption[]> {
  return paged<SleepInterruption>((from, to) => client
    .from('sleep_interruptions')
    .select('*')
    .eq('household_id', householdId)
    .eq('child_id', childId)
    .is('deleted_at', null)
    .lt('started_at', end.toISOString())
    .or(`ended_at.is.null,ended_at.gt.${start.toISOString()}`)
    .order('started_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to))
}

function filename(babyName: string, start: string, endInclusive: string): string {
  const safeBaby = babyName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'baby'
  return `${safeBaby}-insights-${start}-to-${endInclusive}.pdf`
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const client = adminClient()
    const user = await authenticatedUser(client, request)
    if (!user) return json({ error: 'Your session expired. Sign in again to continue.' }, 401)

    const body = await request.json().catch(() => null)
    if (!validBody(body)) return json({ error: 'Choose a valid action, range, and date.' }, 400)

    const { data: membership, error: membershipError } = await client
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (membershipError) throw new Error('Membership query failed.')
    if (!membership) return json({ error: 'Finish joining a family before downloading a report.' }, 403)

    const [{ data: household, error: householdError }, { data: child, error: childError }] = await Promise.all([
      client.from('households').select('id, timezone').eq('id', membership.household_id).single(),
      client.from('children').select('id, nickname').eq('household_id', membership.household_id).eq('active', true).single(),
    ])
    if (householdError || childError || !household || !child) return json({ error: 'The family report is not available.' }, 403)

    const generatedAt = new Date()
    let period
    try {
      period = periodFor(body.range, body.anchorDate, household.timezone, generatedAt)
    } catch {
      return json({ error: 'Choose a valid report date.' }, 400)
    }
    if (period.isFuture) return json({ error: 'Future reports are not available.' }, 400)

    const events = await fetchEvents(client, household.id, child.id, body.action, period.start, period.effectiveEnd)
    const needsInterruptions = body.action === 'all' || body.action === 'sleep'
    const interruptions = needsInterruptions
      ? await fetchInterruptions(client, household.id, child.id, period.start, period.effectiveEnd)
      : []
    const requestedTypes: EventType[] = body.action === 'all' ? ACTIONS.map((item) => item.type) : [body.action]
    const insights = requestedTypes.map((type) => buildActionInsight(type, events, interruptions, period, household.timezone))
    const bytes = await buildInsightsPdf({
      babyName: child.nickname,
      timezone: household.timezone,
      action: body.action,
      period,
      generatedAt,
      insights,
      interruptions,
    })

    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename(child.nickname, period.startKey, period.dateKeys.at(-1) ?? period.startKey)}"`,
        'cache-control': 'private, no-store, max-age=0',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('insights-report failed', error instanceof Error ? error.name : 'unknown')
    if (error instanceof ReportTooLargeError) return json({ error: 'This report contains too many entries. Choose a shorter period.' }, 413)
    return json({ error: 'We could not prepare the report. Try again.' }, 500)
  }
}

export const config: Config = {
  path: '/api/insights-report',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip'],
    windowSize: 60,
    windowLimit: 6,
  },
}
