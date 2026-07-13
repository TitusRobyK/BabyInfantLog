import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildInsightsPdf } from '../../netlify/lib/insightsPdf'
import { ACTIONS } from './actionMeta'
import { buildActionInsight, periodFor } from './insights'
import type { CareEvent, EventDetails, EventType } from './types'

describe('Insights PDF', () => {
  it('creates a valid private-report document for a selected action', async () => {
    const period = periodFor('week', '2026-07-13', 'America/Chicago', new Date('2026-07-21T00:00:00Z'))
    const event: CareEvent = {
      id: 'poop-1',
      household_id: 'household-1',
      child_id: 'child-1',
      created_by: 'parent-1',
      subject_parent_id: null,
      event_type: 'poop',
      occurred_at: '2026-07-13T12:00:00Z',
      ended_at: null,
      client_timezone_offset_minutes: 0,
      details: { size: 'medium', consistency: 'liquid', color: 'mustard_yellow' },
      recorded_at: '2026-07-13T12:00:00Z',
      updated_at: '2026-07-13T12:00:00Z',
      deleted_at: null,
    }
    const insight = buildActionInsight('poop', [event], [], period, 'America/Chicago')
    const bytes = await buildInsightsPdf({
      babyName: 'Abel',
      timezone: 'America/Chicago',
      action: 'poop',
      period,
      generatedAt: new Date('2026-07-20T22:00:00Z'),
      insights: [insight],
      interruptions: [],
    })

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBeGreaterThan(0)
    expect(document.getTitle()).toBe('Abel Insights')
  })

  it('keeps trailing empty actions with the preceding all-actions report content', async () => {
    const generatedAt = new Date('2026-07-13T22:46:00Z')
    const period = periodFor('day', '2026-07-13', 'America/Chicago', generatedAt)
    const events: CareEvent[] = [
      ...eventsAt('poop', ['2026-07-13T18:09:00Z', '2026-07-13T18:45:00Z']),
      ...eventsAt('pee', [
        '2026-07-13T09:32:00Z',
        '2026-07-13T11:30:00Z',
        '2026-07-13T15:08:00Z',
        '2026-07-13T19:40:00Z',
        '2026-07-13T20:45:00Z',
        '2026-07-13T22:43:00Z',
      ]),
      ...eventsAt('feed', [
        '2026-07-13T07:08:00Z',
        '2026-07-13T09:31:00Z',
        '2026-07-13T11:30:00Z',
        '2026-07-13T13:51:00Z',
        '2026-07-13T15:17:00Z',
        '2026-07-13T15:44:00Z',
        '2026-07-13T18:19:00Z',
        '2026-07-13T18:44:00Z',
        '2026-07-13T20:11:00Z',
        '2026-07-13T21:11:00Z',
      ], (index) => index >= 3 && index !== 8 ? { amount_ml: 20 + index } : {}),
      ...eventsAt('burp', [
        '2026-07-13T13:51:00Z',
        '2026-07-13T15:39:00Z',
        '2026-07-13T15:48:00Z',
        '2026-07-13T18:22:00Z',
        '2026-07-13T18:45:00Z',
        '2026-07-13T20:20:00Z',
      ]),
      event('sleep', '2026-07-13T04:00:00Z', {}, '2026-07-13T09:31:00Z'),
      event('sleep', '2026-07-13T11:37:00Z', {}, '2026-07-13T13:52:00Z'),
      event('sleep', '2026-07-13T13:52:00Z', {}, '2026-07-13T18:06:00Z'),
      event('sleep', '2026-07-13T20:34:00Z'),
      ...eventsAt('diaper_check', [
        '2026-07-13T07:07:00Z',
        '2026-07-13T09:32:00Z',
        '2026-07-13T11:30:00Z',
        '2026-07-13T17:56:00Z',
        '2026-07-13T18:09:00Z',
      ]),
    ]
    const insights = ACTIONS.map(({ type }) => buildActionInsight(type, events, [], period, 'America/Chicago'))
    const bytes = await buildInsightsPdf({
      babyName: 'Sample Baby',
      timezone: 'America/Chicago',
      action: 'all',
      period,
      generatedAt,
      insights,
      interruptions: [],
    })

    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBe(3)
    const pages = decodedPageContents(document)
    const trailingEmptyPage = pages.find((content) => hasText(content, 'Hiccups') && hasText(content, 'Pump'))
    expect(trailingEmptyPage).toBeDefined()

    const feedPage = pages.find((content) => hasText(content, 'Feed'))
    expect(feedPage).toBeDefined()
    const feed = textPosition(feedPage!, 'Feed')
    const dividerYs = [...feedPage!.matchAll(/46 ([\d.]+) m\n46 \1 m\n566 \1 l\nS/g)]
      .map((match) => Number(match[1]))
      .filter((lineY) => lineY > feed.y)
    expect(Math.min(...dividerYs) - feed.y).toBeGreaterThanOrEqual(20)

    const details = textPosition(feedPage!, 'Details')
    const recorded = textPosition(feedPage!, 'Recorded')
    const amount = textPosition(feedPage!, '23 ml')
    expect(recorded.x).toBe(details.x)
    expect(amount.x).toBe(details.x)
  })
})

function decodedPageContents(document: PDFDocument): string[] {
  return document.getPages().map((page) => {
    const contents = page.node.Contents()
    const references = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
    return references.map((reference) => {
      const stream = document.context.lookup(reference)
      return stream instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(stream).decode()) : ''
    }).join('\n')
  })
}

function hasText(content: string, text: string): boolean {
  return content.includes(`<${Buffer.from(text, 'ascii').toString('hex').toUpperCase()}> Tj`)
}

function textPosition(content: string, text: string): { x: number; y: number } {
  const hex = Buffer.from(text, 'ascii').toString('hex').toUpperCase()
  const match = content.match(new RegExp(`1 0 0 1 ([\\d.]+) ([\\d.]+) Tm\\n<${hex}> Tj`))
  if (!match) throw new Error(`Text not found in generated PDF: ${text}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

function eventsAt(type: EventType, timestamps: string[], details: (index: number) => EventDetails = () => ({})): CareEvent[] {
  return timestamps.map((timestamp, index) => event(type, timestamp, details(index)))
}

function event(type: EventType, occurredAt: string, details: EventDetails = {}, endedAt: string | null = null): CareEvent {
  const id = `${type}-${occurredAt}`
  return {
    id,
    household_id: 'household-1',
    child_id: 'child-1',
    created_by: 'parent-1',
    subject_parent_id: null,
    event_type: type,
    occurred_at: occurredAt,
    ended_at: endedAt,
    client_timezone_offset_minutes: 300,
    details,
    recorded_at: occurredAt,
    updated_at: occurredAt,
    deleted_at: null,
  }
}
