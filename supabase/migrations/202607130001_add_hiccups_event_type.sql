alter table public.events
  drop constraint if exists events_event_type_check;

alter table public.events
  add constraint events_event_type_check
  check (event_type in (
    'poop',
    'pee',
    'feed',
    'burp',
    'sleep',
    'diaper_check',
    'hiccups',
    'pump'
  ));

notify pgrst, 'reload schema';
