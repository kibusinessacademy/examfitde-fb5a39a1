
-- =====================================================================
-- Heal-Cockpit v8 — SSOT Aggregation, deterministic recommendation,
-- fail-closed bulk router with idempotent enqueue (admin_actions cast fix)
-- =====================================================================

DROP VIEW IF EXISTS public.v_admin_heal_cockpit CASCADE;

CREATE VIEW public.v_admin_heal_cockpit
WITH (security_invoker = true)
AS
WITH step_agg AS (
  SELECT
    ps.package_id,
    COUNT(*) FILTER (WHERE ps.status::text = 'failed')                                   AS failed_steps,
    COUNT(*) FILTER (WHERE ps.attempts >= COALESCE(ps.max_attempts, 5))                  AS exhausted_steps,
    COUNT(*) FILTER (WHERE (ps.meta->>'hard_stall_count')::int > 0)                      AS hard_stalled_steps,
    COALESCE(SUM((ps.meta->>'hard_stall_count')::int), 0)                                AS hard_stall_count_total,
    MAX(ps.attempts)                                                                      AS max_attempts_seen
  FROM public.package_steps ps
  GROUP BY ps.package_id
),
job_agg AS (
  SELECT
    jq.package_id,
    COUNT(*) FILTER (WHERE jq.status IN ('pending','queued'))                            AS pending_jobs,
    COUNT(*) FILTER (WHERE jq.status = 'processing')                                     AS processing_jobs,
    COUNT(*) FILTER (WHERE jq.status = 'failed' AND jq.updated_at > now() - interval '24 hours') AS failed_jobs_24h,
    COUNT(*) FILTER (WHERE jq.status IN ('pending','queued','processing')
                     AND jq.job_type LIKE 'package_repair_%')                            AS active_repair_jobs,
    COUNT(*) FILTER (WHERE jq.status IN ('pending','queued','processing')
                     AND jq.job_type LIKE 'package_reconcile_%')                         AS active_reconcile_jobs,
    MAX(jq.updated_at) FILTER (WHERE jq.status = 'processing')                           AS last_processing_at,
    jsonb_object_agg(jq.job_type, jq.cnt)
      FILTER (WHERE jq.cnt > 0)                                                          AS open_jobs_by_type
  FROM (
    SELECT package_id, job_type, status, updated_at,
           COUNT(*) OVER (PARTITION BY package_id, job_type) AS cnt
    FROM public.job_queue
    WHERE status IN ('pending','queued','processing','failed')
      AND package_id IS NOT NULL
  ) jq
  GROUP BY jq.package_id
),
integrity_agg AS (
  SELECT
    ich.package_id,
    COUNT(*)                                                                              AS integrity_runs_total,
    MAX(ich.created_at)                                                                   AS last_integrity_run_at,
    (
      SELECT jsonb_agg(jsonb_build_object(
                'score', s.score, 'passed', s.passed, 'created_at', s.created_at
             ) ORDER BY s.created_at DESC)
      FROM (
        SELECT score, passed, created_at
        FROM public.integrity_check_history
        WHERE package_id = ich.package_id
        ORDER BY created_at DESC
        LIMIT 3
      ) s
    )                                                                                     AS recent_integrity_scores,
    BOOL_OR(ich.no_progress_blocked)
      FILTER (WHERE ich.created_at > now() - interval '7 days')                           AS no_progress_blocked_recent
  FROM public.integrity_check_history ich
  GROUP BY ich.package_id
),
heal_audit AS (
  SELECT
    (aa.affected_ids[1])::uuid AS package_id,
    MAX(aa.created_at)         AS last_heal_action_at,
    (ARRAY_AGG(aa.action ORDER BY aa.created_at DESC))[1] AS last_heal_action
  FROM public.admin_actions aa
  WHERE aa.scope = 'course_package'
    AND aa.affected_ids IS NOT NULL
    AND array_length(aa.affected_ids, 1) >= 1
    AND aa.created_at > now() - interval '14 days'
    AND aa.affected_ids[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  GROUP BY (aa.affected_ids[1])::uuid
),
base AS (
  SELECT
    cp.id                                                       AS package_id,
    cp.curriculum_id,
    cp.title,
    cp.status                                                   AS package_status,
    cp.is_published,
    cp.blocked_reason,
    cp.stuck_reason,
    cp.last_progress_at,
    cp.retry_count,
    cp.published_at,
    cp.updated_at                                               AS package_updated_at,
    rc.release_class,
    rc.deficiency_codes,
    rc.approved_questions,
    rc.covered_learning_fields,
    rc.total_learning_fields,
    COALESCE(sa.failed_steps, 0)                                AS failed_steps,
    COALESCE(sa.exhausted_steps, 0)                             AS exhausted_steps,
    COALESCE(sa.hard_stalled_steps, 0)                          AS hard_stalled_steps,
    COALESCE(sa.hard_stall_count_total, 0)                      AS hard_stall_count_total,
    COALESCE(ja.pending_jobs, 0)                                AS pending_jobs,
    COALESCE(ja.processing_jobs, 0)                             AS processing_jobs,
    COALESCE(ja.failed_jobs_24h, 0)                             AS failed_jobs_24h,
    COALESCE(ja.active_repair_jobs, 0)                          AS active_repair_jobs,
    COALESCE(ja.active_reconcile_jobs, 0)                       AS active_reconcile_jobs,
    ja.last_processing_at,
    COALESCE(ja.open_jobs_by_type, '{}'::jsonb)                 AS open_jobs_by_type,
    COALESCE(ia.integrity_runs_total, 0)                        AS integrity_runs_total,
    ia.last_integrity_run_at,
    COALESCE(ia.recent_integrity_scores, '[]'::jsonb)           AS recent_integrity_scores,
    COALESCE(ia.no_progress_blocked_recent, false)              AS no_progress_blocked_recent,
    ha.last_heal_action_at,
    ha.last_heal_action
  FROM public.course_packages cp
  LEFT JOIN public.v_package_release_classification rc ON rc.package_id = cp.id
  LEFT JOIN step_agg       sa ON sa.package_id = cp.id
  LEFT JOIN job_agg        ja ON ja.package_id = cp.id
  LEFT JOIN integrity_agg  ia ON ia.package_id = cp.id
  LEFT JOIN heal_audit     ha ON ha.package_id = cp.id
  WHERE COALESCE(cp.archived, false) = false
),
classified AS (
  SELECT
    b.*,
    CASE
      WHEN b.package_status = 'published'
           AND b.deficiency_codes IS NOT NULL
           AND array_length(b.deficiency_codes, 1) > 0
        THEN 'hard_rebuild'
      WHEN b.blocked_reason = 'quality_no_progress_3x'
           OR b.exhausted_steps > 0
           OR b.no_progress_blocked_recent
        THEN 'guided_recovery'
      WHEN b.release_class = 'release_block'
           AND b.retry_count > 5
        THEN 'mark_content_gap'
      WHEN b.release_class = 'release_ok'
           AND b.package_status NOT IN ('published')
        THEN 'force_publish'
      WHEN b.release_class = 'release_warn'
           AND b.active_repair_jobs = 0
           AND b.active_reconcile_jobs = 0
        THEN 'bulk_reconcile'
      WHEN b.processing_jobs > 0
           OR b.pending_jobs > 0
        THEN 'monitor'
      ELSE 'manual_review'
    END                                                         AS recommended_action
  FROM base b
),
scored AS (
  SELECT
    c.*,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN c.blocked_reason IS NOT NULL
           THEN 'blocked_reason=' || c.blocked_reason END,
      CASE WHEN c.exhausted_steps > 0
           THEN 'exhausted_steps=' || c.exhausted_steps::text END,
      CASE WHEN c.hard_stall_count_total > 0
           THEN 'hard_stall_count=' || c.hard_stall_count_total::text END,
      CASE WHEN c.no_progress_blocked_recent
           THEN 'no_progress_block_recent=true' END,
      CASE WHEN c.release_class IS NOT NULL
           THEN 'release_class=' || c.release_class END,
      CASE WHEN c.deficiency_codes IS NOT NULL
                AND array_length(c.deficiency_codes, 1) > 0
           THEN 'deficiency_count=' || array_length(c.deficiency_codes, 1)::text END,
      CASE WHEN c.active_repair_jobs = 0 AND c.active_reconcile_jobs = 0
           THEN 'no_active_repair_job=true' END,
      CASE WHEN c.failed_jobs_24h > 3
           THEN 'failed_jobs_24h=' || c.failed_jobs_24h::text END,
      CASE WHEN c.processing_jobs > 0
           THEN 'processing_jobs=' || c.processing_jobs::text END,
      CASE WHEN c.package_status = 'published'
           THEN 'package_status=published' END,
      CASE WHEN c.retry_count > 5
           THEN 'retry_count=' || c.retry_count::text END
    ], NULL)                                                    AS recommended_action_reasons,
    CASE c.recommended_action
      WHEN 'hard_rebuild'      THEN 'confirm'
      WHEN 'guided_recovery'   THEN 'modal'
      WHEN 'mark_content_gap'  THEN 'confirm'
      WHEN 'force_publish'     THEN 'auto'
      WHEN 'bulk_reconcile'    THEN 'auto'
      WHEN 'monitor'           THEN 'observe'
      ELSE                          'observe'
    END                                                         AS actionability_class,
    LEAST(100, GREATEST(0,
      CASE c.recommended_action
        WHEN 'hard_rebuild'      THEN 95
        WHEN 'guided_recovery'   THEN 90
        WHEN 'mark_content_gap'  THEN 85
        WHEN 'force_publish'     THEN 70
        WHEN 'bulk_reconcile'    THEN 55
        WHEN 'manual_review'     THEN 50
        WHEN 'monitor'           THEN 20
        ELSE 30
      END
      + CASE WHEN c.blocked_reason IS NOT NULL THEN 10 ELSE 0 END
      + CASE WHEN c.hard_stall_count_total > 0 THEN 8  ELSE 0 END
      + CASE WHEN c.exhausted_steps > 0        THEN 8  ELSE 0 END
      + CASE WHEN c.failed_jobs_24h > 3        THEN 6  ELSE 0 END
      + CASE WHEN c.release_class = 'release_block' THEN 5 ELSE 0 END
      + CASE WHEN c.last_progress_at IS NULL
                  OR c.last_progress_at < now() - interval '48 hours' THEN 3 ELSE 0 END
      - CASE WHEN c.processing_jobs > 0
                  AND c.last_processing_at > now() - interval '20 minutes' THEN 10 ELSE 0 END
    ))                                                          AS urgency_score
  FROM classified c
)
SELECT
  s.package_id,
  s.curriculum_id,
  s.title,
  s.package_status,
  s.is_published,
  s.blocked_reason,
  s.stuck_reason,
  s.release_class,
  s.deficiency_codes,
  s.recommended_action,
  s.recommended_action_reasons,
  s.actionability_class,
  s.urgency_score,
  s.approved_questions,
  s.covered_learning_fields,
  s.total_learning_fields,
  s.failed_steps,
  s.exhausted_steps,
  s.hard_stalled_steps,
  s.hard_stall_count_total,
  s.pending_jobs,
  s.processing_jobs,
  s.failed_jobs_24h,
  s.active_repair_jobs,
  s.active_reconcile_jobs,
  s.last_processing_at,
  s.open_jobs_by_type,
  s.integrity_runs_total,
  s.last_integrity_run_at,
  s.recent_integrity_scores,
  s.no_progress_blocked_recent,
  s.last_heal_action,
  s.last_heal_action_at,
  s.last_progress_at,
  s.retry_count,
  s.published_at,
  s.package_updated_at
