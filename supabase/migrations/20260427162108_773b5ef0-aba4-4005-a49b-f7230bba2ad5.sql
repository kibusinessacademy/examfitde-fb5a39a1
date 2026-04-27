
-- =====================================================================
-- 1) VIEW: v_admin_stuck_patterns_overview
-- Systemweite Übersicht der 3 kritischen Stuck-Patterns
-- =====================================================================
CREATE OR REPLACE VIEW public.v_admin_stuck_patterns_overview AS
WITH hidden_drafts AS (
  SELECT
    'HIDDEN_DRAFTS'::text AS pattern_key,
    'Hidden Drafts ≥10'::text AS pattern_label,
    'Pakete mit ≥10 promotbaren Draft-Fragen — Coverage-Gap blockiert validate_exam_pool.'::text AS pattern_help,
    count(DISTINCT cp.id)::int AS package_count,
    coalesce(sum(d.draft_count), 0)::int AS detail_count,
    array_agg(DISTINCT cp.id) FILTER (WHERE cp.id IS NOT NULL) AS package_ids
  FROM course_packages cp
  JOIN LATERAL (
    SELECT count(*)::int AS draft_count
    FROM exam_questions eq
    WHERE eq.package_id = cp.id
      AND eq.status = 'draft'
  ) d ON TRUE
  WHERE cp.archived IS NOT TRUE
    AND cp.status IN ('building','queued','quality_gate_failed','blocked')
    AND d.draft_count >= 10
),
queued_no_jobs AS (
  SELECT
    'QUEUED_NO_JOBS'::text AS pattern_key,
    'Queued ohne aktive Jobs'::text AS pattern_label,
    'Pakete im Status=queued mit offenen Steps aber 0 aktiven Jobs — P0A-Guard verhindert Auto-Enqueue.'::text AS pattern_help,
    count(DISTINCT cp.id)::int AS package_count,
    count(DISTINCT cp.id)::int AS detail_count,
    array_agg(DISTINCT cp.id) FILTER (WHERE cp.id IS NOT NULL) AS package_ids
  FROM course_packages cp
  WHERE cp.archived IS NOT TRUE
    AND cp.status = 'queued'
    AND EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = cp.id AND ps.status = 'queued'::step_status
    )
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled')
    )
),
reentry_locked AS (
  SELECT
    'REENTRY_GUARD_LOCKED'::text AS pattern_key,
    'Re-Entry-Guard aktiv'::text AS pattern_label,
    'Pakete mit manual_heal_cooldown_until > now() — Re-Entry-Sperre verhindert weitere Heals.'::text AS pattern_help,
    count(DISTINCT cp.id)::int AS package_count,
    count(DISTINCT cp.id)::int AS detail_count,
    array_agg(DISTINCT cp.id) FILTER (WHERE cp.id IS NOT NULL) AS package_ids
  FROM course_packages cp
  WHERE cp.archived IS NOT TRUE
    AND cp.manual_heal_cooldown_until IS NOT NULL
    AND cp.manual_heal_cooldown_until > now()
)
SELECT * FROM hidden_drafts
UNION ALL SELECT * FROM queued_no_jobs
UNION ALL SELECT * FROM reentry_locked;

GRANT SELECT ON public.v_admin_stuck_patterns_overview TO authenticated, service_role;

-- =====================================================================
-- 2) VIEW: v_admin_stuck_patterns_by_track
-- Detail-Liste je Paket mit Track + Priorisierung
-- =====================================================================
CREATE OR REPLACE VIEW public.v_admin_stuck_patterns_by_track AS
WITH base AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.track::text AS track,
    cp.status::text AS package_status,
    cp.curriculum_id,
    cp.priority,
    cp.last_progress_at,
    cp.manual_heal_cooldown_until,
    -- Pattern flags
    (
      SELECT count(*) FROM exam_questions eq
      WHERE eq.package_id = cp.id AND eq.status = 'draft'
    ) AS draft_count,
    (
      SELECT count(*) FROM package_steps ps
      WHERE ps.package_id = cp.id AND ps.status = 'queued'::step_status
    ) AS queued_steps,
    (
      SELECT count(*) FROM job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled')
    ) AS active_jobs
  FROM course_packages cp
  WHERE cp.archived IS NOT TRUE
)
SELECT
  package_id,
  title,
  track,
  package_status,
  curriculum_id,
  coalesce(priority, 0) AS priority,
  last_progress_at,
  manual_heal_cooldown_until,
  draft_count,
  queued_steps,
  active_jobs,
  -- Pattern classification (multi)
  array_remove(ARRAY[
    CASE WHEN draft_count >= 10 AND package_status IN ('building','queued','quality_gate_failed','blocked') THEN 'HIDDEN_DRAFTS' END,
    CASE WHEN package_status='queued' AND queued_steps>0 AND active_jobs=0 THEN 'QUEUED_NO_JOBS' END,
    CASE WHEN manual_heal_cooldown_until IS NOT NULL AND manual_heal_cooldown_until > now() THEN 'REENTRY_GUARD_LOCKED' END
  ], NULL) AS patterns,
  -- Priority score: more patterns + queued steps + age
  (
    CASE WHEN draft_count >= 10 THEN 30 ELSE 0 END
    + CASE WHEN package_status='queued' AND queued_steps>0 AND active_jobs=0 THEN 20 ELSE 0 END
    + CASE WHEN manual_heal_cooldown_until IS NOT NULL AND manual_heal_cooldown_until > now() THEN 10 ELSE 0 END
    + LEAST(20, COALESCE(EXTRACT(EPOCH FROM (now()-last_progress_at))/86400, 0)::int)
  ) AS heal_priority_score
