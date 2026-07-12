alter table public.household_invites
  add column email_sent_at timestamptz,
  add column last_email_attempt_at timestamptz,
  add column email_attempt_count integer not null default 0;

alter table public.household_invites
  add constraint invite_email_attempt_count_nonnegative check (email_attempt_count >= 0);

create or replace function public.consume_invite_email_attempt(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.household_invites;
  v_attempt_count integer;
begin
  select * into v_invite
  from public.household_invites
  where id = p_invite_id
    and claimed_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if v_invite.id is null then return false; end if;

  if v_invite.last_email_attempt_at is null or v_invite.last_email_attempt_at <= now() - interval '15 minutes' then
    v_attempt_count := 1;
  else
    if v_invite.email_attempt_count >= 3 then return false; end if;
    v_attempt_count := v_invite.email_attempt_count + 1;
  end if;

  update public.household_invites
  set last_email_attempt_at = now(), email_attempt_count = v_attempt_count
  where id = p_invite_id;

  return true;
end;
$$;

revoke all on function public.consume_invite_email_attempt(uuid) from public, anon, authenticated;
grant execute on function public.consume_invite_email_attempt(uuid) to service_role;
