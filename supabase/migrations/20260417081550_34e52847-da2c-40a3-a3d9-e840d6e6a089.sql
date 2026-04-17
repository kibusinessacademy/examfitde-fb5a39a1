-- =========================================================================
-- HEAL-COCKPIT v8.2 – APPLY-READY HARDENING
-- Fixes: RPC signature, force_publish via admin_force_steps_done,
--        wip_capacity honesty, healed_count rename, audit hardening
-- =========================================================================

-- 1) Worklist View: add package_title (separate from course_title)
DROP VIEW IF EXISTS public.v_admin_heal_cockpit CASCADE;

CREATE OR REPLACE VIEW public.v_admin_heal_cockpit AS
WITH job_open_by_type AS (
  SELECT package_id, job_type, COUNT(*) AS cnt
  FROM public.job_queue
  WHERE status IN ('pending','queued','processing','failed')
    AND package_id IS NOT NULL
  GROUP BY package_id, job_type
),
job_agg AS (
  SELECT
    j.package_id,
    COUNT(*) FILTER (WHERE j.status IN ('pending','queued')) AS pending_jobs,
    COUNT(*) FILTER (WHERE j.status = 'processing') AS processing_jobs,
    COUNT(*) FILTER (
      WHERE j.status = 'failed' AND j.updated_at > now() - interval '24 hours'
    ) AS failed_jobs_24h,
    COUNT(*) FILTER (
      WHERE j.status IN ('pending','queued','processing')
        AND j.job_type LIKE 'package_repair_%'
    ) AS active_repair_jobs,
    COUNT(*) FILTER (
      WHERE j.status IN ('pending','queued','processing')
        AND j.job_type = 'package_reconcile_artifacts'
    ) AS active_reconcile_jobs,
    COALESCE(MAX(j.attempts) FILTER (
      WHERE j.job_type LIKE 'package_repair_%' AND j.created_at > now() - interval '7 days'
    ), 0) AS repair_attempts_proxy,
    MAX(j.updated_at) FILTER (WHERE j.status = 'processing') AS last_processing_at,
    COALESCE(
      (SELECT jsonb_object_agg(t.job_type, t.cnt)
       FROM job_open_by_type t WHERE t.package_id = j.package_id),
      '{}'::jsonb
    ) AS open_jobs_by_type
  FROM public.job_queue j
  WHERE j.package_id IS NOT NULL
  GROUP BY j.package_id
),
step_agg AS (
  SELECT
    ps.package_id,
    COUNT(*) FILTER (
      WHERE (ps.status = 'blocked' AND COALESCE(ps.meta->>'no_effect_repair','false') = 'true')
         OR (ps.attempts >= COALESCE(ps.max_attempts, 3) AND ps.status IN ('blocked','failed','timeout'))
    ) AS exhausted_steps,
    COUNT(*) FILTER (WHERE ps.status = 'blocked') AS blocked_steps,
    MAX(ps.updated_at) AS last_step_change
  FROM public.package_steps ps
  GROUP BY ps.package_id
),
base AS (
  SELECT
    cp.id AS package_id,
    cp.title AS package_title,
    cp.curriculum_id,
    cp.status AS package_status,
    cp.is_published,
    cp.blocked_reason,
    cp.updated_at AS package_updated_at,
    rc.course_title,
    rc.release_class,
    rc.deficiency_codes,
    COALESCE(ja.pending_jobs, 0) AS pending_jobs,
    COALESCE(ja.processing_jobs, 0) AS processing_jobs,
    COALESCE(ja.failed_jobs_24h, 0) AS failed_jobs_24h,
    COALESCE(ja.active_repair_jobs, 0) AS active_repair_jobs,
    COALESCE(ja.active_reconcile_jobs, 0) AS active_reconcile_jobs,
    COALESCE(ja.repair_attempts_proxy, 0) AS repair_attempts_proxy,
    ja.last_processing_at,
    COALESCE(ja.open_jobs_by_type, '{}'::jsonb) AS open_jobs_by_type,
    COALESCE(sa.exhausted_steps, 0) AS exhausted_steps,
    COALESCE(sa.blocked_steps, 0) AS blocked_steps,
    sa.last_step_change
  FROM public.course_packages cp
  LEFT JOIN public.v_package_release_classification rc ON rc.package_id = cp.id
  LEFT JOIN job_agg ja ON ja.package_id = cp.id
  LEFT JOIN step_agg sa ON sa.package_id = cp.id
  WHERE cp.status IS NOT NULL
)
SELECT
  b.package_id,
  b.package_title,
  b.course_title,
  b.curriculum_id,
  b.package_status,
  b.is_published,
  b.blocked_reason,
  b.release_class,
  b.deficiency_codes,
  b.pending_jobs,
  b.processing_jobs,
  b.failed_jobs_24h,
  b.active_repair_jobs,
  b.active_reconcile_jobs,
  b.repair_attempts_proxy,
  b.exhausted_steps,
  b.blocked_steps,
  b.last_processing_at,
  b.last_step_change,
  b.package_updated_at,
  b.open_jobs_by_type,

  -- recommended_action: deterministic precedence
  CASE
    WHEN (b.package_status = 'published' OR b.is_published = true)
         AND b.deficiency_codes IS NOT NULL
         AND array_length(b.deficiency_codes, 1) > 0
      THEN 'hard_rebuild'
    WHEN b.blocked_reason = 'quality_no_progress_3x' OR b.exhausted_steps > 0
      THEN 'guided_recovery'
    WHEN b.release_class = 'release_block' AND b.repair_attempts_proxy > 5
      THEN 'mark_content_gap'
    WHEN b.release_class = 'release_ok'
         AND b.package_status <> 'published'
         AND COALESCE(b.is_published, false) = false
         AND COALESCE(array_length(b.deficiency_codes,1),0) = 0
         AND b.blocked_reason IS NULL
         AND b.active_repair_jobs = 0
      THEN 'force_publish'
    WHEN b.release_class = 'release_warn'
         AND b.active_repair_jobs = 0
         AND b.active_reconcile_jobs = 0
      THEN 'bulk_reconcile'
    WHEN (b.processing_jobs > 0 AND b.last_processing_at > now() - interval '20 minutes')
      OR (b.pending_jobs > 0 AND b.package_updated_at > now() - interval '30 minutes')
      THEN 'monitor'
    ELSE 'manual_review'
  END AS recommended_action,

  -- actionability_class: governs UI behavior
  CASE
    WHEN (b.package_status = 'published' OR b.is_published = true)
         AND b.deficiency_codes IS NOT NULL
         AND array_length(b.deficiency_codes,1) > 0 THEN 'confirm'
    WHEN b.blocked_reason = 'quality_no_progress_3x' OR b.exhausted_steps > 0 THEN 'modal'
    WHEN b.release_class = 'release_block' AND b.repair_attempts_proxy > 5 THEN 'confirm'
    WHEN b.release_class = 'release_ok'
         AND b.package_status <> 'published'
         AND COALESCE(b.is_published,false) = false
         AND b.blocked_reason IS NULL
         AND b.active_repair_jobs = 0 THEN 'auto'
    WHEN b.release_class = 'release_warn'
         AND b.active_repair_jobs = 0
         AND b.active_reconcile_jobs = 0 THEN 'auto'
    ELSE 'observe'
  END AS actionability_class,

  -- recommended_action_reasons (transparency for UI drawer)
  ARRAY_REMOVE(ARRAY[
    CASE WHEN b.blocked_reason IS NOT NULL THEN 'blocked_reason=' || b.blocked_reason END,
    CASE WHEN b.exhausted_steps > 0 THEN 'exhausted_steps=' || b.exhausted_steps::text END,
    CASE WHEN b.release_class IS NOT NULL THEN 'release_class=' || b.release_class END,
    CASE WHEN b.repair_attempts_proxy > 5 THEN 'repair_attempts_proxy=' || b.repair_attempts_proxy::text END,
    CASE WHEN b.deficiency_codes IS NOT NULL AND array_length(b.deficiency_codes,1) > 0
         THEN 'deficiencies=' || array_length(b.deficiency_codes,1)::text END,
    CASE WHEN b.active_repair_jobs > 0 THEN 'active_repair_jobs=' || b.active_repair_jobs::text END,
    CASE WHEN b.active_reconcile_jobs > 0 THEN 'active_reconcile_jobs=' || b.active_reconcile_jobs::text END,
    CASE WHEN b.failed_jobs_24h > 3 THEN 'failed_jobs_24h=' || b.failed_jobs_24h::text END,
    CASE WHEN b.package_status = 'published' THEN 'is_published=true' END
  ], NULL) AS recommended_action_reasons,

  -- urgency_score 0..100
  LEAST(100, GREATEST(0,
    CASE
      WHEN (b.package_status = 'published' OR b.is_published = true)
           AND b.deficiency_codes IS NOT NULL
           AND array_length(b.deficiency_codes,1) > 0 THEN 95
      WHEN b.blocked_reason = 'quality_no_progress_3x' OR b.exhausted_steps > 0 THEN 90
      WHEN b.release_class = 'release_block' AND b.repair_attempts_proxy > 5 THEN 85
      WHEN b.release_class = 'release_ok' AND b.package_status <> 'published' THEN 70
      WHEN b.release_class = 'release_warn' THEN 55
      WHEN b.processing_jobs > 0 OR b.pending_jobs > 0 THEN 20
      ELSE 50
    END
    + CASE WHEN b.blocked_reason IS NOT NULL THEN 10 ELSE 0 END
    + CASE WHEN b.exhausted_steps > 0 THEN 8 ELSE 0 END
    + CASE WHEN b.failed_jobs_24h > 3 THEN 6 ELSE 0 END
    + CASE WHEN b.release_class = 'release_block' THEN 5 ELSE 0 END
    - CASE WHEN b.processing_jobs > 0 AND b.last_processing_at > now() - interval '10 minutes' THEN 10 ELSE 0 END
  )) AS urgency_score
