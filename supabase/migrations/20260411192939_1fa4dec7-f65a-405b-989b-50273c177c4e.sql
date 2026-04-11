
-- S2: Realtime Hardening - Remove internal tables (correct syntax)
ALTER PUBLICATION supabase_realtime DROP TABLE public.course_pipeline_events;
ALTER PUBLICATION supabase_realtime DROP TABLE public.ops_alerts;
ALTER PUBLICATION supabase_realtime DROP TABLE public.package_leases;
ALTER PUBLICATION supabase_realtime DROP TABLE public.package_steps;
