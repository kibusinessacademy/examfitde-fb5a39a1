DROP VIEW IF EXISTS public.v_admin_morning_briefing CASCADE;
DROP VIEW IF EXISTS public.v_admin_heal_cockpit CASCADE;
DROP FUNCTION IF EXISTS public.admin_smart_heal_bulk(uuid[], uuid);
DROP FUNCTION IF EXISTS public.admin_smart_heal_bulk(uuid[], text);

CREATE OR REPLACE VIEW public.v_admin_heal_cockpit AS
WITH job_open_by_type AS (
  SELECT package_id, job_type, COUNT(*) AS cnt
  FROM public.job_queue
  WHERE status IN ('pending','queued','processing','failed') AND package_id IS NOT NULL
  GROUP BY package_id, job_type
),
job_agg AS (
  SELECT
    j.package_id,
    COUNT(*) FILTER (WHERE j.status IN ('pending','queued')) AS pending_jobs,
    COUNT(*) FILTER (WHERE j.status = 'processing') AS processing_jobs,
    COUNT(*) FILTER (WHERE j.status = 'failed' AND j.updated_at > now() - interval '24 hours') AS failed_jobs_24h,
    COUNT(*) FILTER (WHERE j.status IN ('pending','queued','processing') AND j.job_type LIKE 'package_repair_%') AS active_repair_jobs,
    COUNT(*) FILTER (WHERE j.status IN ('pending','queued','processing') AND j.job_type = 'package_reconcile_artifacts') AS active_reconcile_jobs,
    MAX(j.updated_at) FILTER (WHERE j.status = 'processing') AS last_processing_at,
    COALESCE(
      (SELECT jsonb_object_agg(t.job_type, t.cnt) FROM job_open_by_type t WHERE t.package_id = j.package_id),
      '{}'::jsonb
    ) AS open_jobs_by_type,
    COALESCE(MAX(j.attempts) FILTER (WHERE j.job_type LIKE 'package_repair_%' AND j.created_at > now() - interval '7 days'), 0) AS repair_attempts_proxy
  FROM public.job_queue j
  WHERE j.package_id IS NOT NULL
  GROUP BY j.package_id
),
step_agg AS (
  SELECT
    ps.package_id,
    COUNT(*) FILTER (
      WHERE (ps.status = 'blocked' AND COALESCE(ps.meta->>'no_effect_repair', 'false') = 'true')
         OR (ps.attempts >= ps.max_attempts AND ps.status IN ('blocked','failed','timeout'))
    ) AS exhausted_steps,
    COUNT(*) FILTER (
      WHERE ps.status IN ('failed','blocked')
        AND COALESCE((ps.meta->>'hard_stall_count')::int, 0) > 0
    ) AS hard_stall_steps
  FROM public.package_steps ps
  GROUP BY ps.package_id
),
release_class AS (
  SELECT rc.package_id, rc.release_class, rc.deficiency_codes
  FROM public.v_package_release_classification rc
),
base AS (
  SELECT
    cp.id AS package_id,
    cp.title AS package_title,
    cp.status AS package_status,
    cp.is_published,
    cp.updated_at AS package_updated_at,
    cp.blocked_reason,
    rc.release_class,
    rc.deficiency_codes,
    COALESCE(ja.pending_jobs, 0) AS pending_jobs,
    COALESCE(ja.processing_jobs, 0) AS processing_jobs,
    COALESCE(ja.failed_jobs_24h, 0) AS failed_jobs_24h,
    COALESCE(ja.active_repair_jobs, 0) AS active_repair_jobs,
    COALESCE(ja.active_reconcile_jobs, 0) AS active_reconcile_jobs,
    ja.last_processing_at,
    COALESCE(ja.open_jobs_by_type, '{}'::jsonb) AS open_jobs_by_type,
    COALESCE(ja.repair_attempts_proxy, 0) AS repair_attempts,
    COALESCE(sa.exhausted_steps, 0) AS exhausted_steps,
    COALESCE(sa.hard_stall_steps, 0) AS hard_stall_steps
  FROM public.course_packages cp
  LEFT JOIN release_class rc ON rc.package_id = cp.id
  LEFT JOIN job_agg ja ON ja.package_id = cp.id
  LEFT JOIN step_agg sa ON sa.package_id = cp.id
  WHERE COALESCE(cp.archived, false) = false
)
SELECT
  b.package_id, b.package_title, b.package_status, b.is_published, b.package_updated_at,
  b.blocked_reason, b.release_class, b.deficiency_codes,
  b.pending_jobs, b.processing_jobs, b.failed_jobs_24h,
  b.active_repair_jobs, b.active_reconcile_jobs, b.last_processing_at,
  b.open_jobs_by_type, b.repair_attempts, b.exhausted_steps, b.hard_stall_steps,
  CASE
    WHEN (b.package_status = 'published' OR b.is_published = true)
         AND b.deficiency_codes IS NOT NULL AND array_length(b.deficiency_codes, 1) > 0
      THEN 'hard_rebuild'
    WHEN b.blocked_reason = 'quality_no_progress_3x' OR b.exhausted_steps > 0
      THEN 'guided_recovery'
    WHEN b.release_class = 'release_block' AND b.repair_attempts > 5
      THEN 'mark_content_gap'
    WHEN b.release_class = 'release_ok'
         AND b.package_status != 'published' AND b.is_published = false
         AND COALESCE(array_length(b.deficiency_codes, 1), 0) = 0
         AND b.active_repair_jobs = 0 AND b.blocked_reason IS NULL
      THEN 'force_publish'
    WHEN b.release_class = 'release_warn'
         AND b.active_repair_jobs = 0 AND b.active_reconcile_jobs = 0
      THEN 'bulk_reconcile'
    WHEN (b.processing_jobs > 0 AND b.last_processing_at > now() - interval '20 minutes')
      OR (b.pending_jobs > 0 AND b.package_updated_at > now() - interval '30 minutes')
      THEN 'monitor'
    ELSE 'manual_review'
  END AS recommended_action,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN b.blocked_reason IS NOT NULL THEN 'blocked_reason=' || b.blocked_reason END,
    CASE WHEN b.exhausted_steps > 0 THEN 'exhausted_steps=' || b.exhausted_steps END,
    CASE WHEN b.hard_stall_steps > 0 THEN 'hard_stall_steps=' || b.hard_stall_steps END,
    CASE WHEN b.release_class IS NOT NULL THEN 'release_class=' || b.release_class END,
    CASE WHEN b.deficiency_codes IS NOT NULL AND array_length(b.deficiency_codes,1)>0
         THEN 'deficiency_codes_count=' || array_length(b.deficiency_codes,1) END,
    CASE WHEN b.failed_jobs_24h > 3 THEN 'failed_jobs_24h=' || b.failed_jobs_24h END,
    CASE WHEN b.active_repair_jobs > 0 THEN 'active_repair_jobs=' || b.active_repair_jobs END,
    CASE WHEN b.active_repair_jobs = 0 AND b.release_class = 'release_block' THEN 'no_active_repair_job=true' END,
    CASE WHEN b.repair_attempts > 5 THEN 'repair_attempts=' || b.repair_attempts END,
    CASE WHEN b.is_published = true AND b.deficiency_codes IS NOT NULL THEN 'published_with_defects=true' END
  ], NULL) AS recommended_action_reasons,
  CASE
    WHEN (b.package_status = 'published' OR b.is_published = true)
         AND b.deficiency_codes IS NOT NULL AND array_length(b.deficiency_codes, 1) > 0
      THEN 'confirm'
    WHEN b.blocked_reason = 'quality_no_progress_3x' OR b.exhausted_steps > 0
      THEN 'modal'
    WHEN b.release_class = 'release_block' AND b.repair_attempts > 5
      THEN 'confirm'
    WHEN b.release_class = 'release_ok' AND b.package_status != 'published'
      THEN 'auto'
    WHEN b.release_class = 'release_warn'
      THEN 'auto'
    ELSE 'observe'
  END AS actionability_class,
  GREATEST(0, LEAST(100,
    CASE
      WHEN (b.package_status = 'published' OR b.is_published = true)
           AND b.deficiency_codes IS NOT NULL AND array_length(b.deficiency_codes, 1) > 0 THEN 95
      WHEN b.blocked_reason = 'quality_no_progress_3x' OR b.exhausted_steps > 0 THEN 90
      WHEN b.release_class = 'release_block' AND b.repair_attempts > 5 THEN 85
      WHEN b.release_class = 'release_ok' AND b.package_status != 'published' THEN 70
      WHEN b.release_class = 'release_warn' THEN 55
      WHEN b.processing_jobs > 0 OR b.pending_jobs > 0 THEN 20
      ELSE 50
    END
    + (CASE WHEN b.blocked_reason IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN b.hard_stall_steps > 0 THEN 8 ELSE 0 END)
    + (CASE WHEN b.exhausted_steps > 0 THEN 8 ELSE 0 END)
    + (CASE WHEN b.failed_jobs_24h > 3 THEN 6 ELSE 0 END)
    + (CASE WHEN b.release_class = 'release_block' THEN 5 ELSE 0 END)
    + (CASE WHEN b.processing_jobs > 0 AND b.last_processing_at > now() - interval '10 minutes' THEN -10 ELSE 0 END)
  ))::int AS urgency_score
