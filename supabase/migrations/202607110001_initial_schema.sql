create extension if not exists pgcrypto;

create table public.parent_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  parent_type text not null check (parent_type in ('mother', 'father', 'parent_guardian')),
  show_pump_action boolean not null default false,
  volume_unit text not null default 'ml' check (volume_unit in ('ml', 'fl_oz')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.parent_profiles(user_id) on delete cascade,
  role text not null default 'parent' check (role = 'parent'),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  nickname text not null check (char_length(trim(nickname)) between 1 and 60),
  birth_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_active_child_per_household
  on public.children (household_id)
  where active;

create table public.events (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  created_by uuid not null references public.parent_profiles(user_id),
  subject_parent_id uuid references public.parent_profiles(user_id),
  event_type text not null check (event_type in ('poop', 'pee', 'feed', 'burp', 'sleep', 'diaper_check', 'pump')),
  occurred_at timestamptz not null,
  ended_at timestamptz,
  client_timezone_offset_minutes integer not null check (client_timezone_offset_minutes between -840 and 840),
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint event_end_after_start check (ended_at is null or ended_at >= occurred_at),
  constraint event_session_end check (ended_at is null or event_type in ('sleep', 'pump')),
  constraint event_pump_subject check (
    (event_type = 'pump' and subject_parent_id is not null)
    or (event_type <> 'pump' and subject_parent_id is null)
  )
);

create index events_household_occurred_idx on public.events (household_id, occurred_at desc);
create index events_child_type_occurred_idx on public.events (child_id, event_type, occurred_at desc);
create unique index one_open_sleep_per_child
  on public.events (child_id)
  where event_type = 'sleep' and ended_at is null and deleted_at is null;
create unique index one_open_pump_per_parent
  on public.events (subject_parent_id)
  where event_type = 'pump' and ended_at is null and deleted_at is null;

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invited_email_normalized text not null,
  code_digest text not null,
  created_by uuid not null references public.parent_profiles(user_id),
  expires_at timestamptz not null,
  claimed_by uuid references public.parent_profiles(user_id),
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invite_claim_complete check (
    (claimed_at is null and claimed_by is null)
    or (claimed_at is not null and claimed_by is not null)
  )
);

create unique index one_unconsumed_invite_per_household
  on public.household_invites (household_id)
  where claimed_at is null and revoked_at is null;
create unique index unique_unconsumed_invite_digest
  on public.household_invites (code_digest)
  where claimed_at is null and revoked_at is null;

create table public.invite_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ip_digest text not null,
  success boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index invite_attempts_user_time_idx on public.invite_attempts (user_id, attempted_at desc);
create index invite_attempts_ip_time_idx on public.invite_attempts (ip_digest, attempted_at desc);

create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  metrics jsonb not null default '{}'::jsonb,
  comparison jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  stale_at timestamptz,
  unique (child_id, period_end),
  constraint summary_period_valid check (period_end > period_start)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger parent_profiles_set_updated_at before update on public.parent_profiles
for each row execute function public.set_updated_at();
create trigger households_set_updated_at before update on public.households
for each row execute function public.set_updated_at();
create trigger children_set_updated_at before update on public.children
for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();

create or replace function public.is_household_member(p_household_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = p_user_id
  );
$$;

create or replace function public.shares_household_with(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid() and theirs.user_id = p_other_user_id
  );
$$;

revoke all on function public.is_household_member(uuid, uuid) from public;
revoke all on function public.shares_household_with(uuid) from public;
grant execute on function public.is_household_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.shares_household_with(uuid) to authenticated, service_role;

alter table public.parent_profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.children enable row level security;
alter table public.events enable row level security;
alter table public.household_invites enable row level security;
alter table public.invite_attempts enable row level security;
alter table public.daily_summaries enable row level security;

create policy "profiles_select_family" on public.parent_profiles
for select to authenticated
using (user_id = auth.uid() or public.shares_household_with(user_id));
create policy "profiles_insert_own" on public.parent_profiles
for insert to authenticated
with check (user_id = auth.uid());
create policy "profiles_update_own" on public.parent_profiles
for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "households_select_members" on public.households
for select to authenticated using (public.is_household_member(id));
create policy "households_update_members" on public.households
for update to authenticated using (public.is_household_member(id)) with check (public.is_household_member(id));

create policy "members_select_family" on public.household_members
for select to authenticated using (public.is_household_member(household_id));

create policy "children_select_family" on public.children
for select to authenticated using (public.is_household_member(household_id));
create policy "children_update_family" on public.children
for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "events_select_family" on public.events
for select to authenticated using (public.is_household_member(household_id));
create policy "events_insert_family" on public.events
for insert to authenticated with check (
  public.is_household_member(household_id)
  and created_by = auth.uid()
  and exists (
    select 1 from public.children c
    where c.id = child_id and c.household_id = events.household_id
  )
  and (
    (event_type = 'pump' and subject_parent_id = auth.uid())
    or (event_type <> 'pump' and subject_parent_id is null)
  )
);
create policy "events_update_family" on public.events
for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy "summaries_select_family" on public.daily_summaries
for select to authenticated using (public.is_household_member(household_id));

