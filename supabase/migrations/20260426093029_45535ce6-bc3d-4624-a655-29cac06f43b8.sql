-- 1. Subcluster-Klassifikation: zusätzliche Meta-Reclassification-Hints anerkennen
CREATE OR REPLACE FUNCTION public.fn_classify_unclassified_subcluster(_err text, _meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _meta ? 'cancel_reason' AND COALESCE(_meta->>'cancel_reason','') <> '' THEN 'GUARDED_CANCEL'
    -- Meta-Reclassification-Hints (auch wenn last_error/error leer ist)
    WHEN _meta ? 'error_class'
      OR _meta ? 'error_code'
      OR _meta ? 'classification_hint'
      OR (_meta ? 'last_error_class' AND COALESCE(_meta->>'last_error_class','') <> '')
      OR (_meta ? 'last_error_kind'  AND COALESCE(_meta->>'last_error_kind','')  <> '')
      OR (_meta ? 'auto_retry_class' AND COALESCE(_meta->>'auto_retry_class','') <> '')
      OR (_meta ? 'recovery_reason'  AND COALESCE(_meta->>'recovery_reason','')  <> '')
      OR (_meta ? 'last_error_reason' AND COALESCE(_meta->>'last_error_reason','') <> '')
    THEN 'UNCLASSIFIED_RECLASSIFIABLE'
    WHEN _err IS NULL OR _err = '' THEN 'UNCLASSIFIED_EMPTY'
    WHEN _err ~* 'timeout|timed[_ ]out|deadline|temporarily|temp.*unavailable|503|502|504|retry|transient|lease|stale' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'rate[_ ]?limit|429|too many requests|throttle' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'connection|ECONN|ETIMEDOUT|network|socket' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'constraint|null value|invalid input|payload|schema|access denied|forbidden|causality|no curriculum|no blueprints|no effect|guard_violation' THEN 'UNCLASSIFIED_STRUCTURAL'
    ELSE 'UNCLASSIFIED_UNKNOWN'
  END
$function$;

-- 2. View: zusätzlich meta.recovery_reason / meta.last_error_reason als effective_error_text-Fallback
CREATE OR REPLACE VIEW public.v_admin_queue_job_classification AS
WITH base AS (
  SELECT q.id, q.job_type, q.status, q.package_id, q.attempts, q.max_attempts,
         q.last_error, q.error, q.meta, q.updated_at, q.created_at, q.lane,
         fn_classify_job_error(
           COALESCE(
             NULLIF(q.last_error, ''),
             q.error,
             NULLIF(q.meta->>'recovery_reason',''),
             NULLIF(q.meta->>'last_error_reason',''),
             NULLIF(q.meta->>'last_error_class','')
           )
         ) AS error_class,
         COALESCE(
           NULLIF(q.last_error, ''),
           q.error,
           NULLIF(q.meta->>'recovery_reason',''),
           NULLIF(q.meta->>'last_error_reason',''),
           NULLIF(q.meta->>'last_error_class','')
         ) AS effective_error_text
    FROM job_queue q
   WHERE q.status = 'failed'
      OR (q.status = 'cancelled' AND q.meta ? 'cancel_reason')
), enriched AS (
  SELECT b.*,
         CASE
           WHEN b.status = 'cancelled' THEN 'GUARDED_CANCEL'
           WHEN (b.error_class = ANY (ARRAY['UNCLASSIFIED','OTHER'])) OR b.error_class IS NULL
             THEN fn_classify_unclassified_subcluster(b.effective_error_text, b.meta)
           ELSE NULL
         END AS subcluster
    FROM base b
)
SELECT id, job_type, status, package_id, attempts, max_attempts, last_error, error, meta,
       updated_at, created_at, lane, error_class, effective_error_text, subcluster,
       COALESCE(error_class, subcluster, 'UNCLASSIFIED_UNKNOWN') AS cluster,
       CASE
         WHEN subcluster = 'GUARDED_CANCEL' THEN 'SAFE'
         WHEN subcluster IN ('UNCLASSIFIED_TRANSIENT','UNCLASSIFIED_RECLASSIFIABLE') THEN 'LOW'
         WHEN subcluster = 'UNCLASSIFIED_EMPTY' THEN 'MEDIUM'
         WHEN subcluster = 'UNCLASSIFIED_STRUCTURAL' THEN 'HIGH'
         WHEN subcluster = 'UNCLASSIFIED_UNKNOWN' THEN 'MEDIUM'
         ELSE 'MEDIUM'
       END AS risk_level,
       CASE
         WHEN subcluster IN ('UNCLASSIFIED_TRANSIENT','UNCLASSIFIED_RECLASSIFIABLE') THEN true
         ELSE false
       END AS safe_to_auto_execute,
       CASE
         WHEN subcluster = 'GUARDED_CANCEL' THEN 'no_action_terminal_clean'
         WHEN subcluster = 'UNCLASSIFIED_TRANSIENT' THEN 'soft_retry_capped'
         WHEN subcluster = 'UNCLASSIFIED_RECLASSIFIABLE' THEN 'reclassify_then_retry'
         WHEN subcluster = 'UNCLASSIFIED_STRUCTURAL' THEN 'manual_review_required'
         WHEN subcluster = 'UNCLASSIFIED_EMPTY' THEN 'manual_review_required'
         WHEN subcluster = 'UNCLASSIFIED_UNKNOWN' THEN 'manual_review_required'
         ELSE 'manual_review_required'
       END AS recommended_strategy,
       CASE
         WHEN subcluster = 'GUARDED_CANCEL' THEN true
         WHEN subcluster IN ('UNCLASSIFIED_TRANSIENT','UNCLASSIFIED_RECLASSIFIABLE') THEN false
         WHEN error_class = ANY (ARRAY['HARD_FAIL_BREAKER','HARD_FAIL_REPAIR_EXHAUSTED','STALE_LOCK_LOOP_HARD_KILL','REQUEUE_LOOP_KILLED']) THEN true
         ELSE false
       END AS is_admin_terminal,
       (EXISTS (SELECT 1 FROM job_queue d
                 WHERE d.job_type = enriched.job_type
                   AND NOT d.package_id IS DISTINCT FROM enriched.package_id
                   AND d.status = ANY (fn_job_active_statuses())
                   AND d.id <> enriched.id)) AS has_active_sibling,
       (EXISTS (SELECT 1 FROM job_queue s
                 WHERE s.job_type = enriched.job_type
                   AND NOT s.package_id IS DISTINCT FROM enriched.package_id
                   AND s.status = 'completed'
                   AND s.updated_at > enriched.updated_at
                   AND s.id <> enriched.id)) AS has_newer_success
  FROM enriched;