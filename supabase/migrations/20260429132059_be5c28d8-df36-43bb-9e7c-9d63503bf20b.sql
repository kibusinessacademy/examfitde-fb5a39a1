-- ============================================================
-- Cancel-Reason Classifier Erweiterung + Phantom-Repair-Guard
-- ============================================================
-- Beobachtung (24h): 425 UNCLASSIFIED Cancels stammen aus Jobs
--   * last_error IS NULL, last_error_code IS NULL
--   * aber error = 'OPS_GUARD:NON_BUILDING_PACKAGE'
--   * meta.auto_retry_class = 'NON_BUILDING_PACKAGE'
--   * meta.cancel_reason = 'unsigned_cancel'
--
-- Außerdem: 239 STEP_ALREADY_DONE_PHANTOM für package_repair_exam_pool_quality
--   → Pre-Enqueue-Guard blockiert Phantom-Repair-INSERTs.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Fix 1: Classifier erweitert (4 zusätzliche Quellen)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_cancel_reason_breakdown(p_hours integer DEFAULT 24)
RETURNS TABLE(job_type text, reason_code text, cnt bigint, pct numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      jq.job_type,
      COALESCE(
        -- 1. Explicit reason_code in meta
        NULLIF(jq.meta->>'reason_code', ''),
        -- 2. Leading uppercase token in last_error
        NULLIF(SUBSTRING(COALESCE(jq.last_error, '') FROM '^([A-Z_][A-Z0-9_]+)'), ''),
        -- 3. last_error_code direct
        NULLIF(jq.last_error_code, ''),
        -- 4. NEW: error column (OPS_GUARD:NON_BUILDING_PACKAGE → NON_BUILDING_PACKAGE)
        NULLIF(SUBSTRING(COALESCE(jq.error, '') FROM '^OPS_GUARD:([A-Z_][A-Z0-9_]+)'), ''),
        NULLIF(SUBSTRING(COALESCE(jq.error, '') FROM '^([A-Z_][A-Z0-9_]+)'), ''),
        -- 5. NEW: meta.auto_retry_class (silent OPS_GUARD cancels)
        NULLIF(jq.meta->>'auto_retry_class', ''),
        -- 6. NEW: meta.cancel_reason (unsigned_cancel etc.)
        NULLIF(UPPER(jq.meta->>'cancel_reason'), ''),
        'UNCLASSIFIED'
      ) AS reason_code
    FROM public.job_queue jq
    WHERE jq.status = 'cancelled'
      AND COALESCE(jq.completed_at, jq.updated_at) >= now() - make_interval(hours => GREATEST(p_hours, 1))
      AND public.has_role(auth.uid(), 'admin'::app_role)
  ),
  agg AS (
    SELECT job_type, reason_code, COUNT(*)::bigint AS cnt
    FROM base
    GROUP BY job_type, reason_code
  ),
  total AS (SELECT NULLIF(SUM(cnt), 0) AS t FROM agg)
  SELECT a.job_type, a.reason_code, a.cnt,
         ROUND((a.cnt::numeric / COALESCE((SELECT t FROM total), 1)) * 100, 1) AS pct
  FROM agg a
  ORDER BY a.cnt DESC
  LIMIT 100;
$function$;

-- ─────────────────────────────────────────────────────────────
-- Fix 2: Pre-Enqueue-Guard für package_repair_exam_pool_quality
-- Verhindert Phantom-Repair-Jobs für bereits abgeschlossene Steps.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_phantom_repair_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step_status text;
  v_step_key text;
BEGIN
  -- Nur für package_repair_exam_pool_quality
  IF NEW.job_type <> 'package_repair_exam_pool_quality' THEN
    RETURN NEW;
  END IF;

  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Repair zielt auf den exam_pool-Step. Wenn dieser bereits done/skipped → Phantom.
  v_step_key := 'generate_exam_pool';

  SELECT status INTO v_step_status
  FROM public.package_steps
  WHERE package_id = NEW.package_id AND step_key = v_step_key;

  IF v_step_status IN ('done', 'skipped') THEN
    -- Hartes Block — verhindert INSERT komplett, statt später zu cancelln.
    RAISE EXCEPTION 'PHANTOM_REPAIR_BLOCKED: package_repair_exam_pool_quality skipped — step % already %', v_step_key, v_step_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_phantom_repair_enqueue ON public.job_queue;
CREATE TRIGGER trg_guard_phantom_repair_enqueue
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_phantom_repair_enqueue();

-- ─────────────────────────────────────────────────────────────
-- Sanity-Check: hat der Classifier-Fix Wirkung?
-- ─────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.admin_get_cancel_reason_breakdown(integer) IS
  'Cancel-Reason Classifier v2: priorisiert meta.reason_code, last_error, last_error_code, error (OPS_GUARD:*), meta.auto_retry_class, meta.cancel_reason. Letzter Fallback UNCLASSIFIED.';

COMMENT ON FUNCTION public.fn_guard_phantom_repair_enqueue() IS
  'Pre-Enqueue-Guard: blockt package_repair_exam_pool_quality wenn generate_exam_pool step bereits done/skipped. Verhindert Phantom-INSERTs (zuvor 239/24h cancels via STEP_ALREADY_DONE_PHANTOM Sweep).';