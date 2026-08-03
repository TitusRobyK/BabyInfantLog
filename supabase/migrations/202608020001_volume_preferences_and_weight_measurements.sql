alter table public.parent_profiles
  add column volume_slider_max_ml integer not null default 350,
  add column weight_unit text not null default 'lb_oz';

alter table public.parent_profiles
  add constraint parent_profiles_volume_slider_max_ml_check
    check (volume_slider_max_ml between 30 and 600 and volume_slider_max_ml % 10 = 0),
  add constraint parent_profiles_weight_unit_check
    check (weight_unit in ('lb_oz', 'kg_g'));

create table public.weight_measurements (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  measured_on date not null,
  weight_grams integer not null check (weight_grams > 0),
  created_by uuid not null references public.parent_profiles(user_id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index weight_measurements_household_measured_idx
  on public.weight_measurements (household_id, measured_on desc);
create index weight_measurements_child_measured_idx
  on public.weight_measurements (child_id, measured_on desc)
  where deleted_at is null;

create or replace function public.validate_weight_measurement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_timezone text;
begin
  select household.timezone into v_timezone
  from public.households household
  where household.id = new.household_id;

  if v_timezone is null then
    raise exception 'Household not found';
  end if;

  if not exists (
    select 1
    from public.children child
    where child.id = new.child_id
      and child.household_id = new.household_id
  ) then
    raise exception 'Child not found in household';
  end if;

  if new.measured_on > (now() at time zone v_timezone)::date then
    raise exception 'Weight measurement date cannot be in the future';
  end if;

  return new;
end;
$$;

create trigger weight_measurements_validate
before insert or update on public.weight_measurements
for each row execute function public.validate_weight_measurement();

create trigger weight_measurements_set_updated_at
before update on public.weight_measurements
for each row execute function public.set_updated_at();

alter table public.weight_measurements enable row level security;

create policy "weight_measurements_select_family" on public.weight_measurements
for select to authenticated
using (public.is_household_member(household_id));

create policy "weight_measurements_insert_family" on public.weight_measurements
for insert to authenticated
with check (
  public.is_household_member(household_id)
  and created_by = auth.uid()
  and exists (
    select 1
    from public.children child
    where child.id = weight_measurements.child_id
      and child.household_id = weight_measurements.household_id
  )
);

create policy "weight_measurements_update_family" on public.weight_measurements
for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

grant select, insert on public.weight_measurements to authenticated;
grant update (measured_on, weight_grams, updated_at, deleted_at) on public.weight_measurements to authenticated;
grant all on public.weight_measurements to service_role;

do $$
begin
  alter publication supabase_realtime add table public.weight_measurements;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
