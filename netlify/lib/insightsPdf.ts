import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { ACTIONS, ACTION_BY_TYPE, actionLabel, poopDetailsLabel } from '../../src/lib/actionMeta'
import { dailyInsightValue, sessionMinutes, type ActionInsight, type InsightsAction, type InsightsPeriod } from '../../src/lib/insights'
import { formatDuration } from '../../src/lib/time'
import type { CareEvent, SleepInterruption } from '../../src/lib/types'

export interface InsightsPdfInput {
  babyName: string
  timezone: string
  action: InsightsAction
  period: InsightsPeriod
  generatedAt: Date
  insights: ActionInsight[]
  interruptions: SleepInterruption[]
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 46
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const FOOTER_Y = 25
const CONTENT_FLOOR = FOOTER_Y + 28
const CONTINUATION_RULE_Y = PAGE_HEIGHT - MARGIN - 16
const CONTINUATION_CONTENT_Y = CONTINUATION_RULE_Y - 24
const TABLE_PRIMARY_WIDTH = 215
const TABLE_COLUMN_GAP = 20
const TABLE_SECONDARY_X = MARGIN + TABLE_PRIMARY_WIDTH + TABLE_COLUMN_GAP
const TABLE_SECONDARY_WIDTH = PAGE_WIDTH - MARGIN - TABLE_SECONDARY_X
const INK = rgb(22 / 255, 22 / 255, 22 / 255)
const MUTED = rgb(92 / 255, 92 / 255, 92 / 255)
const LIGHT_LINE = rgb(0.82, 0.82, 0.8)
const PAPER = rgb(1, 1, 1)

export async function buildInsightsPdf(input: InsightsPdfInput): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const visibleBabyName = clean(input.babyName).trim() || 'Baby'
  document.setTitle(`${input.babyName} Insights`)
  document.setAuthor('Baby Log')
  document.setSubject(`${input.period.range} infant care report`)
  document.setCreationDate(input.generatedAt)

  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  paintPageBackground(page)
  let y = PAGE_HEIGHT - MARGIN

