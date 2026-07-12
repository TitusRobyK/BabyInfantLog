export type ParentType = 'mother' | 'father' | 'parent_guardian'
export type EventType = 'poop' | 'pee' | 'feed' | 'burp' | 'sleep' | 'diaper_check' | 'pump'
export type VolumeUnit = 'ml' | 'fl_oz'

export interface ParentProfile {
  user_id: string
  display_name: string
  parent_type: ParentType
  show_pump_action: boolean
  volume_unit: VolumeUnit
  created_at: string
  updated_at: string
}

export interface Household {
  id: string
  name: string
  timezone: string
  created_at: string
}

export interface HouseholdMember {
  household_id: string
  user_id: string
  role: 'parent'
  joined_at: string
  profile?: ParentProfile
}

export interface Child {
  id: string
  household_id: string
  nickname: string
  birth_date: string | null
  active: boolean
  created_at: string
}

export interface EventDetails {
  size?: 'small' | 'medium' | 'large'
  feed_type?: 'breast_milk' | 'formula' | 'mixed'
  side?: 'left' | 'right' | 'both'
  amount?: number
  unit?: VolumeUnit
  amount_ml?: number
  left_amount?: number
  right_amount?: number
  outcome?: 'dry' | 'wet' | 'soiled' | 'mixed' | 'rash'
  ended_by?: string
}

export interface SleepInterruption {
  id: string
  household_id: string
  child_id: string
  sleep_event_id: string
  started_at: string
  ended_at: string | null
  created_by: string
  ended_by: string | null
  recorded_at: string
  updated_at: string
  deleted_at: string | null
  sync_status?: 'saved' | 'syncing' | 'offline' | 'error'
}

export interface CareEvent {
  id: string
  household_id: string
  child_id: string
  created_by: string
  subject_parent_id: string | null
  event_type: EventType
  occurred_at: string
  ended_at: string | null
  client_timezone_offset_minutes: number
  details: EventDetails
  recorded_at: string
  updated_at: string
  deleted_at: string | null
  sync_status?: 'saved' | 'syncing' | 'offline' | 'error'
}

export interface DailySummary {
  id: string
  household_id: string
  child_id: string
  period_start: string
  period_end: string
  metrics: Record<string, unknown>
  comparison: Record<string, unknown>
  generated_at: string
}

export interface AppContext {
  profile: ParentProfile | null
  membership: HouseholdMember | null
  household: Household | null
  child: Child | null
  members: HouseholdMember[]
}

export interface PendingOperation {
  id: string
  userId: string
  kind: 'insert_event' | 'session_state' | 'sleep_interruption_state'
  payload: Record<string, unknown>
  createdAt: string
  attempts: number
}
