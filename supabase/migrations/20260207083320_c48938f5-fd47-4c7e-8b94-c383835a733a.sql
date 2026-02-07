-- ===========================================
-- FIX: Views mit SECURITY INVOKER (nicht DEFINER)
-- ===========================================

-- 1. Dead-Letter View neu erstellen mit SECURITY INVOKER
DROP VIEW IF EXISTS public.job_deadletter;
CREATE VIEW public.job_deadletter 
WITH (security_invoker = true)
AS
SELECT
  id,
  job_type,
  status,
  attempts,
  max_attempts,
  last_error,
  payload,
  created_at,
  updated_at,
  completed_at
FROM public.job_queue
WHERE status = 'failed';

-- 2. Health-KPIs View neu erstellen mit SECURITY INVOKER
DROP VIEW IF EXISTS public.job_health_kpis;
CREATE VIEW public.job_health_kpis
WITH (security_invoker = true)
AS
SELECT
  job_type,
  COUNT(*) FILTER (WHERE status = 'pending')     AS pending,
  COUNT(*) FILTER (WHERE status = 'processing')  AS processing,
  COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
  COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
  COUNT(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
  COUNT(*)                                        AS total,
  MAX(updated_at)                                 AS last_update
FROM public.job_queue
GROUP BY job_type;

-- 3. Failure Analysis View neu erstellen mit SECURITY INVOKER
DROP VIEW IF EXISTS public.job_failure_analysis;
CREATE VIEW public.job_failure_analysis
WITH (security_invoker = true)
AS
SELECT
  job_type,
  public.classify_job_error(last_error) AS error_class,
  COUNT(*) AS count,
  ARRAY_AGG(DISTINCT SUBSTRING(last_error, 1, 100)) AS error_samples
FROM public.job_queue
WHERE status = 'failed'
GROUP BY job_type, public.classify_job_error(last_error);