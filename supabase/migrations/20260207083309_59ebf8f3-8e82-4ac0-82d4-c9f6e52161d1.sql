-- ===========================================
-- OBSERVABILITY & SELF-HEALING
-- ===========================================

-- ===========================================
-- 🔎 A) DEAD-LETTER VIEW
-- ===========================================
CREATE OR REPLACE VIEW public.job_deadletter AS
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

-- ===========================================
-- 🧠 B) FEHLERKLASSIFIKATION (SSOT)
-- ===========================================
CREATE OR REPLACE FUNCTION public.classify_job_error(p_error TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public'
AS $$
BEGIN
  -- SSOT-Verletzungen: NIEMALS retry
  IF p_error ILIKE '%SSOT%' 
     OR p_error ILIKE '%curriculum_id%required%'
     OR p_error ILIKE '%slug%forbidden%'
     OR p_error ILIKE '%invalid payload%'
  THEN
    RETURN 'logical';
  
  -- Technische Fehler: Retry erlaubt
  ELSIF p_error ILIKE '%timeout%'
     OR p_error ILIKE '%network%'
     OR p_error ILIKE '%deadlock%'
     OR p_error ILIKE '%connection%'
     OR p_error ILIKE '%rate limit%'
     OR p_error ILIKE '%503%'
     OR p_error ILIKE '%502%'
     OR p_error ILIKE '%504%'
     OR p_error ILIKE '%temporarily unavailable%'
  THEN
    RETURN 'technical';
  
  -- Alles andere: Manuell prüfen
  ELSE
    RETURN 'unknown';
  END IF;
END;
$$;

-- ===========================================
-- 🧯 C) AUTO-REQUEUE (NUR TECHNISCH!)
-- ===========================================
CREATE OR REPLACE FUNCTION public.requeue_failed_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE public.job_queue
  SET
    status = 'pending',
    run_after = now() + INTERVAL '5 minutes',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now()
  WHERE
    status = 'failed'
    AND attempts < max_attempts
    AND public.classify_job_error(last_error) = 'technical';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ===========================================
-- 📊 D) HEALTH-KPIs VIEW
-- ===========================================
CREATE OR REPLACE VIEW public.job_health_kpis AS
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

-- ===========================================
-- 📈 E) DETAILED FAILURE ANALYSIS VIEW
-- ===========================================
CREATE OR REPLACE VIEW public.job_failure_analysis AS
SELECT
  job_type,
  public.classify_job_error(last_error) AS error_class,
  COUNT(*) AS count,
  ARRAY_AGG(DISTINCT SUBSTRING(last_error, 1, 100)) AS error_samples
FROM public.job_queue
WHERE status = 'failed'
GROUP BY job_type, public.classify_job_error(last_error)
ORDER BY count DESC;

-- ===========================================
-- 🔓 F) STALE LOCK CLEANUP
-- ===========================================
CREATE OR REPLACE FUNCTION public.cleanup_stale_locks(
  p_timeout_minutes INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Jobs die länger als timeout locked sind → zurück auf pending
  UPDATE public.job_queue
  SET
    status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    last_error = 'Lock expired after ' || p_timeout_minutes || ' minutes',
    updated_at = now()
  WHERE
    status = 'processing'
    AND locked_at < now() - (p_timeout_minutes || ' minutes')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ===========================================
-- 🔄 G) COMBINED MAINTENANCE FUNCTION
-- ===========================================
CREATE OR REPLACE FUNCTION public.job_maintenance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_stale_cleaned INTEGER;
  v_requeued INTEGER;
BEGIN
  -- 1. Stale Locks aufräumen
  v_stale_cleaned := public.cleanup_stale_locks(30);
  
  -- 2. Technische Fehler requeuen
  v_requeued := public.requeue_failed_jobs();
  
  RETURN jsonb_build_object(
    'stale_locks_cleaned', v_stale_cleaned,
    'jobs_requeued', v_requeued,
    'executed_at', now()
  );
END;
$$;