FROM base
WHERE
  draft_count >= 10
  OR (package_status='queued' AND queued_steps>0 AND active_jobs=0)
  OR (manual_heal_cooldown_until IS NOT NULL AND manual_heal_cooldown_until > now());

GRANT SELECT ON public.v_admin_stuck_patterns_by_track TO authenticated, service_role;

-- =====================================================================
-- 3) RPC: admin_nudge_atomic_trigger (per package)
-- Stößt für ein einzelnes Paket den Atomic-Trigger zuverlässig an
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_nudge_atomic_trigger(
  p_package_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg RECORD;
  v_step RECORD;
  v_active_jobs int;
  v_promoted boolean := false;
  v_nudged boolean := false;
  v_skip_reason text := NULL;
BEGIN
  SELECT id, title, status::text AS status, archived, curriculum_id
  INTO v_pkg
  FROM course_packages WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;

  IF v_pkg.archived IS TRUE THEN
    v_skip_reason := 'skip_archived';
  ELSIF v_pkg.curriculum_id IS NULL THEN
    v_skip_reason := 'skip_no_curriculum';
  END IF;

  SELECT count(*) INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled');

  IF v_active_jobs > 0 THEN
    v_skip_reason := COALESCE(v_skip_reason, 'skip_has_active_jobs');
  END IF;

  -- Pick first queued step (lowest priority order via step_order if exists, else id)
  SELECT id, step_key, status::text AS status, attempts
  INTO v_step
  FROM package_steps
  WHERE package_id = p_package_id AND status = 'queued'::step_status
  ORDER BY created_at ASC
  LIMIT 1;

  IF NOT FOUND AND v_skip_reason IS NULL THEN
    v_skip_reason := 'skip_no_queued_steps';
  END IF;

  IF v_skip_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'package_id', p_package_id,
      'skip_reason', v_skip_reason,
      'package_status', v_pkg.status,
      'active_jobs', v_active_jobs
    );
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'package_id', p_package_id,
      'package_status', v_pkg.status,
      'will_promote_to_building', v_pkg.status = 'queued',
      'will_nudge_step_key', v_step.step_key,
      'will_nudge_step_id', v_step.id
    );
  END IF;

  -- Promote queued -> building if needed
  IF v_pkg.status = 'queued' THEN
    UPDATE course_packages
    SET status = 'building',
        last_progress_at = now(),
        blocked_reason = NULL,
        manual_heal_cooldown_until = NULL
    WHERE id = p_package_id;
    v_promoted := true;
  END IF;

  -- Nudge step: rewrite meta.reset_reason to bypass re-entry guards
  UPDATE package_steps
  SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'reset_reason', 'manual_atomic_nudge',
        'nudged_at', now()
      ),
      attempts = 0,
      last_error = NULL,
      updated_at = now()
  WHERE id = v_step.id;
  v_nudged := true;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'manual_atomic_nudge',
    'admin_nudge_atomic_trigger',
    'package',
    p_package_id::text,
    'ok',
    'Promoted=' || v_promoted::text || ' Nudged step=' || v_step.step_key,
    jsonb_build_object(
      'package_id', p_package_id,
      'promoted_to_building', v_promoted,
      'nudged_step_id', v_step.id,
      'nudged_step_key', v_step.step_key
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'promoted_to_building', v_promoted,
    'nudged_step_key', v_step.step_key,
    'nudged_step_id', v_step.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_nudge_atomic_trigger(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_nudge_atomic_trigger(uuid, boolean) TO authenticated, service_role;

-- =====================================================================
-- 4) RPC: admin_bulk_promote_queued_to_building
-- Bulk-Heal mit Guardrails + WIP-Cap + Skip-Reasons
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_bulk_promote_queued_to_building(
  p_dry_run boolean DEFAULT true,
  p_max_packages int DEFAULT 10,
  p_wip_cap int DEFAULT 65
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_building int;
  v_slots_available int;
  v_target_count int;
  v_pkg RECORD;
  v_step_id uuid;
  v_step_key text;
  v_active_jobs int;
  v_processed int := 0;
  v_promoted int := 0;
  v_nudged int := 0;
  v_results jsonb := '[]'::jsonb;
  v_skip_reason text;
BEGIN
  -- Determine WIP availability
  SELECT count(*) INTO v_current_building
  FROM course_packages
  WHERE status = 'building' AND archived IS NOT TRUE;

  v_slots_available := GREATEST(0, p_wip_cap - v_current_building);
  v_target_count := LEAST(p_max_packages, v_slots_available);

  IF v_target_count <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', p_dry_run,
      'wip_cap', p_wip_cap,
      'current_building', v_current_building,
      'slots_available', v_slots_available,
      'processed', 0,
      'promoted', 0,
      'nudged', 0,
      'skip_global', 'wip_cap_reached',
      'results', '[]'::jsonb
    );
  END IF;

  -- Iterate candidates (queued packages, prioritized by oldest progress)
  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.status::text AS status, cp.archived, cp.curriculum_id, cp.priority
    FROM course_packages cp
    WHERE cp.status = 'queued'
      AND cp.archived IS NOT TRUE
    ORDER BY COALESCE(cp.priority, 0) DESC, cp.last_progress_at ASC NULLS FIRST
    LIMIT (v_target_count * 3)  -- Oversample because some will be skipped
  LOOP
    EXIT WHEN v_processed >= v_target_count;

    v_skip_reason := NULL;
    v_step_id := NULL;
    v_step_key := NULL;

    -- Guardrail: archived
    IF v_pkg.archived IS TRUE THEN
      v_skip_reason := 'skip_archived';
    -- Guardrail: missing curriculum
    ELSIF v_pkg.curriculum_id IS NULL THEN
      v_skip_reason := 'skip_no_curriculum';
    END IF;

    -- Guardrail: must have queued steps
    IF v_skip_reason IS NULL THEN
      SELECT id, step_key INTO v_step_id, v_step_key
      FROM package_steps
      WHERE package_id = v_pkg.id AND status = 'queued'::step_status
      ORDER BY created_at ASC
      LIMIT 1;
      IF v_step_id IS NULL THEN
        v_skip_reason := 'skip_no_queued_steps';
      END IF;
    END IF;

    -- Guardrail: must NOT have active jobs (otherwise the building Step-Nudge would be redundant)
    IF v_skip_reason IS NULL THEN
      SELECT count(*) INTO v_active_jobs
      FROM job_queue jq
      WHERE jq.package_id = v_pkg.id
        AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled');
      IF v_active_jobs > 0 THEN
        v_skip_reason := 'skip_has_active_jobs';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.id,
        'title', v_pkg.title,
        'status', 'skipped',
        'reason', v_skip_reason
      );
      CONTINUE;
    END IF;

    -- Action (or dry-run preview)
    IF NOT p_dry_run THEN
      UPDATE course_packages
      SET status = 'building',
          last_progress_at = now(),
          blocked_reason = NULL,
          manual_heal_cooldown_until = NULL
      WHERE id = v_pkg.id;
      v_promoted := v_promoted + 1;

      UPDATE package_steps
      SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'reset_reason', 'bulk_promote_queued_to_building',
            'nudged_at', now()
          ),
          attempts = 0,
          last_error = NULL,
          updated_at = now()
      WHERE id = v_step_id;
      v_nudged := v_nudged + 1;

      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES (
        'bulk_promote_queued_to_building',
        'admin_bulk_promote_queued_to_building',
        'package',
        v_pkg.id::text,
        'promoted',
        'Promoted to building + nudged step ' || v_step_key,
        jsonb_build_object('package_id', v_pkg.id, 'step_key', v_step_key, 'step_id', v_step_id)
      );
    END IF;

    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg.id,
      'title', v_pkg.title,
      'status', CASE WHEN p_dry_run THEN 'would_promote' ELSE 'promoted' END,
      'step_key', v_step_key
    );
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'wip_cap', p_wip_cap,
    'current_building', v_current_building,
    'slots_available', v_slots_available,
    'target_count', v_target_count,
    'processed', v_processed,
    'promoted', v_promoted,
    'nudged', v_nudged,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_promote_queued_to_building(boolean, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_promote_queued_to_building(boolean, int, int) TO authenticated, service_role;