FROM base b;

COMMENT ON VIEW public.v_admin_heal_cockpit IS
'Heal-Cockpit v8.2 SSOT worklist. Notes:
- repair_attempts_proxy uses MAX(job_queue.attempts) FILTER LIKE package_repair_% (last 7d) — operational proxy until repair_attempts metric exists.
- exhausted_steps derived from package_steps (no_effect_repair OR attempts >= max_attempts).
- recommended_action precedence: hard_rebuild > guided_recovery > mark_content_gap > force_publish > bulk_reconcile > monitor > manual_review.';

-- =========================================================================
-- 2) Morning Briefing: honest wip_capacity (NULL), rename healed_count
-- =========================================================================
DROP VIEW IF EXISTS public.v_admin_morning_briefing CASCADE;

CREATE OR REPLACE VIEW public.v_admin_morning_briefing AS
SELECT
  (SELECT COUNT(*) FROM public.course_packages
   WHERE status = 'blocked' AND updated_at > now() - interval '24 hours') AS newly_blocked_count,
  (SELECT COUNT(*) FROM public.course_packages
   WHERE is_published = true AND updated_at > now() - interval '24 hours') AS newly_published_count,
  (SELECT COUNT(*) FROM public.job_queue
   WHERE status = 'completed' AND job_type LIKE 'package_repair_%'
     AND updated_at > now() - interval '24 hours') AS completed_repairs_24h,
  (SELECT COUNT(*) FROM public.job_queue
   WHERE status = 'failed' AND updated_at > now() - interval '24 hours') AS failed_jobs_24h,
  (SELECT COUNT(*) FROM public.course_packages
   WHERE blocked_reason = 'quality_no_progress_3x') AS quality_no_progress_blocks,
  (SELECT COUNT(*) FROM public.job_queue WHERE status = 'processing') AS wip_active,
  NULL::int AS wip_capacity,  -- intentional: no SSOT-stable global capacity source in v8.2
  (SELECT COUNT(*) FROM public.v_admin_heal_cockpit
   WHERE recommended_action IN ('hard_rebuild','guided_recovery')) AS critical_actions_pending,
  (SELECT COUNT(*) FROM public.v_admin_heal_cockpit
   WHERE recommended_action = 'force_publish') AS publish_ready_count;