  const newPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    paintPageBackground(page)
    page.drawText(clean(`${visibleBabyName}'s Insights - ${scopeLabel(input)}`), {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN,
      size: 8,
      font: bold,
      color: MUTED,
    })
    page.drawLine({
      start: { x: MARGIN, y: CONTINUATION_RULE_Y },
      end: { x: PAGE_WIDTH - MARGIN, y: CONTINUATION_RULE_Y },
      thickness: 0.6,
      color: LIGHT_LINE,
    })
    y = CONTINUATION_CONTENT_Y
  }

  const ensureSpace = (height: number) => {
    if (y - height < CONTENT_FLOOR) newPage()
  }

  const hasSpace = (height: number) => y - height >= CONTENT_FLOOR

  const drawLine = (text: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = options.size ?? 10
    const font = options.font ?? regular
    const color = options.color ?? INK
    const gap = options.gap ?? 5
    const lines = wrapText(clean(text), font, size, CONTENT_WIDTH)
    ensureSpace(lines.length * (size + 3) + gap)
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y, size, font, color })
      y -= size + 3
    }
    y -= gap
  }

  drawLine('BABY LOG', { size: 9, font: bold, color: MUTED, gap: 13 })
  drawLine(`${visibleBabyName}'s Insights`, { size: 23, font: bold, gap: 2 })
  drawLine(scopeLabel(input), { size: 11, font: bold, gap: 2 })
  drawLine(`Household timezone: ${input.timezone}`, { size: 9, color: MUTED, gap: 1 })
  drawLine(`Generated ${formatTimestamp(input.generatedAt, input.timezone)}${input.period.isCurrent ? ' - current period through this time' : ''}`, { size: 9, color: MUTED, gap: 14 })

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.2, color: INK })
  y -= 18

  if (input.action === 'all') {
    drawLine('At a glance', { size: 15, font: bold, gap: 6 })
    const populated = input.insights.filter((insight) => insight.events.length).length
    drawLine(`${populated} of ${ACTIONS.length} actions have entries in this ${input.period.range}.`, { size: 10, gap: 10 })
  }

  for (const insight of input.insights) {
    drawActionSection(insight)
  }

  const pages = document.getPages()
  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({ start: { x: MARGIN, y: FOOTER_Y + 15 }, end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_Y + 15 }, thickness: 0.6, color: LIGHT_LINE })
    pdfPage.drawText('Generated from Baby Log. This is a family record, not medical advice.', {
      x: MARGIN,
      y: FOOTER_Y,
      size: 7.5,
      font: regular,
      color: MUTED,
    })
    const number = `Page ${index + 1} of ${pages.length}`
    pdfPage.drawText(number, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(number, 7.5),
      y: FOOTER_Y,
      size: 7.5,
      font: regular,
      color: MUTED,
    })
  })

  return document.save()

  function drawActionSection(insight: ActionInsight) {
    const meta = ACTION_BY_TYPE[insight.action]
    const color = hexColor(meta.color)
    ensureSpace(actionLeadHeight(insight))
    drawActionTitle(meta.label, color)

    if (!insight.events.length) {
      drawLine(`No entries for this ${input.period.range}.`, { size: 9.5, color: MUTED, gap: 14 })
      return
    }

    drawLine(headline(insight), { size: 10, font: bold, gap: 4 })
    const caveat = volumeCaveat(insight)
    if (caveat) drawLine(caveat, { size: 8.5, color: MUTED, gap: 6 })

    if (input.period.range === 'day') drawDayChart(insight, color)
    else drawDailyBars(insight, color)
    drawDetailRows(insight)
    y -= 16
  }

  function actionLeadHeight(insight: ActionInsight): number {
    const titleHeight = 22
    if (!insight.events.length) {
      return Math.ceil(titleHeight + wrappedLineHeight(`No entries for this ${input.period.range}.`, regular, 9.5, 14) + 6)
    }
    const caveat = volumeCaveat(insight)
    const chartHeight = input.period.range === 'day' ? 54 : 72
    const rows = input.period.range === 'day'
      ? insight.events.map((event) => [eventTime(event), eventValue(event)])
      : insight.days.map((day) => [formatDateKey(day.date), dailyValue(insight, day.date)])
    const firstRowHeight = rows.length ? tableRowLayout(rows[0][0], rows[0][1]).height : 0
    return Math.ceil(
      titleHeight
      + wrappedLineHeight(headline(insight), bold, 10, 4)
      + (caveat ? wrappedLineHeight(caveat, regular, 8.5, 6) : 0)
      + chartHeight
      + 21
      + firstRowHeight
      + 6,
    )
  }

  function wrappedLineHeight(text: string, font: PDFFont, size: number, gap: number): number {
    return wrapText(clean(text), font, size, CONTENT_WIDTH).length * (size + 3) + gap
  }

  function drawActionTitle(label: string, color: ReturnType<typeof rgb>, continued = false) {
    const title = continued ? `${label} (continued)` : label
    const size = continued ? 11 : 14
    const barHeight = continued ? 14 : 16
    page.drawRectangle({ x: MARGIN, y: y - 2, width: 5, height: barHeight, color })
    page.drawText(clean(title), { x: MARGIN + 13, y, size, font: bold, color: INK })
    y -= continued ? 20 : 22
  }

  function drawDayChart(insight: ActionInsight, color: ReturnType<typeof rgb>) {
    ensureSpace(65)
    const chartY = y - 32
    page.drawRectangle({ x: MARGIN, y: chartY, width: CONTENT_WIDTH, height: 32, borderWidth: 0.7, borderColor: LIGHT_LINE })
    for (const fraction of [0.25, 0.5, 0.75]) {
      const x = MARGIN + CONTENT_WIDTH * fraction
      page.drawLine({ start: { x, y: chartY }, end: { x, y: chartY + 32 }, thickness: 0.5, color: LIGHT_LINE })
    }
    for (const event of insight.events) {
      if (ACTION_BY_TYPE[insight.action].session) {
        const start = Math.max(new Date(event.occurred_at).getTime(), input.period.start.getTime())
        const end = Math.min(new Date(event.ended_at ?? input.period.effectiveEnd).getTime(), input.period.effectiveEnd.getTime())
        const total = input.period.end.getTime() - input.period.start.getTime()
        const rawX = MARGIN + CONTENT_WIDTH * ((start - input.period.start.getTime()) / total)
        const rawEndX = MARGIN + CONTENT_WIDTH * ((end - input.period.start.getTime()) / total)
        const x = clamp(rawX, MARGIN + 0.7, PAGE_WIDTH - MARGIN - 2.7)
        const width = Math.max(2, clamp(rawEndX, x + 2, PAGE_WIDTH - MARGIN - 0.7) - x)
        page.drawRectangle({ x, y: chartY + 11, width, height: 10, color, borderColor: PAPER, borderWidth: 0.6 })
      } else {
        const total = input.period.end.getTime() - input.period.start.getTime()
        const fraction = (new Date(event.occurred_at).getTime() - input.period.start.getTime()) / total
        const x = clamp(MARGIN + CONTENT_WIDTH * fraction, MARGIN + 3.5, PAGE_WIDTH - MARGIN - 3.5)
        page.drawCircle({ x, y: chartY + 16, size: 3.5, color })
      }
    }
    page.drawText('12am', { x: MARGIN, y: chartY - 10, size: 7, font: regular, color: MUTED })
    centerText(page, '12pm', MARGIN + CONTENT_WIDTH / 2, chartY - 10, 7, regular, MUTED)
    rightText(page, '12am', PAGE_WIDTH - MARGIN, chartY - 10, 7, regular, MUTED)
    y = chartY - 22
  }

  function drawDailyBars(insight: ActionInsight, color: ReturnType<typeof rgb>) {
    ensureSpace(85)
    const chartHeight = 56
    const chartY = y - chartHeight
    const values = insight.days.map((day) => dailyInsightValue(insight.action, day))
    const max = Math.max(1, ...values)
    const gap = input.period.range === 'week' ? 8 : 2
    const barWidth = Math.max(2, (CONTENT_WIDTH - gap * (values.length - 1)) / values.length)
    values.forEach((value, index) => {
      const height = value ? Math.max(2, (value / max) * chartHeight) : 0.8
      page.drawRectangle({ x: MARGIN + index * (barWidth + gap), y: chartY, width: barWidth, height, color: value ? color : LIGHT_LINE })
    })
    page.drawLine({ start: { x: MARGIN, y: chartY }, end: { x: PAGE_WIDTH - MARGIN, y: chartY }, thickness: 0.7, color: LIGHT_LINE })
    y = chartY - 16
  }

  function drawDetailRows(insight: ActionInsight) {
    const rows = input.period.range === 'day'
      ? insight.events.map((event) => [eventTime(event), eventValue(event)])
      : insight.days.map((day) => [formatDateKey(day.date), dailyValue(insight, day.date)])
    if (!rows.length) return
    const leftHeader = input.period.range === 'day' ? 'Time' : 'Date'
    drawTableHeader(leftHeader, 'Details')
    for (const [left, right] of rows) {
      const layout = tableRowLayout(left, right)
      if (!hasSpace(layout.height)) {
        newPage()
        drawActionTitle(ACTION_BY_TYPE[insight.action].label, hexColor(ACTION_BY_TYPE[insight.action].color), true)
        drawTableHeader(leftHeader, 'Details')
      }
      drawTableRow(layout)
    }
  }

  function drawTableHeader(left: string, right: string) {
    ensureSpace(24)
    page.drawText(left, { x: MARGIN, y, size: 8, font: bold, color: MUTED })
    page.drawText(right, { x: TABLE_SECONDARY_X, y, size: 8, font: bold, color: MUTED })
    y -= 8
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.7, color: LIGHT_LINE })
    y -= 13
  }

  function tableRowLayout(left: string, right: string) {
    const size = 8.5
    const leftLines = wrapText(clean(left), regular, size, TABLE_PRIMARY_WIDTH)
    const rightLines = wrapText(clean(right), regular, size, TABLE_SECONDARY_WIDTH)
    const lines = Math.max(leftLines.length, rightLines.length)
    return { size, leftLines, rightLines, height: lines * 11 + 12 }
  }

  function drawTableRow(layout: ReturnType<typeof tableRowLayout>) {
    const { size, leftLines, rightLines } = layout
    const lines = Math.max(leftLines.length, rightLines.length)
    leftLines.forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - index * 11, size, font: regular, color: INK }))
    rightLines.forEach((line, index) => page.drawText(line, { x: TABLE_SECONDARY_X, y: y - index * 11, size, font: regular, color: INK }))
    y -= lines * 11 + 5
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.35, color: LIGHT_LINE })
    y -= 7
  }

  function eventTime(event: CareEvent): string {
    const rawStart = new Date(event.occurred_at)
    if (!ACTION_BY_TYPE[event.event_type].session) return formatTimestamp(rawStart, input.timezone, false)
    const rawEnd = new Date(event.ended_at ?? input.period.effectiveEnd)
    const clippedStart = new Date(Math.max(rawStart.getTime(), input.period.start.getTime()))
    const clippedEnd = new Date(Math.min(rawEnd.getTime(), input.period.effectiveEnd.getTime()))
    const start = `${formatTimestamp(clippedStart, input.timezone, false)}${rawStart < input.period.start ? ' (continued)' : ''}`
    const end = !event.ended_at && input.period.isCurrent
      ? 'Ongoing'
      : `${formatTimestamp(clippedEnd, input.timezone, false)}${rawEnd > input.period.effectiveEnd || !event.ended_at ? ' (continues)' : ''}`
    return `${start} - ${end}`
  }

  function eventValue(event: CareEvent): string {
    if (ACTION_BY_TYPE[event.event_type].session) {
      const minutes = sessionMinutes(event, input.interruptions, input.period.start, input.period.effectiveEnd)
      const amount = event.event_type === 'pump' && event.details.amount_ml ? `; ${Math.round(event.details.amount_ml)} ml` : ''
      return `${formatDuration(minutes)}${amount}`
    }
    if (event.event_type === 'feed' && event.details.amount_ml) return `${Math.round(event.details.amount_ml)} ml`
    if (event.event_type === 'poop') return poopDetailsLabel(event.details) || 'Recorded'
    return 'Recorded'
  }

  function dailyValue(insight: ActionInsight, date: string): string {
    const day = insight.days.find((item) => item.date === date)
    if (!day) return 'No entries'
    if (ACTION_BY_TYPE[insight.action].session) {
      const count = `${day.count} ${day.count === 1 ? 'session' : 'sessions'}`
      const interruptions = insight.action === 'sleep' && day.interruptions ? `; ${day.interruptions} interruptions` : ''
      const volume = insight.action === 'pump' && day.volumeMl ? `; ${Math.round(day.volumeMl)} ml` : ''
      return `${formatDuration(day.minutes)}; ${count}${volume}${interruptions}`
    }
    const volume = (insight.action === 'feed' || insight.action === 'pump') && day.volumeMl ? `; ${Math.round(day.volumeMl)} ml` : ''
    return day.count ? `${day.count} ${day.count === 1 ? 'entry' : 'entries'}${volume}` : 'No entries'
  }
}

