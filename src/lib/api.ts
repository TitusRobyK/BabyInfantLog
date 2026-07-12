import { supabase } from './supabase'

export interface InvitePreview {
  babyNickname: string
  parentName: string
  expiresAt: string
}

async function request<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Please sign in again.')

  const response = await fetch('/api/family-invite', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...body }),
  })

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.')
  return payload
}

export function generateInvite(email: string): Promise<{ code: string; expiresAt: string }> {
  return request('generate', { email })
}

export function previewInvite(code: string): Promise<InvitePreview> {
  return request('preview', { code })
}

export function claimInvite(code: string): Promise<{ householdId: string }> {
  return request('claim', { code })
}
