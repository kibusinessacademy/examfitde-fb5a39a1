-- ============================================================================
-- 1. admin_reaper_audit table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_reaper_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid,
  package_id uuid,
  job_type text,
  action text NOT NULL,                -- 'hard_cancel' | 'unlock_orphan' | 'max_attempts_terminal' | 'retry_enqueue'
  reason text,
  transient_attempts integer,
  liveness_requeued boolean,
  before_state jsonb,
  config_snapshot jsonb
);

CREATE INDEX IF NOT EXISTS idx_admin_reaper_audit_run_at
  ON public.admin_reaper_audit (run_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_reaper_audit_package
  ON public.admin_reaper_audit (package_id, run_at DESC);

ALTER TABLE public.admin_reaper_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read reaper audit" ON public.admin_reaper_audit;
CREATE POLICY "admins read reaper audit"
  ON public.admin_reaper_audit
  FOR SELECT
  USING (public.is_admin_user(auth.uid()));

-- ============================================================================
-- 2. Seed reaper_config in admin_settings (idempotent)
-- ============================================================================
INSERT INTO public.admin_settings (key, value, description)
VALUES (
  'reaper_config',
  jsonb_build_object(
    'stale_recoveries_threshold', 5,
    'max_cancels_per_run', 200,
    'orphan_lock_minutes', 15,
    'cron_interval_minutes', 10,
    'enabled', true
  ),
  'Configurable thresholds for fn_reap_stale_jobs_configurable. UI: /admin/ops/blocker-ops'
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 3. Configurable reaper with audit logging
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_reap_stale_jobs_configurable()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg              jsonb;
  v_threshold        integer;
  v_max_cancels      integer;
  v_orphan_minutes   integer;
  v_enabled          boolean;
  v_cancelled        integer := 0;
  v_unlocked         integer := 0;
  v_terminal         integer := 0;
BEGIN
  SELECT value INTO v_cfg FROM public.admin_settings WHERE key = 'reaper_config';
  IF v_cfg IS NULL THEN
    v_cfg := jsonb_build_object(
      'stale_recoveries_threshold', 5,
      'max_cancels_per_run', 200,
      'orphan_lock_minutes', 15,
      'enabled', true
    );
  END IF;

  v_enabled        := COALESCE((v_cfg->>'enabled')::boolean, true);
  v_threshold      := GREATEST(1, COALESCE((v_cfg->>'stale_recoveries_threshold')::int, 5));
  v_max_cancels    := GREATEST(1, COALESCE((v_cfg->>'max_cancels_per_run')::int, 200));
  v_orphan_minutes := GREATEST(1, COALESCE((v_cfg->>'orphan_lock_minutes')::int, 15));

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('enabled', false, 'cancelled', 0, 'unlocked', 0, 'terminal', 0);
  END IF;

  -- Step 1: Hard cancel (capped) with audit
  WITH targets AS (
    SELECT jq.id, jq.package_id, jq.job_type, jq.meta,
           COALESCE((jq.meta->>'transient_attempts')::int, 0) AS attempts
    FROM public.job_queue jq
    WHERE jq.status IN ('processing','running','pending')
      AND COALESCE((jq.meta->>'liveness_requeued')::boolean, false) = true
      AND COALESCE((jq.meta->>'transient_attempts')::int, 0) >= v_threshold
    ORDER BY jq.updated_at ASC
    LIMIT v_max_cancels
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET status = 'cancelled',
        completed_at = now(),
        updated_at = now(),
        last_error_code = 'STALE_REAPER_TERMINAL',
        last_error = 'Cancelled by configurable reaper (>=' || v_threshold || ' liveness recoveries)',
        meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
          'stale_reaper_terminal_at', to_jsonb(now()),
          'stale_reaper_reason', 'liveness_recoveries_exhausted_configurable'
        )
    FROM targets t
    WHERE jq.id = t.id
    RETURNING jq.id, jq.package_id, jq.job_type, t.attempts
  )
  INSERT INTO public.admin_reaper_audit
    (job_id, package_id, job_type, action, reason, transient_attempts, liveness_requeued, before_state, config_snapshot)
  SELECT u.id, u.package_id, u.job_type, 'hard_cancel',
         'transient_attempts >= ' || v_threshold,
         u.attempts, true,
         jsonb_build_object('attempts', u.attempts),
         v_cfg
  FROM upd u;
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  -- Step 2: Unlock orphan locks
  WITH upd AS (
    UPDATE public.job_queue
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'stale_reaper_unlocked_at', to_jsonb(now()),
          'stale_reaper_reason', 'orphan_lock_no_start_configurable'
        )
    WHERE status = 'processing'
      AND started_at IS NULL
      AND locked_at < now() - make_interval(mins => v_orphan_minutes)
      AND COALESCE((meta->>'transient_attempts')::int, 0) < v_threshold
    RETURNING id, package_id, job_type, COALESCE((meta->>'transient_attempts')::int, 0) AS attempts
  )
  INSERT INTO public.admin_reaper_audit
    (job_id, package_id, job_type, action, reason, transient_attempts, before_state, config_snapshot)
  SELECT u.id, u.package_id, u.job_type, 'unlock_orphan',
         'orphan lock > ' || v_orphan_minutes || ' min',
         u.attempts,
         jsonb_build_object('attempts', u.attempts),
         v_cfg
  FROM upd u;
  GET DIAGNOSTICS v_unlocked = ROW_COUNT;

  -- Step 3: max_attempts terminal
  WITH upd AS (
    UPDATE public.job_queue
    SET status = 'cancelled',
        completed_at = now(),
        updated_at = now(),
        last_error_code = 'MAX_ATTEMPTS_TERMINAL',
        last_error = COALESCE(last_error, 'Cancelled: max_attempts exhausted'),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'stale_reaper_terminal_at', to_jsonb(now()),
          'stale_reaper_reason', 'max_attempts_exhausted_configurable'
        )
    WHERE status IN ('pending','processing')
      AND attempts >= max_attempts
    RETURNING id, package_id, job_type, attempts
  )
  INSERT INTO public.admin_reaper_audit
    (job_id, package_id, job_type, action, reason, transient_attempts, before_state, config_snapshot)
  SELECT u.id, u.package_id, u.job_type, 'max_attempts_terminal',
         'attempts >= max_attempts',
         u.attempts,
         jsonb_build_object('attempts', u.attempts),
         v_cfg
  FROM upd u;
  GET DIAGNOSTICS v_terminal = ROW_COUNT;

  RETURN jsonb_build_object(
    'enabled', true,
    'cancelled', v_cancelled,
    'unlocked', v_unlocked,
    'terminal', v_terminal,
    'config', v_cfg,
    'ran_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_reap_stale_jobs_configurable() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reap_stale_jobs_configurable() TO service_role;

-- ============================================================================
-- 4. Auto-selector: defect-aware exam pool repair action
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_select_exam_pool_repair_action(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_track            text;
  v_min              integer;
  v_approved         integer := 0;
  v_lf_total         integer := 0;
  v_lf_covered       integer := 0;
  v_comp_total       integer := 0;
  v_comp_covered     integer := 0;
  v_volume_gap       integer := 0;
  v_lf_gap_pct       numeric := 0;
  v_comp_gap_pct     numeric := 0;
  v_action           text;
  v_reason           text;
BEGIN
  SELECT package_track::text, approved_exam_questions
    INTO v_track, v_approved
  FROM public.v_admin_publish_readiness
  WHERE package_id = p_package_id;

  IF v_track IS NULL THEN
    RETURN jsonb_build_object('error', 'package_not_found');
  END IF;

  v_min := CASE v_track
    WHEN 'AUSBILDUNG_VOLL' THEN 300
    WHEN 'EXAM_FIRST'      THEN 150
    WHEN 'EXAM_FIRST_PLUS' THEN 300
    WHEN 'STUDIUM'         THEN 200
    ELSE 150
  END;

  v_volume_gap := GREATEST(0, v_min - COALESCE(v_approved, 0));

  -- LF coverage via learning_fields ↔ exam_questions (count of LFs with >=5 approved)
  SELECT COUNT(*) FILTER (WHERE TRUE),
         COUNT(*) FILTER (WHERE q_count >= 5)
    INTO v_lf_total, v_lf_covered
  FROM (
    SELECT lf.id,
      (SELECT count(*) FROM public.exam_questions eq
        WHERE eq.package_id = p_package_id
          AND eq.status = 'approved'
          AND eq.learning_field_id = lf.id) AS q_count
    FROM public.learning_fields lf
    JOIN public.course_packages cp ON cp.curriculum_id = lf.curriculum_id
    WHERE cp.id = p_package_id
  ) lf_counts;

  -- Competency coverage (>=3 approved per competency)
  SELECT COUNT(*) FILTER (WHERE TRUE),
         COUNT(*) FILTER (WHERE q_count >= 3)
    INTO v_comp_total, v_comp_covered
  FROM (
    SELECT c.id,
      (SELECT count(*) FROM public.exam_questions eq
        WHERE eq.package_id = p_package_id
          AND eq.status = 'approved'
          AND eq.competency_id = c.id) AS q_count
    FROM public.competencies c
    JOIN public.learning_fields lf ON lf.id = c.learning_field_id
    JOIN public.course_packages cp ON cp.curriculum_id = lf.curriculum_id
    WHERE cp.id = p_package_id
  ) comp_counts;

  v_lf_gap_pct   := CASE WHEN v_lf_total > 0 THEN round(100.0 * (v_lf_total - v_lf_covered) / v_lf_total, 1) ELSE 0 END;
  v_comp_gap_pct := CASE WHEN v_comp_total > 0 THEN round(100.0 * (v_comp_total - v_comp_covered) / v_comp_total, 1) ELSE 0 END;

  -- Decision logic
  IF v_lf_gap_pct >= 10 THEN
    v_action := 'package_repair_exam_pool_lf_coverage';
    v_reason := 'lf_gap_pct=' || v_lf_gap_pct;
  ELSIF v_comp_gap_pct >= 15 THEN
    v_action := 'package_repair_exam_pool_competency_coverage';
    v_reason := 'comp_gap_pct=' || v_comp_gap_pct;
  ELSIF v_volume_gap > 0 THEN
    -- Volume defect → quality variant generates more variants
    v_action := 'package_repair_exam_pool_quality';
    v_reason := 'volume_gap=' || v_volume_gap || ' (need ' || v_min || ', have ' || COALESCE(v_approved,0) || ')';
  ELSE
    v_action := 'package_repair_exam_pool_quality';
    v_reason := 'baseline_quality_lift';
  END IF;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'track', v_track,
    'min_required', v_min,
    'approved', v_approved,
    'volume_gap', v_volume_gap,
    'lf_total', v_lf_total,
    'lf_covered', v_lf_covered,
    'lf_gap_pct', v_lf_gap_pct,
    'comp_total', v_comp_total,
    'comp_covered', v_comp_covered,
    'comp_gap_pct', v_comp_gap_pct,
    'recommended_action', v_action,
    'reason', v_reason
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_select_exam_pool_repair_action(uuid) TO authenticated;

-- ============================================================================
-- 5. Blocker dashboard view
-- ============================================================================
CREATE OR REPLACE VIEW public.v_admin_blocker_dashboard AS
SELECT
  pr.package_id,
  pr.curriculum_id,
  pr.course_title,
  pr.curriculum_title,
  pr.package_track,
  pr.package_status,
  pr.primary_blocker,
  pr.integrity_passed,
  pr.approved_exam_questions,
  pr.usable_exam_questions,
  pr.integrity_report->>'defer_reason'           AS defer_reason,
  pr.integrity_report->>'reason_code'            AS reason_code,
  pr.integrity_report->'hard_fail_reasons'       AS hard_fail_reasons,
  pr.quality_council_status,
  pr.updated_at
FROM public.v_admin_publish_readiness pr
WHERE pr.primary_blocker IN (
  'INTEGRITY_NEVER_CHECKED',
  'INTEGRITY_DEFERRED',
  'QUALITY_COUNCIL_PENDING',
  'EXAM_POOL_TOO_SMALL'
);

GRANT SELECT ON public.v_admin_blocker_dashboard TO authenticated;

-- ============================================================================
-- 6. Deferred-resolved alert view
-- ============================================================================
CREATE OR REPLACE VIEW public.v_admin_deferred_resolved_alerts AS
WITH d AS (
  SELECT pr.package_id, pr.curriculum_id, pr.course_title, pr.package_track,
         pr.approved_exam_questions, pr.updated_at,
         pr.integrity_report->>'defer_reason' AS defer_reason,
         pr.integrity_report->>'reason_code'  AS reason_code,
         CASE pr.package_track::text
           WHEN 'AUSBILDUNG_VOLL' THEN 300
           WHEN 'EXAM_FIRST'      THEN 150
           WHEN 'EXAM_FIRST_PLUS' THEN 300
           WHEN 'STUDIUM'         THEN 200
           ELSE 150
         END AS min_required
  FROM public.v_admin_publish_readiness pr
  WHERE pr.primary_blocker = 'INTEGRITY_DEFERRED'
)
SELECT d.*,
       (d.approved_exam_questions >= d.min_required) AS condition_resolved,
       (d.defer_reason IN ('WAITING_FOR_MATERIALIZATION','SAMPLE_TOO_SMALL')) AS reason_known,
       EXTRACT(EPOCH FROM (now() - d.updated_at))/3600.0 AS hours_since_update
FROM d
WHERE (d.approved_exam_questions >= d.min_required)
  AND d.defer_reason IS NOT NULL;

GRANT SELECT ON public.v_admin_deferred_resolved_alerts TO authenticated;