FROM base b;

COMMENT ON VIEW public.v_admin_heal_cockpit IS
'Heal-Cockpit v8.1 SSOT: deterministische Triage. attempts dient als Proxy für repair_attempts. exhausted_steps wird aus blocked+no_effect_repair oder attempts>=max_attempts abgeleitet bis dedizierte SSOT existiert.';

CREATE OR REPLACE VIEW public.v_admin_morning_briefing AS
WITH wip_cfg AS (
  SELECT COALESCE(
    (SELECT SUM(recommended_concurrency)::int FROM public.pool_concurrency_recommendation),
    18
  ) AS wip_capacity
),
events_24h AS (
  SELECT
    COUNT(*) FILTER (WHERE cp.blocked_reason IS NOT NULL AND cp.updated_at > now() - interval '24 hours') AS newly_blocked_count,
    COUNT(*) FILTER (WHERE cp.is_published = true AND cp.updated_at > now() - interval '24 hours') AS newly_published_count,
    COUNT(*) FILTER (WHERE cp.blocked_reason = 'quality_no_progress_3x') AS quality_no_progress_blocks
  FROM public.course_packages cp
  WHERE COALESCE(cp.archived, false) = false
),
job_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '24 hours') AS failed_jobs_24h,
    COUNT(*) FILTER (WHERE status = 'completed' AND job_type LIKE 'package_repair_%' AND updated_at > now() - interval '24 hours') AS healed_count,
    COUNT(*) FILTER (WHERE status = 'processing') AS wip_active
  FROM public.job_queue
),
cockpit_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE recommended_action IN ('hard_rebuild','guided_recovery','mark_content_gap')) AS critical_actions_pending,
    COUNT(*) FILTER (WHERE recommended_action = 'force_publish') AS publish_ready_count
  FROM public.v_admin_heal_cockpit
)
SELECT
  e.newly_blocked_count, e.newly_published_count, e.quality_no_progress_blocks,
  j.failed_jobs_24h, j.healed_count, j.wip_active,
  w.wip_capacity,
  cs.critical_actions_pending, cs.publish_ready_count