FROM scored s;

REVOKE ALL ON public.v_admin_heal_cockpit FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_admin_heal_cockpit TO authenticated;

COMMENT ON VIEW public.v_admin_heal_cockpit IS
  'Heal-Cockpit v8 SSOT. Per-package recommendation with deterministic precedence and explainability.';

-- ---------------------------------------------------------------------
-- 2) Morning-Briefing-View
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_admin_morning_briefing CASCADE;

CREATE VIEW public.v_admin_morning_briefing
WITH (security_invoker = true)
AS
SELECT
  (SELECT COUNT(*) FROM public.course_packages
     WHERE blocked_reason IS NOT NULL
       AND updated_at > now() - interval '24 hours')                              AS newly_blocked_24h,
  (SELECT COUNT(*) FROM public.course_packages
     WHERE published_at > now() - interval '24 hours')                            AS newly_published_24h,
  (SELECT COUNT(*) FROM public.admin_course_auto_heal_queue
     WHERE status = 'done'
       AND processed_at > now() - interval '24 hours')                            AS healed_24h,
  (SELECT COUNT(*) FROM public.job_queue
     WHERE status = 'failed' AND updated_at > now() - interval '24 hours')        AS failed_jobs_24h,
  (SELECT COUNT(*) FROM public.course_packages
     WHERE blocked_reason = 'quality_no_progress_3x'
       AND updated_at > now() - interval '24 hours')                              AS no_progress_blocks_24h,
  (SELECT COUNT(*) FROM public.job_queue
     WHERE status = 'processing')                                                  AS wip_active,
  (SELECT COUNT(*) FROM public.v_admin_heal_cockpit
     WHERE recommended_action IN ('hard_rebuild','guided_recovery','mark_content_gap')) AS critical_actions_pending,
  (SELECT COUNT(*) FROM public.v_admin_heal_cockpit
     WHERE recommended_action = 'force_publish')                                   AS publish_ready_count;

