-- Removes only rows created by seed-30-day-newborn-ui-data.sql.
-- Manual care events, family setup, parent accounts, and Auth users are preserved.

do $cleanup$
declare
  v_seed_source constant text := 'ui_30_day_newborn_v1';
  v_summary_count integer;
  v_event_count integer;
begin
  select count(*) into v_summary_count
  from public.daily_summaries
  where metrics ->> 'seed_source' = v_seed_source;

  select count(*) into v_event_count
  from public.events
  where details ->> 'seed_source' = v_seed_source;

  delete from public.daily_summaries
  where metrics ->> 'seed_source' = v_seed_source;

  -- Associated seeded sleep interruptions are removed by the event foreign-key cascade.
  delete from public.events
  where details ->> 'seed_source' = v_seed_source;

  raise notice 'Removed % synthetic summaries and % synthetic events. Manual data and accounts were preserved.',
    v_summary_count, v_event_count;
end;
$cleanup$;