function scopeLabel(input: InsightsPdfInput): string {
  const action = input.action === 'all' ? 'All Actions' : actionLabel(input.action)
  return `${action} - ${input.period.label}`
}

function headline(insight: ActionInsight): string {
  if (!insight.events.length) return 'No entries'
  if (ACTION_BY_TYPE[insight.action].session) {
    let result = `${insight.count} ${insight.count === 1 ? 'session' : 'sessions'}; ${formatDuration(insight.minutes)}`
    if (insight.action === 'sleep') result += `; longest ${formatDuration(insight.longestMinutes)}`
    if (insight.action === 'sleep' && insight.interruptions) result += `; ${insight.interruptions} interruption${insight.interruptions === 1 ? '' : 's'}`
    if (insight.action === 'pump' && insight.volumeEntries) result += `; ${Math.round(insight.volumeMl)} ml recorded`
    return result
  }
  const singular = insight.action === 'hiccups' ? 'episode' : 'entry'
  const plural = insight.action === 'hiccups' ? 'episodes' : 'entries'
  let result = `${insight.count} ${insight.count === 1 ? singular : plural}`
  if (['poop', 'pee', 'feed', 'hiccups'].includes(insight.action) && insight.medianIntervalMinutes !== null) {
    result += `; typical gap ${formatDuration(insight.medianIntervalMinutes)}`
  }
  if (insight.action === 'feed' && insight.volumeEntries) result += `; ${Math.round(insight.volumeMl)} ml recorded`
  if (insight.action === 'diaper_check') {
    const outcomes = diaperOutcomeSummary(insight)
    if (outcomes) result += `; ${outcomes}`
  }
  return result
}

