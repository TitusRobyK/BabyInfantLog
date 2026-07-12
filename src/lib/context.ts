import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AppContext, Child, Household, HouseholdMember, ParentProfile } from './types'

export const emptyContext: AppContext = {
  profile: null,
  membership: null,
  household: null,
  child: null,
  members: [],
}

export async function loadContext(user: User): Promise<AppContext> {
  const { data: profile, error: profileError } = await supabase
    .from('parent_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (profileError) throw profileError

  const { data: membership, error: membershipError } = await supabase
    .from('household_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (membershipError) throw membershipError

  if (!membership) {
    return { ...emptyContext, profile: (profile as ParentProfile | null) ?? null }
  }

  const [{ data: household, error: householdError }, { data: child, error: childError }, { data: members, error: membersError }] =
    await Promise.all([
      supabase.from('households').select('*').eq('id', membership.household_id).single(),
      supabase.from('children').select('*').eq('household_id', membership.household_id).eq('active', true).single(),
      supabase.from('household_members').select('*').eq('household_id', membership.household_id),
    ])

  if (householdError) throw householdError
  if (childError) throw childError
  if (membersError) throw membersError

  const memberRows = (members ?? []) as HouseholdMember[]
  const userIds = memberRows.map((member) => member.user_id)
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase.from('parent_profiles').select('*').in('user_id', userIds)
    : { data: [], error: null }
  if (profilesError) throw profilesError

  const profileMap = new Map((profiles as ParentProfile[]).map((item) => [item.user_id, item]))
  const membersWithProfiles = memberRows.map((member) => ({ ...member, profile: profileMap.get(member.user_id) }))

  return {
    profile: (profile as ParentProfile | null) ?? null,
    membership: membership as HouseholdMember,
    household: household as Household,
    child: child as Child,
    members: membersWithProfiles,
  }
}
