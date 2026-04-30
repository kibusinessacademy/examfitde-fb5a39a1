
ALTER TABLE public.auto_heal_log REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auto_heal_log;