function diaperOutcomeSummary(insight: ActionInsight): string {
  const order = ['wet', 'soiled', 'mixed', 'dry', 'rash'] as const
  const labels = { wet: 'wet', soiled: 'soiled', mixed: 'mixed', dry: 'dry', rash: 'rash noticed' }
  return order
    .map((outcome) => ({ outcome, count: insight.events.filter((event) => event.details.outcome === outcome).length }))
    .filter(({ count }) => count)
    .map(({ outcome, count }) => `${count} ${labels[outcome]}`)
    .join(', ')
}

function volumeCaveat(insight: ActionInsight): string {
  if ((insight.action !== 'feed' && insight.action !== 'pump') || !insight.missingVolume) return ''
  return `${insight.missingVolume} ${insight.missingVolume === 1 ? 'entry has' : 'entries have'} no amount recorded; missing amounts are not counted as zero.`
}

function formatTimestamp(date: Date, timezone: string, includeDate = true): string {
  return new Intl.DateTimeFormat('en-US', {
    ...(includeDate ? { month: 'short', day: 'numeric', year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    timeZoneName: includeDate ? 'short' : undefined,
  }).format(date)
}

function formatDateKey(dateKey: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${dateKey}T12:00:00Z`))
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean).flatMap((word) => splitWord(word, font, size, maxWidth))
  if (!words.length) return ['']
  const lines: string[] = []
  let line = words[0]
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  lines.push(line)
  return lines
}

function splitWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word]
  const pieces: string[] = []
  let piece = ''
  for (const character of word) {
    const candidate = `${piece}${character}`
    if (piece && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      pieces.push(piece)
      piece = character
    } else {
      piece = candidate
    }
  }
  if (piece) pieces.push(piece)
  return pieces
}

function clean(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[–—]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '')
}

function hexColor(value: string): ReturnType<typeof rgb> {
  const normalized = value.replace('#', '')
  return rgb(
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function centerText(page: PDFPage, text: string, center: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  page.drawText(text, { x: center - font.widthOfTextAtSize(text, size) / 2, y, size, font, color })
}

function rightText(page: PDFPage, text: string, right: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  page.drawText(clean(text), { x: right - font.widthOfTextAtSize(clean(text), size), y, size, font, color })
}

function paintPageBackground(page: PDFPage) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: PAPER })
}
