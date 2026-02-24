
-- Fix: set v_drift_analytics to security_invoker
ALTER VIEW public.v_drift_analytics SET (security_invoker = on);
