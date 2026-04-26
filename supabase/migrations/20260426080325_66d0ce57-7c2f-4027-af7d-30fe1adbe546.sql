-- 1) Subcluster-Klassifikator: meta.cancel_reason → GUARDED_CANCEL
CREATE OR REPLACE FUNCTION public.fn_classify_unclassified_subcluster(_err text, _meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- Sauber durch Guard / Housekeeping abgebrochen → terminal-clean, kein Review
    WHEN _meta ? 'cancel_reason' AND COALESCE(_meta->>'cancel_reason','') <> '' THEN 'GUARDED_CANCEL'
    WHEN _err IS NULL OR _err = '' THEN 'UNCLASSIFIED_EMPTY'
    WHEN _meta ? 'error_class' OR _meta ? 'error_code' OR _meta ? 'classification_hint' THEN 'UNCLASSIFIED_RECLASSIFIABLE'
    WHEN _err ~* 'timeout|timed[_ ]out|deadline|temporarily|temp.*unavailable|503|502|504|retry|transient|lease|stale' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'rate[_ ]?limit|429|too many requests|throttle' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'connection|ECONN|ETIMEDOUT|network|socket' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'constraint|null value|invalid input|payload|schema|access denied|forbidden|causality|no curriculum|no blueprints|no effect|guard_violation' THEN 'UNCLASSIFIED_STRUCTURAL'
    ELSE 'UNCLASSIFIED_UNKNOWN'
  END
$function$;

-- 2) Klassifikations-View: cancelled+meta.cancel_reason mit aufnehmen, terminal markieren
DROP VIEW IF EXISTS public.v_admin_queue_job_classification CASCADE;

CREATE VIEW public.v_admin_queue_job_classification AS
WITH base AS (
  SELECT q.id, q.job_type, q.status, q.package_id, q.attempts, q.max_attempts,
         q.last_error, q.error, q.meta, q.updated_at, q.created_at, q.lane,
         fn_classify_job_error(COALESCE(NULLIF(q.last_error, ''::text), q.error)) AS error_class,
         COALESCE(NULLIF(q.last_error, ''::text), q.error) AS effective_error_text
  FROM job_queue q
  WHERE q.status = 'failed'::text
     OR (q.status = 'cancelled'::text AND q.meta ? 'cancel_reason')
), enriched AS (
  SELECT b.*,
         CASE
           WHEN b.status = 'cancelled'::text THEN 'GUARDED_CANCEL'::text
           WHEN (b.error_class = ANY (ARRAY['UNCLASSIFIED'::text, 'OTHER'::text])) OR b.error_class IS NULL
             THEN fn_classify_unclassified_subcluster(b.effective_error_text, b.meta)
           ELSE NULL::text
         END AS subcluster
  FROM base b
)
SELECT
  id, job_type, status, package_id, attempts, max_attempts, last_error, error,
  meta, updated_at, created_at, lane, error_class, effective_error_text, subcluster,
  COALESCE(error_class, subcluster, 'UNCLASSIFIED_UNKNOWN'::text) AS cluster,
  CASE
    WHEN subcluster = 'GUARDED_CANCEL'::text THEN 'SAFE'::text
    WHEN subcluster = ANY (ARRAY['UNCLASSIFIED_TRANSIENT'::text, 'UNCLASSIFIED_RECLASSIFIABLE'::text]) THEN 'LOW'::text
    WHEN subcluster = 'UNCLASSIFIED_EMPTY'::text THEN 'MEDIUM'::text
    WHEN subcluster = 'UNCLASSIFIED_STRUCTURAL'::text THEN 'HIGH'::text
    WHEN subcluster = 'UNCLASSIFIED_UNKNOWN'::text THEN 'MEDIUM'::text
    ELSE 'MEDIUM'::text
  END AS risk_level,
  CASE
    WHEN subcluster = ANY (ARRAY['UNCLASSIFIED_TRANSIENT'::text, 'UNCLASSIFIED_RECLASSIFIABLE'::text]) THEN true
    ELSE false
  END AS safe_to_auto_execute,
  CASE
    WHEN subcluster = 'GUARDED_CANCEL'::text THEN 'no_action_terminal_clean'::text
    WHEN subcluster = 'UNCLASSIFIED_TRANSIENT'::text THEN 'soft_retry_capped'::text
    WHEN subcluster = 'UNCLASSIFIED_RECLASSIFIABLE'::text THEN 'reclassify_then_retry'::text
    WHEN subcluster = 'UNCLASSIFIED_STRUCTURAL'::text THEN 'manual_review_required'::text
    WHEN subcluster = 'UNCLASSIFIED_EMPTY'::text THEN 'manual_review_required'::text
    WHEN subcluster = 'UNCLASSIFIED_UNKNOWN'::text THEN 'manual_review_required'::text
    ELSE 'manual_review_required'::text
  END AS recommended_strategy,
  -- Terminal-Marker: GUARDED_CANCEL ist immer terminal (sauberer Guard-Abbruch)
  CASE
    WHEN subcluster = 'GUARDED_CANCEL'::text THEN true
    WHEN subcluster = ANY (ARRAY['UNCLASSIFIED_TRANSIENT'::text, 'UNCLASSIFIED_RECLASSIFIABLE'::text]) THEN false
    WHEN error_class = ANY (ARRAY['HARD_FAIL_BREAKER'::text,'HARD_FAIL_REPAIR_EXHAUSTED'::text,'STALE_LOCK_LOOP_HARD_KILL'::text,'REQUEUE_LOOP_KILLED'::text]) THEN true
    ELSE false
  END AS is_admin_terminal,
  EXISTS (
    SELECT 1 FROM job_queue d
    WHERE d.job_type = enriched.job_type
      AND NOT d.package_id IS DISTINCT FROM enriched.package_id
      AND (d.status = ANY (fn_job_active_statuses()))
      AND d.id <> enriched.id
  ) AS has_active_sibling,
  EXISTS (
    SELECT 1 FROM job_queue s
    WHERE s.job_type = enriched.job_type
      AND NOT s.package_id IS DISTINCT FROM enriched.package_id
      AND s.status = 'completed'::text
      AND s.updated_at > enriched.updated_at
      AND s.id <> enriched.id
  ) AS has_newer_success
FROM enriched;

-- 3) Backfill: historische SSOT-Guard-Cancellations bekommen einen sprechenden last_error
UPDATE job_queue
SET last_error = 'OPS_GUARD_CANCEL: ' || COALESCE(meta->>'cancel_reason','unknown')
WHERE status = 'cancelled'
  AND (last_error IS NULL OR last_error = '')
  AND meta ? 'cancel_reason';

-- Re-grant view access (RLS via underlying tables)
GRANT SELECT ON public.v_admin_queue_job_classification TO authenticated;