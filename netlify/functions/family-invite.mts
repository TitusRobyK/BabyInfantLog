import type { Config, Context } from '@netlify/functions'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { createHmac, randomInt } from 'node:crypto'

const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const genericInviteError = 'That code is invalid, expired, already used, or belongs to another email.'

interface InviteBody {
  action?: 'generate' | 'preview' | 'claim'
  email?: string
  code?: string
}

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

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
  })
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
}

function digest(value: string): string {
  return createHmac('sha256', env('INVITE_HMAC_SECRET')).update(value).digest('hex')
}

function newCode(): string {
  return Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('')
}

async function authenticatedUser(client: SupabaseClient, request: Request): Promise<User | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user?.email || !data.user.email_confirmed_at) return null
  return data.user
}

function clientIp(request: Request, context: Context): string {
  return (
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    context.ip ||
    'unknown'
  )
}

async function rateLimited(client: SupabaseClient, userId: string, ipDigest: string): Promise<boolean> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const [byUser, byIp] = await Promise.all([
    client
      .from('invite_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('success', false)
      .gte('attempted_at', since),
    client
      .from('invite_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_digest', ipDigest)
      .eq('success', false)
      .gte('attempted_at', since),
  ])
  return (byUser.count ?? 0) >= 5 || (byIp.count ?? 0) >= 5
}

async function recordAttempt(client: SupabaseClient, userId: string, ipDigest: string, success: boolean) {
  await client.from('invite_attempts').insert({ user_id: userId, ip_digest: ipDigest, success })
}

async function findInvite(client: SupabaseClient, user: User, code: string) {
  const codeDigest = digest(code)
  const email = normalizeEmail(user.email ?? '')
  const { data, error } = await client
    .from('household_invites')
    .select('id, household_id, created_by, expires_at')
    .eq('code_digest', codeDigest)
    .eq('invited_email_normalized', email)
    .is('claimed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) throw error
  return data
}

async function generate(client: SupabaseClient, user: User, body: InviteBody): Promise<Response> {
  const invitedEmail = normalizeEmail(body.email ?? '')
  if (!/^\S+@\S+\.\S+$/.test(invitedEmail) || invitedEmail === normalizeEmail(user.email ?? '')) {
    return json({ error: 'Enter Parent B’s email address.' }, 400)
  }

  const { data: membership } = await client
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return json({ error: 'Create a family before generating a code.' }, 403)

  const { count } = await client
    .from('household_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('household_id', membership.household_id)
  if ((count ?? 0) >= 2) return json({ error: 'This family already has two parents.' }, 409)

  await client
    .from('household_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('household_id', membership.household_id)
    .is('claimed_at', null)
    .is('revoked_at', null)

  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = newCode()
    const { error } = await client.from('household_invites').insert({
      household_id: membership.household_id,
      invited_email_normalized: invitedEmail,
      code_digest: digest(code),
      created_by: user.id,
      expires_at: expiresAt,
    })
    if (!error) return json({ code, expiresAt })
    if (error.code !== '23505') throw error
  }
  return json({ error: 'A code could not be generated. Try again.' }, 503)
}

async function previewOrClaim(
  client: SupabaseClient,
  user: User,
  body: InviteBody,
  request: Request,
  context: Context,
): Promise<Response> {
  const code = normalizeCode(body.code ?? '')
  if (code.length !== 5) return json({ error: genericInviteError }, 400)

  const ipDigest = digest(`ip:${clientIp(request, context)}`)
  if (await rateLimited(client, user.id, ipDigest)) {
    return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429)
  }

  const invite = await findInvite(client, user, code)
  if (!invite) {
    await recordAttempt(client, user.id, ipDigest, false)
    return json({ error: genericInviteError }, 400)
  }

  if (body.action === 'preview') {
    const [{ data: child }, { data: creator }] = await Promise.all([
      client.from('children').select('nickname').eq('household_id', invite.household_id).eq('active', true).single(),
      client.from('parent_profiles').select('display_name').eq('user_id', invite.created_by).single(),
    ])
    await recordAttempt(client, user.id, ipDigest, true)
    return json({ babyNickname: child?.nickname ?? 'baby', parentName: creator?.display_name ?? 'Parent A', expiresAt: invite.expires_at })
  }

  const { data: householdId, error } = await client.rpc('claim_household_invite', {
    p_invite_id: invite.id,
    p_user_id: user.id,
    p_email: normalizeEmail(user.email ?? ''),
  })
  if (error) {
    await recordAttempt(client, user.id, ipDigest, false)
    return json({ error: genericInviteError }, 400)
  }
  await recordAttempt(client, user.id, ipDigest, true)
  return json({ householdId })
}

export default async (request: Request, context: Context): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  try {
    const client = adminClient()
    const user = await authenticatedUser(client, request)
    if (!user) return json({ error: 'Please sign in again.' }, 401)
    const body = (await request.json()) as InviteBody
    if (body.action === 'generate') return await generate(client, user, body)
    if (body.action === 'preview' || body.action === 'claim') {
      return await previewOrClaim(client, user, body, request, context)
    }
    return json({ error: 'Invalid action.' }, 400)
  } catch (error) {
    console.error('family-invite failed', error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'The invitation service is temporarily unavailable.' }, 500)
  }
}

export const config: Config = {
  path: '/api/family-invite',
}
