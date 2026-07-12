alter table public.household_invites
  add column if not exists email_send_reserved_until timestamptz;

create index if not exists household_invites_email_delivery_idx
  on public.household_invites (household_id, email_sent_at desc)
  where email_sent_at is not null;

create or replace function public.reserve_invite_email_send(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.household_invites;
  v_household_id uuid;
  v_last_sent_at timestamptz;
  v_reserved_until timestamptz;
  v_recent_attempts bigint;
  v_last_attempt_at timestamptz;
begin
  select household_id into v_household_id
  from public.household_invites
  where id = p_invite_id;

  if v_household_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_invite');
  end if;

  -- Serialize reservations for the household so parallel requests and replacement
  -- invite codes cannot bypass the delivery cooldown.
  perform 1
  from public.households
  where id = v_household_id
  for update;

  select * into v_invite
  from public.household_invites
  where id = p_invite_id
    and claimed_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if v_invite.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_invite');
  end if;

  select max(email_sent_at) into v_last_sent_at
  from public.household_invites
  where household_id = v_household_id;

  if v_last_sent_at is not null and v_last_sent_at > now() - interval '30 minutes' then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'cooldown',
      'cooldownUntil', v_last_sent_at + interval '30 minutes'
    );
  end if;

  select max(email_send_reserved_until) into v_reserved_until
  from public.household_invites
  where household_id = v_household_id
    and email_send_reserved_until > now();

  if v_reserved_until is not null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'send_in_progress',
      'cooldownUntil', v_reserved_until
    );
  end if;

  select coalesce(sum(email_attempt_count), 0), max(last_email_attempt_at)
  into v_recent_attempts, v_last_attempt_at
  from public.household_invites
  where household_id = v_household_id
    and last_email_attempt_at > now() - interval '15 minutes';

  if v_recent_attempts >= 3 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'attempt_limit',
      'cooldownUntil', v_last_attempt_at + interval '15 minutes'
    );
  end if;

  update public.household_invites
  set
    last_email_attempt_at = now(),
    email_attempt_count = case
      when last_email_attempt_at is null or last_email_attempt_at <= now() - interval '15 minutes' then 1
      else email_attempt_count + 1
    end,
    email_send_reserved_until = now() + interval '30 minutes'
  where id = p_invite_id;

  return jsonb_build_object('allowed', true, 'reason', 'reserved');
end;
$$;

revoke all on function public.reserve_invite_email_send(uuid) from public, anon, authenticated;
grant execute on function public.reserve_invite_email_send(uuid) to service_role;

create or replace function public.invite_email_cooldown_until(p_household_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(email_sent_at + interval '30 minutes')
  from public.household_invites
  where household_id = p_household_id;
$$;

revoke all on function public.invite_email_cooldown_until(uuid) from public, anon, authenticated;
grant execute on function public.invite_email_cooldown_until(uuid) to service_role;
