
-- Fix views missing security_invoker=on
-- This ensures views use the CALLER's permissions, not the view owner's

ALTER VIEW public.license_seats_safe SET (security_invoker = on);
ALTER VIEW public.ops_blocked_packages SET (security_invoker = on);
ALTER VIEW public.ops_content_factory SET (security_invoker = on);
ALTER VIEW public.ops_heal_effectiveness SET (security_invoker = on);
ALTER VIEW public.ops_health_summary SET (security_invoker = on);
ALTER VIEW public.ops_seeding_summary SET (security_invoker = on);