FROM events_24h e CROSS JOIN job_stats j CROSS JOIN wip_cfg w CROSS JOIN cockpit_stats cs;

COMMENT ON VIEW public.v_admin_morning_briefing IS
'Heal-Cockpit v8.1: 24h KPI-Briefing mit wip_capacity aus pool_concurrency_recommendation.';

CREATE OR REPLACE FUNCTION public.admin_smart_heal_bulk(
  _package_ids uuid[],
  _action text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_row record;
  v_executed jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_needs_modal jsonb := '[]'::jsonb;
  v_needs_confirmation jsonb := '[]'::jsonb;
  v_action text;
  v_recheck_class text;
  v_recheck_status text;
  v_recheck_blocked text;
  v_recheck_active int;
  v_recheck_deficiency_count int;
  v_cooldown_exists boolean;
  v_already_running boolean;
  v_job_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _package_ids IS NULL OR array_length(_package_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_packages',
      'executed', '[]'::jsonb, 'skipped', '[]'::jsonb,
      'needs_modal', '[]'::jsonb, 'needs_confirmation', '[]'::jsonb);
  END IF;

  FOREACH v_pkg_id IN ARRAY _package_ids LOOP
    SELECT * INTO v_row FROM public.v_admin_heal_cockpit WHERE package_id = v_pkg_id;

    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('package_id', v_pkg_id, 'reason', 'not_found');
      CONTINUE;
    END IF;

    v_action := COALESCE(_action, v_row.recommended_action);

    IF v_row.actionability_class = 'modal' THEN
      v_needs_modal := v_needs_modal || jsonb_build_object(
        'package_id', v_pkg_id, 'action', v_action,
        'reasons', to_jsonb(v_row.recommended_action_reasons));
      CONTINUE;
    END IF;

    IF v_row.actionability_class = 'confirm' THEN
      v_needs_confirmation := v_needs_confirmation || jsonb_build_object(
        'package_id', v_pkg_id, 'action', v_action,
        'reasons', to_jsonb(v_row.recommended_action_reasons));
      CONTINUE;
    END IF;

    IF v_action = 'force_publish' THEN
      SELECT
        rc.release_class, cp.status, cp.blocked_reason,
        COALESCE(array_length(rc.deficiency_codes, 1), 0),
        COALESCE((SELECT COUNT(*) FROM public.job_queue
                  WHERE package_id = v_pkg_id
                    AND status IN ('pending','queued','processing')
                    AND job_type LIKE 'package_repair_%'), 0)
      INTO v_recheck_class, v_recheck_status, v_recheck_blocked,
           v_recheck_deficiency_count, v_recheck_active
      FROM public.course_packages cp
      LEFT JOIN public.v_package_release_classification rc ON rc.package_id = cp.id
      WHERE cp.id = v_pkg_id;

      IF v_recheck_class IS DISTINCT FROM 'release_ok'
         OR v_recheck_status = 'published'
         OR v_recheck_blocked IS NOT NULL
         OR v_recheck_active > 0
         OR v_recheck_deficiency_count > 0 THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'state_changed',
          'recheck', jsonb_build_object(
            'release_class', v_recheck_class, 'status', v_recheck_status,
            'blocked_reason', v_recheck_blocked,
            'active_repair_jobs', v_recheck_active,
            'deficiency_count', v_recheck_deficiency_count));
        CONTINUE;
      END IF;

      UPDATE public.course_packages
      SET is_published = true, status = 'published', updated_at = now()
      WHERE id = v_pkg_id;

      v_executed := v_executed || jsonb_build_object('package_id', v_pkg_id, 'action', 'force_publish');

    ELSIF v_action = 'bulk_reconcile' THEN
      SELECT
        rc.release_class,
        COALESCE((SELECT COUNT(*) FROM public.job_queue
                  WHERE package_id = v_pkg_id
                    AND status IN ('pending','queued','processing')
                    AND job_type LIKE 'package_repair_%'), 0)
      INTO v_recheck_class, v_recheck_active
      FROM public.v_package_release_classification rc
      WHERE rc.package_id = v_pkg_id;

      IF v_recheck_class IS DISTINCT FROM 'release_warn' OR v_recheck_active > 0 THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'state_changed');
        CONTINUE;
      END IF;

      SELECT EXISTS(SELECT 1 FROM public.job_queue
        WHERE package_id = v_pkg_id AND job_type = 'package_reconcile_artifacts'
          AND status IN ('pending','queued','processing'))
      INTO v_already_running;

      IF v_already_running THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'already_running');
        CONTINUE;
      END IF;

      SELECT EXISTS(SELECT 1 FROM public.job_queue
        WHERE package_id = v_pkg_id AND job_type = 'package_reconcile_artifacts'
          AND created_at > now() - interval '10 minutes')
      INTO v_cooldown_exists;

      IF v_cooldown_exists THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'cooldown_skip');
        CONTINUE;
      END IF;

      INSERT INTO public.job_queue (job_type, package_id, status, payload, priority)
      VALUES ('package_reconcile_artifacts', v_pkg_id, 'queued',
              jsonb_build_object('source', 'admin_smart_heal_bulk'), 50)
      RETURNING id INTO v_job_id;

      v_executed := v_executed || jsonb_build_object(
        'package_id', v_pkg_id, 'action', 'bulk_reconcile', 'job_id', v_job_id);

    ELSIF v_action = 'monitor' THEN
      v_skipped := v_skipped || jsonb_build_object(
        'package_id', v_pkg_id, 'action', v_action, 'reason', 'monitor_only');
    ELSE
      v_skipped := v_skipped || jsonb_build_object(
        'package_id', v_pkg_id, 'action', v_action, 'reason', 'unsupported_in_bulk');
    END IF;
  END LOOP;

  INSERT INTO public.admin_actions (action, scope, payload, user_id)
  VALUES ('smart_heal_bulk', 'heal_cockpit',
    jsonb_build_object(
      'requested_action', _action,
      'package_count', array_length(_package_ids, 1),
      'executed_count', jsonb_array_length(v_executed),
      'skipped_count', jsonb_array_length(v_skipped),
      'needs_modal_count', jsonb_array_length(v_needs_modal),
      'needs_confirmation_count', jsonb_array_length(v_needs_confirmation)),
    auth.uid());

  RETURN jsonb_build_object(
    'ok', true, 'executed', v_executed, 'skipped', v_skipped,
    'needs_modal', v_needs_modal, 'needs_confirmation', v_needs_confirmation);
END;
$$;

COMMENT ON FUNCTION public.admin_smart_heal_bulk(uuid[], text) IS
'Heal-Cockpit v8.1 Bulk-Router: fail-closed Recheck, Idempotenz, härterer force_publish-Guard, konkreter Reconcile-Jobtyp.';

GRANT EXECUTE ON FUNCTION public.admin_smart_heal_bulk(uuid[], text) TO authenticated;

NOTIFY pgrst, 'reload schema';