COMMENT ON VIEW public.v_admin_morning_briefing IS
'Heal-Cockpit v8.2 morning briefing. wip_capacity intentionally NULL — no SSOT-stable global WIP capacity source exists yet. completed_repairs_24h is operational proxy, not semantic "healed".';

-- =========================================================================
-- 3) RPC: stable signature + force_publish via admin_force_steps_done
-- =========================================================================
DROP FUNCTION IF EXISTS public.admin_smart_heal_bulk(uuid[], text);
DROP FUNCTION IF EXISTS public.admin_smart_heal_bulk(uuid[], uuid, text);

CREATE OR REPLACE FUNCTION public.admin_smart_heal_bulk(
  p_package_ids uuid[],
  p_caller_id uuid DEFAULT NULL,
  p_action text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_pkg_id uuid;
  v_row record;
  v_action text;
  v_executed jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_needs_modal jsonb := '[]'::jsonb;
  v_needs_confirmation jsonb := '[]'::jsonb;
  v_recheck_class text;
  v_recheck_status text;
  v_recheck_blocked text;
  v_recheck_published boolean;
  v_recheck_deficiencies text[];
  v_recheck_active_repair int;
  v_recheck_active_reconcile int;
  v_recent_reconcile int;
BEGIN
  -- Hard batch limit
  IF array_length(p_package_ids, 1) IS NULL OR array_length(p_package_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'executed', '[]'::jsonb, 'skipped', '[]'::jsonb,
      'needs_modal', '[]'::jsonb, 'needs_confirmation', '[]'::jsonb
    );
  END IF;

  IF array_length(p_package_ids, 1) > 25 THEN
    RAISE EXCEPTION 'bulk_limit_exceeded: max 25 packages per call (got %)', array_length(p_package_ids, 1);
  END IF;

  -- Override allowlist: only bulk_reconcile may be forced
  IF p_action IS NOT NULL AND p_action NOT IN ('bulk_reconcile') THEN
    RAISE EXCEPTION 'unsupported_override_action: % (only bulk_reconcile allowed)', p_action;
  END IF;

  FOREACH v_pkg_id IN ARRAY p_package_ids LOOP
    SELECT * INTO v_row FROM public.v_admin_heal_cockpit WHERE package_id = v_pkg_id;
    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('package_id', v_pkg_id, 'reason', 'not_found');
      CONTINUE;
    END IF;

    v_action := COALESCE(p_action, v_row.recommended_action);

    -- Modal/confirm actions are NOT executed silently
    IF v_action IN ('guided_recovery') THEN
      v_needs_modal := v_needs_modal || jsonb_build_object(
        'package_id', v_pkg_id, 'action', v_action,
        'reasons', to_jsonb(v_row.recommended_action_reasons)
      );
      CONTINUE;
    END IF;

    IF v_action IN ('hard_rebuild','mark_content_gap') THEN
      v_needs_confirmation := v_needs_confirmation || jsonb_build_object(
        'package_id', v_pkg_id, 'action', v_action,
        'reasons', to_jsonb(v_row.recommended_action_reasons)
      );
      CONTINUE;
    END IF;

    -- Fail-closed recheck for force_publish
    IF v_action = 'force_publish' THEN
      SELECT rc.release_class, cp.status, cp.blocked_reason, cp.is_published, rc.deficiency_codes
        INTO v_recheck_class, v_recheck_status, v_recheck_blocked, v_recheck_published, v_recheck_deficiencies
      FROM public.course_packages cp
      LEFT JOIN public.v_package_release_classification rc ON rc.package_id = cp.id
      WHERE cp.id = v_pkg_id;

      SELECT COUNT(*) INTO v_recheck_active_repair
      FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND status IN ('pending','queued','processing')
        AND job_type LIKE 'package_repair_%';

      IF v_recheck_class IS DISTINCT FROM 'release_ok'
         OR v_recheck_status = 'published'
         OR v_recheck_published = true
         OR v_recheck_blocked IS NOT NULL
         OR (v_recheck_deficiencies IS NOT NULL AND array_length(v_recheck_deficiencies,1) > 0)
         OR v_recheck_active_repair > 0
      THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'state_changed'
        );
        CONTINUE;
      END IF;

      -- Use official admin action — NEVER direct UPDATE on course_packages
      BEGIN
        PERFORM public.admin_force_steps_done(
          v_pkg_id,
          NULL::text[],
          'smart_heal_bulk:force_publish',
          false,  -- p_emergency_bypass
          true    -- p_force_publish
        );
        v_executed := v_executed || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'result', 'published_via_admin_force_steps_done'
        );
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action,
          'reason', 'admin_force_steps_done_failed', 'error', SQLERRM
        );
      END;
      CONTINUE;
    END IF;

    -- bulk_reconcile: idempotent enqueue
    IF v_action = 'bulk_reconcile' THEN
      SELECT COUNT(*) INTO v_recheck_active_reconcile
      FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND status IN ('pending','queued','processing')
        AND job_type = 'package_reconcile_artifacts';

      IF v_recheck_active_reconcile > 0 THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'already_running'
        );
        CONTINUE;
      END IF;

      SELECT COUNT(*) INTO v_recent_reconcile
      FROM public.job_queue
      WHERE package_id = v_pkg_id
        AND job_type = 'package_reconcile_artifacts'
        AND created_at > now() - interval '10 minutes';

      IF v_recent_reconcile > 0 THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'reason', 'cooldown_skip'
        );
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO public.job_queue (job_type, package_id, status, payload, created_at)
        VALUES (
          'package_reconcile_artifacts', v_pkg_id, 'pending',
          jsonb_build_object('source','smart_heal_bulk','caller_id', v_caller),
          now()
        );
        v_executed := v_executed || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action, 'result', 'enqueued'
        );
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_object(
          'package_id', v_pkg_id, 'action', v_action,
          'reason', 'enqueue_failed', 'error', SQLERRM
        );
      END;
      CONTINUE;
    END IF;

    -- monitor / manual_review: nothing to do
    v_skipped := v_skipped || jsonb_build_object(
      'package_id', v_pkg_id, 'action', v_action, 'reason', 'no_auto_action'
    );
  END LOOP;

  -- Hardened audit log
  INSERT INTO public.admin_actions (action, scope, affected_ids, payload, user_id)
  VALUES (
    'smart_heal_bulk',
    'heal_cockpit',
    p_package_ids,
    jsonb_build_object(
      'requested_action', p_action,
      'executed_count', jsonb_array_length(v_executed),
      'skipped_count', jsonb_array_length(v_skipped),
      'needs_modal_count', jsonb_array_length(v_needs_modal),
      'needs_confirmation_count', jsonb_array_length(v_needs_confirmation),
      'executed', v_executed,
      'skipped', v_skipped
    ),
    v_caller
  );

  RETURN jsonb_build_object(
    'ok', true,
    'executed', v_executed,
    'skipped', v_skipped,
    'needs_modal', v_needs_modal,
    'needs_confirmation', v_needs_confirmation
  );
END;
$$;

COMMENT ON FUNCTION public.admin_smart_heal_bulk(uuid[], uuid, text) IS
'Heal-Cockpit v8.2 bulk router. Stable signature (package_ids, caller_id, optional action override limited to bulk_reconcile). force_publish ALWAYS via admin_force_steps_done — never direct UPDATE. Hard batch limit 25. Fail-closed recheck on every action. Audit logs affected_ids + scope=heal_cockpit.';

GRANT EXECUTE ON FUNCTION public.admin_smart_heal_bulk(uuid[], uuid, text) TO authenticated;
GRANT SELECT ON public.v_admin_heal_cockpit TO authenticated;
GRANT SELECT ON public.v_admin_morning_briefing TO authenticated;