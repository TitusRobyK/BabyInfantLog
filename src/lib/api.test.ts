import { afterEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: 'token-1' } } })),
  refreshSession: vi.fn(async () => ({ data: { session: { access_token: 'token-2' } } })),
}))

vi.mock('./supabase', () => ({ supabase: { auth } }))

import { downloadInsightsReport } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Insights report API', () => {
  it('returns a PDF blob and server-provided private filename', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(new Uint8Array([37, 80, 68, 70, 45]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="Abel-insights-2026-07-13-to-2026-07-19.pdf"',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const report = await downloadInsightsReport({ action: 'all', range: 'week', anchorDate: '2026-07-13' })
    expect(report.filename).toBe('Abel-insights-2026-07-13-to-2026-07-19.pdf')
    expect(report.blob.type).toBe('application/pdf')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'Bearer token-1' })
  })

  it('surfaces a private report error from the function', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Finish joining a family before downloading a report.' }, { status: 403 })))
    await expect(downloadInsightsReport({ action: 'poop', range: 'day', anchorDate: '2026-07-13' }))
      .rejects.toThrow('Finish joining a family before downloading a report.')
  })
})
