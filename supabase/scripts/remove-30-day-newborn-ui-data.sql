-- Removes only rows created by seed-30-day-newborn-ui-data.sql.
-- Manual care events, family setup, parent accounts, and Auth users are preserved.

do $cleanup$
declare
  v_seed_source constant text := 'ui_30_day_newborn_v1';
  v_summary_count integer;
  v_event_count integer;
  v_measurement_count integer;
begin
  select count(*) into v_summary_count
  from public.daily_summaries
  where metrics ->> 'seed_source' = v_seed_source;

  select count(*) into v_event_count
  from public.events
  where details ->> 'seed_source' = v_seed_source;

  select count(*) into v_measurement_count
  from public.weight_measurements
  where exists (
    select 1
    from generate_series(1, 5) fixture(weight_index)
    where id = md5(v_seed_source || ':' || child_id::text || ':weight:' || fixture.weight_index)::uuid
  );

  delete from public.daily_summaries
  where metrics ->> 'seed_source' = v_seed_source;

  -- Associated seeded sleep interruptions are removed by the event foreign-key cascade.
  delete from public.events
  where details ->> 'seed_source' = v_seed_source;

  delete from public.weight_measurements
  where exists (
    select 1
    from generate_series(1, 5) fixture(weight_index)
    where id = md5(v_seed_source || ':' || child_id::text || ':weight:' || fixture.weight_index)::uuid
  );

  raise notice 'Removed % synthetic summaries, % synthetic events, and % synthetic weight measurements. Manual data and accounts were preserved.',
    v_summary_count, v_event_count, v_measurement_count;
end;
$cleanup$;
