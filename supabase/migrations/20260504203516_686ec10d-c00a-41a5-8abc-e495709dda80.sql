-- 1) Klassifizierung Elektroanlagenmonteur (8ebefeb4): Council score=78 → Bronze requires_review
UPDATE public.course_packages
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object(
  'bronze', jsonb_build_object(
    'requires_review', true,
    'final_state', 'requires_review',
    'reason', 'integrity_score_below_gate',
    'council_score', 78,
    'rules_failed', 2,
    'classified_at', now(),
    'classified_by', 'manual_council_classification'
  )
)
WHERE id = '8ebefeb4-4cad-4748-8c1a-70950fb0df4f';

-- Cancel offene auto_publish Jobs (idempotent — keine offen, aber safe)
UPDATE public.job_queue
SET status='cancelled', completed_at=now(),
    last_error='cancelled_by_bronze_classification: requires_review',
    result = COALESCE(result,'{}'::jsonb) || jsonb_build_object('cancelled_by','bronze_classification','reason','REQUIRES_REVIEW_BRONZE')
WHERE package_id = '8ebefeb4-4cad-4748-8c1a-70950fb0df4f'
  AND job_type = 'package_auto_publish'
  AND status IN ('pending','queued','processing');

-- Audit
INSERT INTO public.auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
VALUES ('manual_council_classification','bronze_classified_requires_review',
        '8ebefeb4-4cad-4748-8c1a-70950fb0df4f','package','success',
        'Council score=78 (2 blocking rules) → Bronze requires_review',
        jsonb_build_object('package_id','8ebefeb4-4cad-4748-8c1a-70950fb0df4f','score',78,'rules_failed',2,
                           'failed_rules',jsonb_build_array('bloom_remember_pct=14.04 (<gate)','blueprint_coverage=71.2 (<gate)')));

-- 2) bronze_locked_enqueue_blocked als by-design INFO einstufen → aus Cockpit-Heal-Noise ausschließen
CREATE OR REPLACE VIEW public.v_heal_recurring_patterns AS
WITH base AS (
  SELECT auto_heal_log.action_type AS cluster,
         auto_heal_log.target_id,
         auto_heal_log.target_type,
         auto_heal_log.created_at,
         auto_heal_log.result_status,
         auto_heal_log.duration_ms,
         auto_heal_log.error_message
  FROM auto_heal_log
  WHERE auto_heal_log.created_at > (now() - '7 days'::interval)
    AND auto_heal_log.target_id IS NOT NULL
    AND auto_heal_log.action_type <> ALL (ARRAY[
      'production_guardian_cycle',
      'pipeline_watchdog_cycle',
      'worker_liveness_check',
      'lc_shard_liveness_revive',
      'atomic_step_enqueue',
      'tail_step_retryable_deferred',
      -- INFO: by-design Bronze-Lock-Blocks sind kein Heal-Pattern
      'bronze_locked_enqueue_blocked',
      'reconcile_skipped_bronze_locked',
      'redundant_content_step_enqueue_blocked'
    ])
), agg AS (
  SELECT base.cluster, base.target_id,
         max(base.target_type) AS target_type,
         count(*) AS recurrence_7d,
         count(*) FILTER (WHERE base.created_at > (now() - '24:00:00'::interval)) AS recurrence_24h,
         count(*) FILTER (WHERE base.created_at > (now() - '01:00:00'::interval)) AS recurrence_1h,
         count(*) FILTER (WHERE base.result_status = 'failed' AND base.created_at > (now() - '24:00:00'::interval)) AS failed_24h,
         min(base.created_at) AS first_seen,
         max(base.created_at) AS last_seen,
         mode() WITHIN GROUP (ORDER BY base.error_message) AS dominant_error
  FROM base
  GROUP BY base.cluster, base.target_id
  HAVING count(*) >= 3
), scored AS (
  SELECT a.cluster, a.target_id, a.target_type,
         a.recurrence_7d, a.recurrence_24h, a.recurrence_1h, a.failed_24h,
         a.first_seen, a.last_seen, a.dominant_error,
         LEAST(100, round(a.recurrence_7d::numeric / 50.0 * 30 + a.recurrence_24h::numeric / 20.0 * 30 +
           CASE WHEN a.recurrence_1h >= 5 THEN 25 ELSE (a.recurrence_1h * 5) END +
           CASE WHEN a.cluster = ANY (ARRAY['enqueue_phantom_blocked','requeue_loop_mitigation','hot_loop_mitigation','stale_lock_hard_kill','zombie_detected_hard_stalled']) THEN 15 ELSE 0 END
         )::integer) AS severity_score,
         CASE WHEN a.recurrence_7d > 0 THEN round(a.recurrence_24h::numeric / a.recurrence_7d * 100, 1) ELSE 0 END AS escalation_rate_pct,
         encode(extensions.digest((a.cluster || '|') || a.target_id, 'sha1'), 'hex') AS pattern_key,
         CASE WHEN a.target_id ~ '^[0-9a-f-]{36}$' THEN a.target_id::uuid ELSE NULL::uuid END AS package_id_uuid
  FROM agg a
)
SELECT s.pattern_key, s.cluster, s.target_id, s.target_type,
       s.package_id_uuid AS package_id,
       cp.title AS package_title, cp.status AS package_status, cp.track AS package_track,
       cp.blocked_reason, cp.last_error AS package_last_error,
       s.recurrence_7d, s.recurrence_24h, s.recurrence_1h, s.failed_24h,
       s.severity_score, s.escalation_rate_pct,
       s.first_seen, s.last_seen, s.dominant_error,
       rec.id AS active_recommendation_id, rec.confidence AS recommendation_confidence,
       rec.root_cause AS recommendation_root_cause, rec.permanent_fix_suggestion AS recommendation_permanent_fix,
       rec.created_at AS recommendation_created_at, rec.valid_until AS recommendation_valid_until
FROM scored s
LEFT JOIN course_packages cp ON cp.id = s.package_id_uuid
LEFT JOIN LATERAL (
  SELECT r.id, r.confidence, r.root_cause, r.permanent_fix_suggestion, r.created_at, r.valid_until
  FROM heal_pattern_recommendations r
  WHERE r.pattern_key = s.pattern_key AND r.status='active' AND r.valid_until > now()
  ORDER BY r.created_at DESC LIMIT 1
) rec ON true
ORDER BY s.severity_score DESC, s.recurrence_24h DESC;