REVOKE ALL ON public.v_admin_morning_briefing FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_admin_morning_briefing TO authenticated;

COMMENT ON VIEW public.v_admin_morning_briefing IS
  'Heal-Cockpit v8 — 24h KPI snapshot for the operator morning briefing.';

-- ---------------------------------------------------------------------
-- 3) Bulk-Router-RPC: admin_smart_heal_bulk
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_smart_heal_bulk(uuid[], uuid);

CREATE OR REPLACE FUNCTION public.admin_smart_heal_bulk(
  p_package_ids uuid[],
  p_caller_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller            uuid := COALESCE(p_caller_id, auth.uid());
  v_executed          jsonb := '[]'::jsonb;
  v_skipped           jsonb := '[]'::jsonb;
  v_needs_modal       jsonb := '[]'::jsonb;
  v_needs_confirm     jsonb := '[]'::jsonb;
  v_pid               uuid;
  v_row               public.v_admin_heal_cockpit%ROWTYPE;
  v_recheck_class     text;
  v_recheck_blocked   text;
  v_recheck_status    text;
  v_recheck_active    int;
  v_cooldown_exists   boolean;
  v_max_batch         constant int := 25;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'executed', '[]'::jsonb, 'skipped', '[]'::jsonb,
                              'needs_modal', '[]'::jsonb, 'needs_confirmation', '[]'::jsonb);
  END IF;

  IF array_length(p_package_ids, 1) > v_max_batch THEN
    RAISE EXCEPTION 'bulk_limit_exceeded: max % packages per call', v_max_batch;
  END IF;

  FOREACH v_pid IN ARRAY p_package_ids LOOP
    SELECT * INTO v_row FROM public.v_admin_heal_cockpit WHERE package_id = v_pid;

    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object(
        'package_id', v_pid, 'reason', 'package_not_found_or_archived');
      CONTINUE;
    END IF;

    IF v_row.actionability_class = 'modal' THEN
      v_needs_modal := v_needs_modal || jsonb_build_array(jsonb_build_object(
        'package_id', v_pid, 'recommended_action', v_row.recommended_action,
        'reasons', v_row.recommended_action_reasons));
      CONTINUE;
    END IF;

    IF v_row.actionability_class = 'confirm' THEN
      v_needs_confirm := v_needs_confirm || jsonb_build_array(jsonb_build_object(
        'package_id', v_pid, 'recommended_action', v_row.recommended_action,
        'reasons', v_row.recommended_action_reasons));
      CONTINUE;
    END IF;

    SELECT rc.release_class, cp.blocked_reason, cp.status,
           (SELECT COUNT(*)::int FROM public.job_queue jq
              WHERE jq.package_id = v_pid
                AND jq.status IN ('pending','queued','processing')
                AND (jq.job_type LIKE 'package_repair_%' OR jq.job_type LIKE 'package_reconcile_%'))
      INTO v_recheck_class, v_recheck_blocked, v_recheck_status, v_recheck_active
    FROM public.v_package_release_classification rc
    JOIN public.course_packages cp ON cp.id = rc.package_id
    WHERE rc.package_id = v_pid;

    IF v_row.recommended_action = 'force_publish' THEN
      IF v_recheck_class IS DISTINCT FROM 'release_ok'
         OR v_recheck_status = 'published' THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'package_id', v_pid, 'action', 'force_publish',
          'reason', 'state_changed',
          'observed', jsonb_build_object('release_class', v_recheck_class,
                                         'status', v_recheck_status)));
        CONTINUE;
      END IF;

      PERFORM public.admin_force_steps_done(
        v_pid, NULL::text[], 'smart_heal_bulk', false, true
      );

      v_executed := v_executed || jsonb_build_array(jsonb_build_object(
        'package_id', v_pid, 'action', 'force_publish'));

    ELSIF v_row.recommended_action = 'bulk_reconcile' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.job_queue
        WHERE package_id = v_pid
          AND job_type LIKE 'package_reconcile_%'
          AND (status IN ('pending','queued','processing')
               OR (status IN ('completed','failed')
                   AND updated_at > now() - interval '10 minutes'))
      ) INTO v_cooldown_exists;

      IF v_cooldown_exists THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'package_id', v_pid, 'action', 'bulk_reconcile',
          'reason', 'cooldown_or_already_running'));
        CONTINUE;
      END IF;

      IF v_recheck_class IS DISTINCT FROM 'release_warn' OR v_recheck_active > 0 THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'package_id', v_pid, 'action', 'bulk_reconcile',
          'reason', 'state_changed',
          'observed', jsonb_build_object('release_class', v_recheck_class,
                                         'active_jobs', v_recheck_active)));
        CONTINUE;
      END IF;

      INSERT INTO public.job_queue (job_type, status, payload, package_id, priority, idempotency_key)
      VALUES (
        'package_reconcile_artifacts', 'pending',
        jsonb_build_object('package_id', v_pid, 'source', 'smart_heal_bulk',
                           'caller_id', v_caller),
        v_pid, 60,
        'smart-heal-reconcile:' || v_pid::text || ':' ||
          to_char(now(), 'YYYYMMDDHH24MI')
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

      v_executed := v_executed || jsonb_build_array(jsonb_build_object(
        'package_id', v_pid, 'action', 'bulk_reconcile'));

    ELSIF v_row.recommended_action = 'monitor' THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'package_id', v_pid, 'action', 'monitor', 'reason', 'observe_only'));

    ELSE
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'package_id', v_pid, 'action', v_row.recommended_action,
        'reason', 'unsupported_in_auto_lane'));
    END IF;
  END LOOP;

  INSERT INTO public.admin_actions (user_id, action, scope, affected_ids, payload)
  VALUES (v_caller, 'smart_heal_bulk', 'course_package',
          ARRAY(SELECT x::text FROM unnest(p_package_ids) AS x),
          jsonb_build_object('executed', v_executed, 'skipped', v_skipped,
                             'needs_modal', v_needs_modal,
                             'needs_confirmation', v_needs_confirm));

  RETURN jsonb_build_object(
    'ok', true,
    'executed', v_executed,
    'skipped', v_skipped,
    'needs_modal', v_needs_modal,
    'needs_confirmation', v_needs_confirm
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_smart_heal_bulk(uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_smart_heal_bulk(uuid[], uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_smart_heal_bulk(uuid[], uuid) IS
  'Heal-Cockpit v8 router. Fail-closed re-check, idempotent reconcile enqueue, never silent for modal/confirm classes.';