grant select, insert, update on public.parent_profiles to authenticated;
grant select, update (name, timezone, updated_at) on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, update (nickname, birth_date, active, updated_at) on public.children to authenticated;
grant select, insert on public.events to authenticated;
grant update (occurred_at, ended_at, details, updated_at, deleted_at) on public.events to authenticated;
grant select on public.daily_summaries to authenticated;
revoke all on public.household_invites from anon, authenticated;
revoke all on public.invite_attempts from anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function public.create_family(
  p_baby_nickname text,
  p_birth_date date,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_household public.households;
  v_child public.children;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from auth.users where id = v_user_id and email_confirmed_at is not null) then
    raise exception 'Email verification required';
  end if;
  if not exists (select 1 from public.parent_profiles where user_id = v_user_id) then
    raise exception 'Parent profile required';
  end if;
  if exists (select 1 from public.household_members where user_id = v_user_id) then
    raise exception 'Account already belongs to a family';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;

  insert into public.households (name, timezone)
  values (trim(p_baby_nickname) || ' family', p_timezone)
  returning * into v_household;

  insert into public.household_members (household_id, user_id)
  values (v_household.id, v_user_id);

  insert into public.children (household_id, nickname, birth_date)
  values (v_household.id, trim(p_baby_nickname), p_birth_date)
  returning * into v_child;

  return jsonb_build_object('household', to_jsonb(v_household), 'child', to_jsonb(v_child));
end;
$$;

revoke all on function public.create_family(text, date, text) from public;
grant execute on function public.create_family(text, date, text) to authenticated;

create or replace function public.set_session_state(
  p_event_type text,
  p_desired_state text,
  p_household_id uuid,
  p_child_id uuid,
  p_occurred_at timestamptz,
  p_timezone_offset integer,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_event_type not in ('sleep', 'pump') then raise exception 'Invalid session type'; end if;
  if p_desired_state not in ('start', 'end') then raise exception 'Invalid session state'; end if;
  if not public.is_household_member(p_household_id, v_user_id) then raise exception 'Family access denied'; end if;
  if not exists (select 1 from public.children where id = p_child_id and household_id = p_household_id) then
    raise exception 'Child not found';
  end if;

  if p_event_type = 'sleep' then
    select * into v_event from public.events
    where child_id = p_child_id and event_type = 'sleep' and ended_at is null and deleted_at is null
    for update;
  else
    select * into v_event from public.events
    where subject_parent_id = v_user_id and event_type = 'pump' and ended_at is null and deleted_at is null
    for update;
  end if;

  if p_desired_state = 'start' then
    if v_event.id is not null then
      return jsonb_build_object('action', 'existing', 'event', to_jsonb(v_event));
    end if;
    begin
      insert into public.events (
        id, household_id, child_id, created_by, subject_parent_id, event_type,
        occurred_at, client_timezone_offset_minutes
      ) values (
        p_event_id, p_household_id, p_child_id, v_user_id,
        case when p_event_type = 'pump' then v_user_id else null end,
        p_event_type, p_occurred_at, p_timezone_offset
      ) returning * into v_event;
      return jsonb_build_object('action', 'started', 'event', to_jsonb(v_event));
    exception when unique_violation then
      if p_event_type = 'sleep' then
        select * into v_event from public.events
        where child_id = p_child_id and event_type = 'sleep' and ended_at is null and deleted_at is null;
      else
        select * into v_event from public.events
        where subject_parent_id = v_user_id and event_type = 'pump' and ended_at is null and deleted_at is null;
      end if;
      return jsonb_build_object('action', 'existing', 'event', to_jsonb(v_event));
    end;
  end if;

  if v_event.id is null then
    return jsonb_build_object('action', 'no_open_session', 'event', null);
  end if;

  update public.events
  set ended_at = greatest(p_occurred_at, occurred_at),
      details = details || jsonb_build_object('ended_by', v_user_id)
  where id = v_event.id
  returning * into v_event;
  return jsonb_build_object('action', 'ended', 'event', to_jsonb(v_event));
end;
$$;

revoke all on function public.set_session_state(text, text, uuid, uuid, timestamptz, integer, uuid) from public;
grant execute on function public.set_session_state(text, text, uuid, uuid, timestamptz, integer, uuid) to authenticated;

create or replace function public.claim_household_invite(
  p_invite_id uuid,
  p_user_id uuid,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.household_invites;
  v_email text;
  v_member_count integer;
begin
  select lower(trim(email)) into v_email
  from auth.users
  where id = p_user_id and email_confirmed_at is not null;

  if v_email is null or v_email <> lower(trim(p_email)) then raise exception 'Invitation unavailable'; end if;
  if not exists (select 1 from public.parent_profiles where user_id = p_user_id) then raise exception 'Invitation unavailable'; end if;
  if exists (select 1 from public.household_members where user_id = p_user_id) then raise exception 'Invitation unavailable'; end if;

  select * into v_invite from public.household_invites where id = p_invite_id for update;
  if v_invite.id is null
    or v_invite.claimed_at is not null
    or v_invite.revoked_at is not null
    or v_invite.expires_at <= now()
    or v_invite.invited_email_normalized <> v_email
    or v_invite.created_by = p_user_id
  then raise exception 'Invitation unavailable'; end if;

  select count(*) into v_member_count from public.household_members where household_id = v_invite.household_id;
  if v_member_count >= 2 then raise exception 'Invitation unavailable'; end if;

  insert into public.household_members (household_id, user_id) values (v_invite.household_id, p_user_id);
  update public.household_invites
  set claimed_by = p_user_id, claimed_at = now()
  where id = v_invite.id;

  return v_invite.household_id;
end;
$$;

revoke all on function public.claim_household_invite(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_household_invite(uuid, uuid, text) to service_role;

do $$
begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.daily_summaries;
exception when duplicate_object then null;
end $$;
