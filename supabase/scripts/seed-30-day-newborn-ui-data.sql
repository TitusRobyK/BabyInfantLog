-- SYNTHETIC UI TEST DATA ONLY. This is not medical guidance or a clinical record.
--
-- The script targets exactly one active child in the project, creates a varied
-- newborn-like 30-day history, and tags every row it owns. Rerunning it replaces
-- only rows from this fixture; manually recorded events are not deleted.

do $seed$
declare
  v_seed_source constant text := 'ui_30_day_newborn_v1';
  v_child public.children;
  v_timezone text;
  v_parent_ids uuid[];
  v_parent_count integer;
  v_mother_id uuid;
  v_creator uuid;
  v_target_count integer;
  v_today date;
  v_day date;
  v_day_start timestamptz;
  v_cutoff timestamptz;
  v_at timestamptz;
  v_end_at timestamptz;
  v_sleep_id uuid;
  v_day_index integer;
  v_i integer;
  v_jitter integer;
  v_poops integer;
  v_hiccups integer;
  v_amount integer;
  v_feed_type text;
  v_details jsonb;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_feed_count integer;
  v_feed_median integer;
  v_feed_volume integer;
  v_feed_volume_count integer;
  v_pee_count integer;
  v_poop_count integer;
  v_burp_count integer;
  v_diaper_count integer;
  v_hiccup_count integer;
  v_sleep_sessions integer;
  v_sleep_gross_minutes integer;
  v_sleep_interruption_minutes integer;
  v_sleep_interruption_count integer;
  v_sleep_total_minutes integer;
  v_pump_sessions integer;
  v_pump_total_minutes integer;
  v_pump_volume integer;
  v_pump_volume_count integer;
  v_seeded_events integer;
  v_feed_minutes integer[] := array[10, 165, 330, 500, 670, 850, 1030, 1200, 1360];
  v_pee_minutes integer[] := array[90, 270, 450, 630, 810, 990, 1170, 1350];
  v_poop_minutes integer[] := array[300, 660, 1020, 1320];
  v_sleep_minutes integer[] := array[35, 190, 360, 530, 700, 880, 1060, 1230, 1385];
  v_sleep_durations integer[] := array[115, 125, 120, 120, 130, 130, 120, 110, 50];
