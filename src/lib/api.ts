import { supabase } from './supabase'

export interface InvitePreview {
  babyNickname: string
  parentName: string
  expiresAt: string
}

export type EmailDeliveryStatus = 'not_sent' | 'sent' | 'failed'

export interface InviteGeneration {
  code: string
  expiresAt: string
  emailDelivery: { status: EmailDeliveryStatus; cooldownUntil?: string }
}

export interface InviteEmailDelivery {
  emailDelivery: { status: 'sent' | 'failed'; sentAt?: string; cooldownUntil?: string }
}

export class InviteEmailCooldownError extends Error {
  constructor(
    message: string,
    public readonly cooldownUntil: string,
  ) {
    super(message)
    this.name = 'InviteEmailCooldownError'
  }
}

async function request<T>(action: string, body: Record<string, unknown>): Promise<T> {
  async function run(token: string) {
    return fetch('/api/family-invite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...body }),
    })
  }

  const { data } = await supabase.auth.getSession()
  let token = data.session?.access_token
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    token = refreshed.session?.access_token
  }
  if (!token) throw new Error('Your session expired. Sign in again to continue.')

  let response = await run(token)
  if (response.status === 401) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    const refreshedToken = refreshed.session?.access_token
    if (refreshedToken) response = await run(refreshedToken)
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: string; cooldownUntil?: string } & T
  if (!response.ok) {
    const message = payload.error || 'The request could not be completed.'
    if (response.status === 429 && payload.cooldownUntil) {
      throw new InviteEmailCooldownError(message, payload.cooldownUntil)
    }
    throw new Error(message)
  }
  return payload
}

export function generateInvite(email: string): Promise<InviteGeneration> {
  return request('generate', { email })
}

export function emailInvite(code: string): Promise<InviteEmailDelivery> {
  return request('send', { code })
}

export function previewInvite(code: string): Promise<InvitePreview> {
  return request('preview', { code })
}

export function claimInvite(code: string): Promise<{ householdId: string }> {
  return request('claim', { code })
}
