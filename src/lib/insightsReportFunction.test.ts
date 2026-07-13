import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}))

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@supabase/supabase-js')>()
  return { ...original, createClient: vi.fn(() => client) }
})

import insightsReport, { config } from '../../netlify/functions/insights-report.mts'

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
  vi.clearAllMocks()
})

describe('Insights report function boundary', () => {
  it('limits repeated PDF generation requests', () => {
    expect(config.rateLimit).toMatchObject({ action: 'rate_limit', windowSize: 60, windowLimit: 6 })
  })

  it('rejects requests without a bearer token and prevents caching', async () => {
    const response = await insightsReport(new Request('https://example.com/api/insights-report', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(client.from).not.toHaveBeenCalled()
  })

  it('validates report filters before querying family data', async () => {
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'parent-1' } }, error: null })
    const response = await insightsReport(new Request('https://example.com/api/insights-report', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unknown', range: 'week', anchorDate: '2026-07-13' }),
    }))
    expect(response.status).toBe(400)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('does not generate a report for an authenticated account without a family', async () => {
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'parent-1' } }, error: null })
    const membershipQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    client.from.mockReturnValue(membershipQuery)
    const response = await insightsReport(new Request('https://example.com/api/insights-report', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'all', range: 'week', anchorDate: '2026-07-13' }),
    }))
    expect(response.status).toBe(403)
    expect(client.from).toHaveBeenCalledWith('household_members')
  })

  it('generates a private PDF using only the authenticated family scope', async () => {
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'parent-1' } }, error: null })
    const membership = terminalQuery('maybeSingle', { household_id: 'household-1' })
    const household = terminalQuery('single', { id: 'household-1', timezone: 'America/Chicago' })
    const child = terminalQuery('single', { id: 'child-1', nickname: 'Abel' })
    const events = terminalQuery('range', [])
    client.from.mockImplementation((table: string) => ({
      household_members: membership,
      households: household,
      children: child,
      events,
    })[table])

    const response = await insightsReport(new Request('https://example.com/api/insights-report', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'poop', range: 'day', anchorDate: '2026-07-12', householdId: 'other-family' }),
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('content-disposition')).toContain('abel-insights-2026-07-12-to-2026-07-12.pdf')
    expect(events.eq).toHaveBeenCalledWith('household_id', 'household-1')
    expect(events.eq).toHaveBeenCalledWith('child_id', 'child-1')
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
  })
})

function terminalQuery(terminal: 'maybeSingle' | 'single' | 'range', data: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'is', 'in', 'gte', 'lt', 'or', 'order']) {
    query[method] = vi.fn(() => query)
  }
  query[terminal] = vi.fn(async () => ({ data, error: null }))
  return query
}