begin
  select count(*) into v_target_count
  from public.children
  where active;

  if v_target_count <> 1 then
    raise exception 'Expected exactly one active child, found %. Run this only in a dedicated single-family test project.', v_target_count;
  end if;

  select * into v_child
  from public.children
  where active
  limit 1;

  select timezone into v_timezone
  from public.households
  where id = v_child.household_id;

  select array_agg(member.user_id order by member.joined_at)
  into v_parent_ids
  from public.household_members member
  where member.household_id = v_child.household_id;

  v_parent_count := coalesce(array_length(v_parent_ids, 1), 0);
  if v_parent_count = 0 then
    raise exception 'The active child has no linked parent.';
  end if;

  select profile.user_id into v_mother_id
  from public.parent_profiles profile
  join public.household_members member on member.user_id = profile.user_id
  where member.household_id = v_child.household_id
    and profile.parent_type = 'mother'
  order by member.joined_at
  limit 1;

  v_today := (now() at time zone v_timezone)::date;

  delete from public.daily_summaries
  where child_id = v_child.id
    and metrics ->> 'seed_source' = v_seed_source;

  -- sleep_interruptions rows owned by this fixture are removed by event cascade.
  delete from public.events
  where child_id = v_child.id
    and details ->> 'seed_source' = v_seed_source;

  for v_day_index in 0..29 loop
    v_day := v_today - (29 - v_day_index);
    v_day_start := v_day::timestamp at time zone v_timezone;
    v_cutoff := case when v_day = v_today then now() - interval '30 minutes' else now() end;

    -- 9 feeds with small, deterministic timing variation. Some breast-milk
    -- feeds intentionally omit volume because direct feeds may not be measured.
    for v_i in 1..array_length(v_feed_minutes, 1) loop
      v_jitter := ((v_day_index * 7 + v_i * 11) % 21) - 10;
      v_at := v_day_start + make_interval(mins => v_feed_minutes[v_i] + v_jitter);
      if v_at <= v_cutoff then
        v_creator := v_parent_ids[1 + ((v_day_index + v_i) % v_parent_count)];
        v_feed_type := case ((v_day_index + v_i) % 5)
          when 0 then 'formula'
          when 1 then 'mixed'
          else 'breast_milk'
        end;
        v_amount := least(105, 45 + (v_day_index / 7) * 10 + ((v_day_index + v_i) % 3) * 5);
        v_details := jsonb_build_object('seed_source', v_seed_source, 'feed_type', v_feed_type);
        if not (v_feed_type = 'breast_milk' and ((v_day_index + v_i) % 3) = 0) then
          v_details := v_details || jsonb_build_object(
            'amount', v_amount,
            'unit', 'ml',
            'amount_ml', v_amount
          );
        end if;

        insert into public.events (
          id, household_id, child_id, created_by, subject_parent_id, event_type,
          occurred_at, ended_at, client_timezone_offset_minutes, details
        ) values (
          gen_random_uuid(), v_child.household_id, v_child.id, v_creator, null, 'feed',
          v_at, null, 0, v_details
        );

        -- Most, but not every, feed is followed by a recorded burp.
        if ((v_day_index + v_i) % 6) <> 0
          and v_at + make_interval(mins => 6 + ((v_day_index + v_i) % 11)) <= v_cutoff
        then
          v_creator := v_parent_ids[1 + ((v_day_index + v_i + 1) % v_parent_count)];
          insert into public.events (
            id, household_id, child_id, created_by, subject_parent_id, event_type,
            occurred_at, ended_at, client_timezone_offset_minutes, details
          ) values (
            gen_random_uuid(), v_child.household_id, v_child.id, v_creator, null, 'burp',
            v_at + make_interval(mins => 6 + ((v_day_index + v_i) % 11)), null, 0,
            jsonb_build_object('seed_source', v_seed_source)
          );
        end if;
      end if;
    end loop;

    -- Wet diapers and diaper checks are paired but remain separate app actions.
    for v_i in 1..array_length(v_pee_minutes, 1) loop
      v_jitter := ((v_day_index * 5 + v_i * 7) % 17) - 8;
      v_at := v_day_start + make_interval(mins => v_pee_minutes[v_i] + v_jitter);
      if v_at <= v_cutoff then
        v_creator := v_parent_ids[1 + ((v_day_index + v_i) % v_parent_count)];
        insert into public.events (
          id, household_id, child_id, created_by, subject_parent_id, event_type,
          occurred_at, ended_at, client_timezone_offset_minutes, details
        ) values (
          gen_random_uuid(), v_child.household_id, v_child.id, v_creator, null, 'pee',
          v_at, null, 0, jsonb_build_object('seed_source', v_seed_source)
        );

        if v_at + interval '3 minutes' <= v_cutoff then
          insert into public.events (
            id, household_id, child_id, created_by, subject_parent_id, event_type,
            occurred_at, ended_at, client_timezone_offset_minutes, details
          ) values (
            gen_random_uuid(), v_child.household_id, v_child.id, v_creator, null, 'diaper_check',
            v_at + interval '3 minutes', null, 0,
            jsonb_build_object(
              'seed_source', v_seed_source,
              'outcome', case when ((v_day_index + v_i) % 5) = 0 then 'mixed' else 'wet' end
            )
          );
        end if;
      end if;
    end loop;

    -- Poop frequency intentionally varies between two and four per day.
    v_poops := 2 + (v_day_index % 3);
    for v_i in 1..v_poops loop
      v_jitter := ((v_day_index * 3 + v_i * 13) % 25) - 12;
      v_at := v_day_start + make_interval(mins => v_poop_minutes[v_i] + v_jitter);
      if v_at <= v_cutoff then
        v_creator := v_parent_ids[1 + ((v_day_index + v_i + 1) % v_parent_count)];
        insert into public.events (
          id, household_id, child_id, created_by, subject_parent_id, event_type,
          occurred_at, ended_at, client_timezone_offset_minutes, details
        ) values (
          gen_random_uuid(), v_child.household_id, v_child.id, v_creator, null, 'poop',
          v_at, null, 0,
          jsonb_build_object(
            'seed_source', v_seed_source,
            'size', case ((v_day_index + v_i) % 3) when 0 then 'small' when 1 then 'medium' else 'large' end,
            'consistency', case when ((v_day_index + v_i) % 4) = 0 then 'formed' else 'liquid' end,
            'color', case ((v_day_index + v_i) % 6)
              when 0 then 'mustard_yellow'
              when 1 then 'tan'
              when 2 then 'brown'
              when 3 then 'orange'
              when 4 then 'green'
              else 'dark_green'
            end
          )
        );
      end if;
    end loop;

    -- Zero to three observed hiccups episodes, logged as episodes rather than
    -- individual physical hiccups.
    v_hiccups := v_day_index % 4;
    if v_hiccups > 0 then
      for v_i in 1..v_hiccups loop
        v_jitter := ((v_day_index * 9 + v_i * 17) % 19) - 9;
        v_at := v_day_start + make_interval(mins => 210 + v_i * 310 + v_jitter);
        if v_at <= v_cutoff then
          v_creator := v_parent_ids[1 + ((v_day_index + v_i) % v_parent_count)];
          insert into public.events (
            id, household_id, child_id, created_by, subject_parent_id, event_type,
            occurred_at, ended_at, client_timezone_offset_minutes, details
          ) values (
            gen_random_uuid(), v_child.household_id, v_child.id, v_creator, null, 'hiccups',
            v_at, null, 0, jsonb_build_object('seed_source', v_seed_source)
          );
        end if;
      end loop;
    end if;

    -- Roughly 17 hours of fragmented sleep across short newborn-like sessions.
    for v_i in 1..array_length(v_sleep_minutes, 1) loop
      v_jitter := ((v_day_index * 11 + v_i * 5) % 19) - 9;
      v_at := v_day_start + make_interval(mins => v_sleep_minutes[v_i] + v_jitter);
      v_end_at := v_at + make_interval(mins => v_sleep_durations[v_i] + ((v_day_index + v_i) % 11) - 5);
      if v_end_at <= v_cutoff then
        v_creator := v_parent_ids[1 + ((v_day_index + v_i) % v_parent_count)];
        v_sleep_id := gen_random_uuid();
        insert into public.events (
          id, household_id, child_id, created_by, subject_parent_id, event_type,
          occurred_at, ended_at, client_timezone_offset_minutes, details
        ) values (
          v_sleep_id, v_child.household_id, v_child.id, v_creator, null, 'sleep',
          v_at, v_end_at, 0,
          jsonb_build_object('seed_source', v_seed_source, 'ended_by', v_creator)
        );

        if ((v_day_index + v_i) % 4) = 0 then
          insert into public.sleep_interruptions (
            id, household_id, child_id, sleep_event_id, started_at, ended_at,
            created_by, ended_by
          ) values (
            gen_random_uuid(), v_child.household_id, v_child.id, v_sleep_id,
            v_at + ((v_end_at - v_at) / 2),
            v_at + ((v_end_at - v_at) / 2) + make_interval(mins => 5 + ((v_day_index + v_i) % 8)),
            v_creator, v_creator
          );
        end if;
      end if;
    end loop;

    -- Pump data is included only when the family has a Mother profile.
    if v_mother_id is not null then
      for v_i in 1..2 loop
        v_at := v_day_start + make_interval(mins => case when v_i = 1 then 420 else 1140 end);
        v_end_at := v_at + make_interval(mins => 18 + ((v_day_index + v_i) % 9));
        if v_end_at <= v_cutoff then
          v_amount := 25 + ((v_day_index * 7 + v_i * 13) % 36);
          insert into public.events (
            id, household_id, child_id, created_by, subject_parent_id, event_type,
            occurred_at, ended_at, client_timezone_offset_minutes, details
          ) values (
            gen_random_uuid(), v_child.household_id, v_child.id, v_mother_id, v_mother_id, 'pump',
            v_at, v_end_at, 0,
            jsonb_build_object(
              'seed_source', v_seed_source,
              'amount', v_amount,
              'unit', 'ml',
              'amount_ml', v_amount,
              'side', case when ((v_day_index + v_i) % 3) = 0 then 'both' when v_i = 1 then 'left' else 'right' end,
              'ended_by', v_mother_id
            )
          );
        end if;
      end loop;
    end if;

    -- Past-day summaries make the 8 PM brief visible during UI testing.
    if v_day < v_today then
      v_period_end := (v_day + time '20:00') at time zone v_timezone;
      v_period_start := ((v_day - 1) + time '20:00') at time zone v_timezone;

      select
        count(*) filter (where event_type = 'feed'),
        count(*) filter (where event_type = 'pee'),
        count(*) filter (where event_type = 'poop'),
        count(*) filter (where event_type = 'burp'),
        count(*) filter (where event_type = 'diaper_check'),
        count(*) filter (where event_type = 'hiccups')
      into v_feed_count, v_pee_count, v_poop_count, v_burp_count, v_diaper_count, v_hiccup_count
      from public.events
      where child_id = v_child.id
        and details ->> 'seed_source' = v_seed_source
        and occurred_at >= v_period_start
        and occurred_at < v_period_end;

      select
        coalesce(percentile_cont(0.5) within group (order by gap_minutes), 0)::integer
      into v_feed_median
      from (
        select extract(epoch from (
          occurred_at - lag(occurred_at) over (order by occurred_at)
        )) / 60 as gap_minutes
        from public.events
        where child_id = v_child.id
          and event_type = 'feed'
          and details ->> 'seed_source' = v_seed_source
          and occurred_at >= v_period_start
          and occurred_at < v_period_end
      ) feed_gaps
      where gap_minutes is not null;

      select
        coalesce(sum((details ->> 'amount_ml')::numeric), 0)::integer,
        count(*)
      into v_feed_volume, v_feed_volume_count
      from public.events
      where child_id = v_child.id
        and event_type = 'feed'
        and details ->> 'seed_source' = v_seed_source
        and details ? 'amount_ml'
        and occurred_at >= v_period_start
        and occurred_at < v_period_end;

      select
        count(*),
        coalesce(sum(extract(epoch from (
          least(ended_at, v_period_end) - greatest(occurred_at, v_period_start)
        )) / 60), 0)::integer
      into v_sleep_sessions, v_sleep_gross_minutes
      from public.events
      where child_id = v_child.id
        and event_type = 'sleep'
        and details ->> 'seed_source' = v_seed_source
        and occurred_at < v_period_end
        and ended_at > v_period_start;

      select
        count(*),
        coalesce(sum(extract(epoch from (
          least(interruption.ended_at, v_period_end) - greatest(interruption.started_at, v_period_start)
        )) / 60), 0)::integer
      into v_sleep_interruption_count, v_sleep_interruption_minutes
      from public.sleep_interruptions interruption
      join public.events sleep on sleep.id = interruption.sleep_event_id
      where sleep.child_id = v_child.id
        and sleep.details ->> 'seed_source' = v_seed_source
        and interruption.started_at < v_period_end
        and interruption.ended_at > v_period_start;

      v_sleep_total_minutes := greatest(0, v_sleep_gross_minutes - v_sleep_interruption_minutes);

      select
        count(*),
        coalesce(sum(extract(epoch from (
          least(ended_at, v_period_end) - greatest(occurred_at, v_period_start)
        )) / 60), 0)::integer,
        coalesce(sum((details ->> 'amount_ml')::numeric) filter (where details ? 'amount_ml'), 0)::integer,
        count(*) filter (where details ? 'amount_ml')
      into v_pump_sessions, v_pump_total_minutes, v_pump_volume, v_pump_volume_count
      from public.events
      where child_id = v_child.id
        and event_type = 'pump'
        and details ->> 'seed_source' = v_seed_source
        and occurred_at < v_period_end
        and ended_at > v_period_start;

      insert into public.daily_summaries (
        household_id, child_id, period_start, period_end, metrics, comparison, generated_at
      ) values (
        v_child.household_id,
        v_child.id,
        v_period_start,
        v_period_end,
        jsonb_build_object(
          'seed_source', v_seed_source,
          'counts', jsonb_build_object('feed', v_feed_count, 'pee', v_pee_count, 'poop', v_poop_count, 'burp', v_burp_count, 'diaper_check', v_diaper_count, 'hiccups', v_hiccup_count),
          'feed', jsonb_build_object('sessions', v_feed_count, 'median_interval_minutes', v_feed_median, 'volume_ml', v_feed_volume, 'sessions_with_volume', v_feed_volume_count),
          'sleep', jsonb_build_object('sessions', v_sleep_sessions, 'total_minutes', v_sleep_total_minutes, 'interruptions', v_sleep_interruption_count),
          'pump', jsonb_build_object('sessions', v_pump_sessions, 'total_minutes', v_pump_total_minutes, 'volume_ml', v_pump_volume, 'sessions_with_volume', v_pump_volume_count),
          'sentences', jsonb_build_array(
            format('%s feeds; median gap %s%s.',
              v_feed_count,
              case when v_feed_median < 60
                then format('%sm', v_feed_median)
                when v_feed_median % 60 = 0
                then format('%sh', v_feed_median / 60)
                else format('%sh %sm', v_feed_median / 60, v_feed_median % 60)
              end,
              case when v_feed_volume_count > 0
                then format('; %s ml recorded across %s', v_feed_volume, v_feed_volume_count)
                else ''
              end),
            format('%s sleep across %s sessions; %s interruptions.',
              case when v_sleep_total_minutes % 60 = 0
                then format('%sh', v_sleep_total_minutes / 60)
                else format('%sh %sm', v_sleep_total_minutes / 60, v_sleep_total_minutes % 60)
              end,
              v_sleep_sessions,
              v_sleep_interruption_count),
            format('%s pee, %s poop, %s diaper checks.', v_pee_count, v_poop_count, v_diaper_count),
            format('%s burps recorded.', v_burp_count),
            format('%s hiccups %s recorded.', v_hiccup_count, case when v_hiccup_count = 1 then 'episode' else 'episodes' end)
          ) || case when v_pump_sessions > 0 then jsonb_build_array(
            format('%s pump sessions totaling %s; %s ml recorded across %s.',
              v_pump_sessions,
              case when v_pump_total_minutes < 60
                then format('%sm', v_pump_total_minutes)
                when v_pump_total_minutes % 60 = 0
                then format('%sh', v_pump_total_minutes / 60)
                else format('%sh %sm', v_pump_total_minutes / 60, v_pump_total_minutes % 60)
              end,
              v_pump_volume,
              v_pump_volume_count)
          ) else '[]'::jsonb end
        ),
        '{}'::jsonb,
        now()
      ) on conflict (child_id, period_end) do nothing;
    end if;
  end loop;

  -- Guarantee a visible Quick update burp reminder without creating future rows.
  v_creator := v_parent_ids[1 + (29 % v_parent_count)];
  insert into public.events (
    id, household_id, child_id, created_by, subject_parent_id, event_type,
    occurred_at, ended_at, client_timezone_offset_minutes, details
  ) values (
    gen_random_uuid(), v_child.household_id, v_child.id, v_creator, null, 'feed',
    now() - interval '20 minutes', null, 0,
    jsonb_build_object('seed_source', v_seed_source, 'feed_type', 'breast_milk')
  );

  select count(*) into v_seeded_events
  from public.events
  where child_id = v_child.id
    and details ->> 'seed_source' = v_seed_source;

  raise notice 'Seeded % synthetic events for % across the latest 30 calendar days.', v_seeded_events, v_child.nickname;
end;
$seed$;
