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
  v_amount integer;
  v_feed_type text;
  v_details jsonb;
  v_period_end timestamptz;
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
            'size', case ((v_day_index + v_i) % 3) when 0 then 'small' when 1 then 'medium' else 'large' end
          )
        );
      end if;
    end loop;

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
      insert into public.daily_summaries (
        household_id, child_id, period_start, period_end, metrics, comparison, generated_at
      ) values (
        v_child.household_id,
        v_child.id,
        v_period_end - interval '24 hours',
        v_period_end,
        jsonb_build_object(
          'seed_source', v_seed_source,
          'counts', jsonb_build_object('feed', 9, 'pee', 8, 'poop', v_poops, 'burp', 7, 'diaper_check', 8),
          'feed', jsonb_build_object('sessions', 9, 'median_interval_minutes', 170),
          'sleep', jsonb_build_object('sessions', 9, 'total_minutes', 1000 + (v_day_index % 35), 'interruptions', 2),
          'sentences', jsonb_build_array(
            '9 feeds; median gap about 2h 50m.',
            format('%s sleep across 9 sessions; 2 interruptions.',
              case when (1000 + (v_day_index % 35)) % 60 = 0
                then format('%sh', (1000 + (v_day_index % 35)) / 60)
                else format('%sh %sm', (1000 + (v_day_index % 35)) / 60, (1000 + (v_day_index % 35)) % 60)
              end),
            format('8 pee, %s poop, 8 diaper checks.', v_poops),
            '7 burps recorded.'
          )
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
