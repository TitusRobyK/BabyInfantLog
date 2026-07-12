create table public.sleep_interruptions (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  sleep_event_id uuid not null references public.events(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_by uuid not null references public.parent_profiles(user_id),
  ended_by uuid references public.parent_profiles(user_id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint sleep_interruption_end_after_start check (ended_at is null or ended_at >= started_at)
);

create index sleep_interruptions_household_started_idx
  on public.sleep_interruptions (household_id, started_at desc);
create index sleep_interruptions_sleep_event_idx
  on public.sleep_interruptions (sleep_event_id, started_at);
create unique index one_open_interruption_per_sleep
  on public.sleep_interruptions (sleep_event_id)
  where ended_at is null and deleted_at is null;

create trigger sleep_interruptions_set_updated_at before update on public.sleep_interruptions
for each row execute function public.set_updated_at();

alter table public.sleep_interruptions enable row level security;

create policy "sleep_interruptions_select_family" on public.sleep_interruptions
for select to authenticated using (public.is_household_member(household_id));

grant select on public.sleep_interruptions to authenticated;
grant all on public.sleep_interruptions to service_role;

create or replace function public.set_sleep_interruption_state(
  p_desired_state text,
  p_household_id uuid,
  p_child_id uuid,
  p_occurred_at timestamptz,
  p_interruption_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_sleep public.events;
  v_interruption public.sleep_interruptions;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_desired_state not in ('start', 'end') then raise exception 'Invalid interruption state'; end if;
  if not public.is_household_member(p_household_id, v_user_id) then raise exception 'Family access denied'; end if;
  if not exists (
    select 1 from public.children
    where id = p_child_id and household_id = p_household_id
  ) then raise exception 'Child not found'; end if;

  if p_desired_state = 'start' then
    select * into v_sleep
    from public.events
    where household_id = p_household_id
      and child_id = p_child_id
      and event_type = 'sleep'
      and ended_at is null
      and deleted_at is null
    for update;

    if v_sleep.id is null then raise exception 'No active sleep session'; end if;

    select * into v_interruption
    from public.sleep_interruptions
    where sleep_event_id = v_sleep.id and ended_at is null and deleted_at is null
    for update;

    if v_interruption.id is not null then
      return jsonb_build_object('action', 'existing', 'interruption', to_jsonb(v_interruption));
    end if;

    begin
      insert into public.sleep_interruptions (
        id, household_id, child_id, sleep_event_id, started_at, created_by
      ) values (
        p_interruption_id, p_household_id, p_child_id, v_sleep.id,
        greatest(p_occurred_at, v_sleep.occurred_at), v_user_id
      ) returning * into v_interruption;
      return jsonb_build_object('action', 'started', 'interruption', to_jsonb(v_interruption));
    exception when unique_violation then
      select * into v_interruption
      from public.sleep_interruptions
      where sleep_event_id = v_sleep.id and ended_at is null and deleted_at is null;
      return jsonb_build_object('action', 'existing', 'interruption', to_jsonb(v_interruption));
    end;
  end if;

  select interruption.* into v_interruption
  from public.sleep_interruptions interruption
  where interruption.household_id = p_household_id
    and interruption.child_id = p_child_id
    and interruption.ended_at is null
    and interruption.deleted_at is null
  order by interruption.started_at desc
  limit 1
  for update;

  if v_interruption.id is null then
    return jsonb_build_object('action', 'no_open_interruption', 'interruption', null);
  end if;

  update public.sleep_interruptions
  set ended_at = greatest(p_occurred_at, started_at), ended_by = v_user_id
  where id = v_interruption.id
  returning * into v_interruption;

  return jsonb_build_object('action', 'ended', 'interruption', to_jsonb(v_interruption));
end;
$$;

revoke all on function public.set_sleep_interruption_state(text, uuid, uuid, timestamptz, uuid) from public;
grant execute on function public.set_sleep_interruption_state(text, uuid, uuid, timestamptz, uuid) to authenticated;

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

  if p_event_type = 'sleep' then
    update public.sleep_interruptions
    set ended_at = greatest(p_occurred_at, started_at), ended_by = v_user_id
    where sleep_event_id = v_event.id and ended_at is null and deleted_at is null;
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

do $$
begin
  alter publication supabase_realtime add table public.sleep_interruptions;
exception when duplicate_object then null;
end $$;
