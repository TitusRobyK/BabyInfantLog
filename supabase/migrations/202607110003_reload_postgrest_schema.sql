-- Ensure Supabase REST immediately discovers the interruption table and RPCs.
notify pgrst, 'reload schema';
