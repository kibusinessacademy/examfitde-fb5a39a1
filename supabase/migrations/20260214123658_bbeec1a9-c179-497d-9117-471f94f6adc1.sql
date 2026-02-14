
-- Enable realtime for pipeline tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.course_packages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.package_steps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.package_leases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ops_alerts;
