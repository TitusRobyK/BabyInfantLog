-- DESTRUCTIVE: removes every family, care event, summary, invite, and Auth user.
-- Run only against a disposable development/test Supabase project.

begin;

delete from public.daily_summaries;
delete from public.sleep_interruptions;
delete from public.events;
delete from public.invite_attempts;
delete from public.household_invites;
delete from public.household_members;
delete from public.children;
delete from public.households;
delete from public.parent_profiles;
delete from auth.users;

commit;
