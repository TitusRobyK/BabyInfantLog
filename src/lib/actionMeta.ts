import type { EventDetails, EventType, PoopColor } from './types'

export interface ActionMeta {
  type: EventType
  label: string
  icon: string
  color: string
  session: boolean
}

export const ACTIONS: readonly ActionMeta[] = [
  { type: 'poop', label: 'Poop', icon: '●', color: '#8A4F39', session: false },
  { type: 'pee', label: 'Pee', icon: '◇', color: '#9A6A00', session: false },
  { type: 'feed', label: 'Feed', icon: '+', color: '#286A8A', session: false },
  { type: 'burp', label: 'Burp', icon: '○', color: '#6C4D91', session: false },
  { type: 'sleep', label: 'Sleep', icon: '—', color: '#445C8A', session: true },
  { type: 'diaper_check', label: 'Diaper check', icon: '✓', color: '#3F7352', session: false },
  { type: 'hiccups', label: 'Hiccups', icon: '≈', color: '#9A4668', session: false },
  { type: 'pump', label: 'Pump', icon: '↕', color: '#985336', session: true },
] as const

export const ACTION_BY_TYPE = Object.fromEntries(ACTIONS.map((action) => [action.type, action])) as Record<EventType, ActionMeta>

export const POOP_COLORS: readonly { value: PoopColor; label: string; swatch: string; attention?: string }[] = [
  { value: 'mustard_yellow', label: 'Mustard', swatch: '#C28A16' },
  { value: 'tan', label: 'Tan', swatch: '#B68A62' },
  { value: 'brown', label: 'Brown', swatch: '#78513A' },
  { value: 'orange', label: 'Orange', swatch: '#C86A24' },
  { value: 'green', label: 'Green', swatch: '#4F7A43' },
  { value: 'dark_green', label: 'Dark green', swatch: '#294D36' },
  {
    value: 'red',
    label: 'Red',
    swatch: '#A33B32',
    attention: 'Red may come from food, but it can also be blood. Contact your baby’s pediatrician promptly.',
  },
  {
    value: 'pale_white',
    label: 'Pale / white',
    swatch: '#F2EBD9',
    attention: 'Pale, white, or chalky stool needs prompt medical advice. Contact your baby’s pediatrician.',
  },
  {
    value: 'black_tarry',
    label: 'Black / tarry',
    swatch: '#1E211F',
    attention: 'Black stool can be normal during the first few newborn stools. After that, contact your baby’s pediatrician promptly.',
  },
] as const

export function actionLabel(type: EventType): string {
  return ACTION_BY_TYPE[type].label
}

export function poopColorLabel(color: PoopColor): string {
  return POOP_COLORS.find((option) => option.value === color)?.label ?? color
}

export function poopDetailsLabel(details: EventDetails): string {
  const values = [
    details.size ? capitalize(details.size) : '',
    details.consistency ? (details.consistency === 'formed' ? 'Formed' : 'Liquid') : '',
    details.color ? poopColorLabel(details.color) : '',
  ].filter(Boolean)
  return values.join(' · ')
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
