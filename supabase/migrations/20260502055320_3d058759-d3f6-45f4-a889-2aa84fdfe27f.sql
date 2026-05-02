-- ============================================================
-- Auto-Quarantine v1 (Job-Type-Level), enqueue_source Hard Gate,
-- Cron Drift-Guard Wrapper for */15-Heilern, Forensic-Audit
-- ============================================================

-- 1) JOB-TYPE-LEVEL QUARANTINE TABLE -------------------------
CREATE TABLE IF NOT EXISTS public.job_type_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  cancel_count int NOT NULL,
  window_minutes int NOT NULL,
  blocked_until timestamptz NOT NULL,
  reason text NOT NULL,
  triggered_by text NOT NULL DEFAULT 'fn_auto_quarantine_hot_cancel_loops',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_type_quarantine_active
  ON public.job_type_quarantine(job_type) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_type_quarantine_active
  ON public.job_type_quarantine(blocked_until) WHERE cleared_at IS NULL;

ALTER TABLE public.job_type_quarantine ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_job_type_quarantine" ON public.job_type_quarantine;
CREATE POLICY "admins_read_job_type_quarantine" ON public.job_type_quarantine
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) AUTO-DETECT + QUARANTINE FUNCTION -----------------------
CREATE OR REPLACE FUNCTION public.fn_auto_quarantine_hot_cancel_loops(
  p_window_minutes int DEFAULT 15,
  p_cancel_threshold int DEFAULT 30,
  p_block_minutes int DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quarantined int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT jq.job_type,
           COUNT(*)::int AS cancel_count,
           COUNT(DISTINCT jq.package_id)::int AS pkg_count
    FROM public.job_queue jq
    WHERE jq.status='cancelled'
      AND jq.created_at > now() - make_interval(mins => p_window_minutes)
    GROUP BY jq.job_type
    HAVING COUNT(*) >= p_cancel_threshold
  LOOP
    -- Skip if already quarantined (active)
    IF EXISTS (
      SELECT 1 FROM public.job_type_quarantine
      WHERE job_type = r.job_type AND cleared_at IS NULL AND blocked_until > now()
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.job_type_quarantine (
      job_type, cancel_count, window_minutes, blocked_until, reason, metadata
    ) VALUES (
      r.job_type, r.cancel_count, p_window_minutes,
      now() + make_interval(mins => p_block_minutes),
      format('hot_cancel_loop:%s_cancels_in_%smin_across_%s_pkgs',
             r.cancel_count, p_window_minutes, r.pkg_count),
      jsonb_build_object('source','fn_auto_quarantine_hot_cancel_loops',
                         'cancel_count', r.cancel_count,
                         'pkg_count', r.pkg_count,
                         'threshold', p_cancel_threshold)
    )
    ON CONFLICT (job_type) WHERE cleared_at IS NULL DO NOTHING;

    v_quarantined := v_quarantined + 1;
    v_results := v_results || jsonb_build_object(
      'job_type', r.job_type, 'cancels', r.cancel_count, 'pkgs', r.pkg_count);

    -- Audit
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                     result_status, result_detail, metadata)
    VALUES ('job_type_auto_quarantine', 'fn_auto_quarantine_hot_cancel_loops',
            'job_type', r.job_type, 'quarantined',
            format('Job-Type %s quarantined for %s min', r.job_type, p_block_minutes),
            jsonb_build_object('cancels', r.cancel_count, 'pkgs', r.pkg_count,
                               'window_min', p_window_minutes, 'block_min', p_block_minutes));
  END LOOP;

  RETURN jsonb_build_object('ok', true,
    'quarantined', v_quarantined, 'skipped_existing', v_skipped,
    'window_min', p_window_minutes, 'threshold', p_cancel_threshold,
    'results', v_results);
END;
$$;

-- 3) ENQUEUE_SOURCE HARD GATE in enqueue_job_if_absent -------
-- We patch the primary overload (6 params, returns id/created/duplicate/status).
-- Adds: blocked if no enqueue_source tag + blocked if job_type quarantined.
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid DEFAULT NULL::uuid,
  p_priority integer DEFAULT 0,
  p_max_attempts integer DEFAULT 25,
  p_run_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(id uuid, created boolean, duplicate boolean, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_step_key text; v_existing record; v_new_id uuid;
  v_recent_completed_count int; v_step_status text; v_mapped_step text;
  v_active_count int; v_is_incremental_dispatcher boolean;
  v_fanout_cap int; v_zero_progress_threshold int;
  v_pkg_status text;
  v_enqueue_source text;
  v_enforce_source_at timestamptz := '2026-05-09 00:00:00+00'::timestamptz;
  v_qtype record;
begin
  v_step_key := coalesce(p_payload->>'step_key', p_payload->>'step', p_payload->>'target_step', '');
  v_enqueue_source := coalesce(p_payload->>'enqueue_source','');

  -- ── NEU: enqueue_source Hard Gate ──
  -- Phase 1 (warn-only): log ohne block. Hard-block ab v_enforce_source_at.
  IF v_enqueue_source = '' THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                     result_status, result_detail, metadata)
    VALUES (
      CASE WHEN now() >= v_enforce_source_at THEN 'enqueue_source_missing_blocked'
           ELSE 'enqueue_source_missing_warn' END,
      'enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),
      CASE WHEN now() >= v_enforce_source_at THEN 'rejected' ELSE 'warn' END,
      'Missing enqueue_source tag in payload for '||p_job_type,
      jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',v_step_key,
                         'phase', CASE WHEN now() >= v_enforce_source_at THEN 'enforce' ELSE 'warn' END));
    IF now() >= v_enforce_source_at THEN
      RETURN QUERY SELECT NULL::uuid, false, false, 'enqueue_source_missing'::text;
      RETURN;
    END IF;
  END IF;

  -- ── NEU: Job-Type Quarantine Check ──
  SELECT * INTO v_qtype FROM public.job_type_quarantine
   WHERE job_type = p_job_type AND cleared_at IS NULL AND blocked_until > now()
   LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                     result_status, result_detail, metadata)
    VALUES ('enqueue_blocked_job_type_quarantined','enqueue_job_if_absent','job',
            COALESCE(p_package_id::text,'null'),'rejected',
            format('Job-Type %s quarantined until %s', p_job_type, v_qtype.blocked_until),
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,
                               'enqueue_source',v_enqueue_source,
                               'blocked_until',v_qtype.blocked_until,
                               'reason',v_qtype.reason));
    RETURN QUERY SELECT NULL::uuid, false, false, 'job_type_quarantined'::text;
    RETURN;
  END IF;

  -- ── Phantom Pre-Enqueue Guard ──
  IF public.fn_step_already_terminal(p_job_type, p_package_id) THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_phantom_blocked','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Step already done/skipped for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',replace(p_job_type,'package_','')));
    RETURN QUERY SELECT NULL::uuid, false, false, 'phantom_blocked'::text; RETURN;
  END IF;

  -- ── P0a Guard ──
  IF p_package_id IS NOT NULL AND public.fn_job_type_requires_building(p_job_type) THEN
    SELECT cp.status INTO v_pkg_status FROM public.course_packages cp WHERE cp.id = p_package_id;
    IF v_pkg_status IS NULL OR v_pkg_status <> 'building' THEN
      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_non_building_block','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Package not in building status for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'pkg_status',v_pkg_status));
      RETURN QUERY SELECT NULL::uuid, false, false, 'non_building_blocked'::text; RETURN;
    END IF;
  END IF;

  v_is_incremental_dispatcher := p_job_type IN (
    'package_generate_learning_content','package_finalize_learning_content',
    'package_generate_handbook','package_generate_lesson_minichecks',
    'package_enqueue_handbook_expand','package_fanout_learning_content'
  );
  v_fanout_cap := CASE WHEN v_is_incremental_dispatcher THEN 5 ELSE 3 END;
  v_zero_progress_threshold := CASE WHEN v_is_incremental_dispatcher THEN 8 ELSE 3 END;

  SELECT jq.id, jq.status INTO v_existing FROM public.job_queue jq
  WHERE jq.job_type = p_job_type
    AND coalesce(jq.package_id::text,'') = coalesce(p_package_id::text,'')
    AND coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    AND jq.status in ('pending','queued','processing','running','batch_pending')
  ORDER BY jq.created_at DESC LIMIT 1;
  IF found THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_dedupe','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Duplicate active job for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',v_step_key,'existing_id',v_existing.id,'existing_status',v_existing.status,'enqueue_source',v_enqueue_source));
    RETURN QUERY SELECT v_existing.id, false, true, 'duplicate_active'::text; RETURN;
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT count(*) INTO v_active_count FROM public.job_queue jq
    WHERE jq.job_type = p_job_type AND jq.package_id = p_package_id
      AND jq.status in ('pending','queued','processing','running','batch_pending');
    IF v_active_count >= v_fanout_cap THEN
      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_fanout_cap','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Fanout cap reached for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'active_count',v_active_count,'cap',v_fanout_cap,'enqueue_source',v_enqueue_source));
      RETURN QUERY SELECT NULL::uuid, false, false, 'fanout_capped'::text; RETURN;
    END IF;
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT count(*) INTO v_recent_completed_count FROM public.job_queue jq
    WHERE jq.job_type = p_job_type AND jq.package_id = p_package_id
      AND jq.status='completed' AND jq.updated_at > now() - interval '2 hours';
    IF v_recent_completed_count >= v_zero_progress_threshold THEN
      v_mapped_step := regexp_replace(p_job_type, '^package_', '');
      SELECT ps.status::text INTO v_step_status FROM public.package_steps ps
      WHERE ps.package_id = p_package_id AND ps.step_key = v_mapped_step LIMIT 1;
      IF v_step_status IS NOT NULL AND v_step_status NOT IN ('done','skipped') THEN
        INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('enqueue_zero_progress','enqueue_job_if_absent','job',p_package_id::text,'rejected',
                'Zero-progress block for '||p_job_type,
                jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'completed_2h',v_recent_completed_count,'threshold',v_zero_progress_threshold,'step_status',v_step_status,'enqueue_source',v_enqueue_source));
        RETURN QUERY SELECT NULL::uuid, false, false, 'zero_progress_blocked'::text; RETURN;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at)
  VALUES (p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after, p_payload, p_payload, now(), now())
  RETURNING job_queue.id INTO v_new_id;
  RETURN QUERY SELECT v_new_id, true, false, 'pending'::text;
END;
$function$;

-- 4) DAG-AWARE CRON DRIFT-GUARD WRAPPER ----------------------
-- Single entry point that all */15 enqueueing crons must call FIRST.
-- It performs eligibility + DAG-liveness checks per (package_id, job_type)
-- and returns a verdict. Enqueuers must respect the verdict.
CREATE OR REPLACE FUNCTION public.fn_cron_enqueue_drift_guard(
  p_package_id uuid,
  p_job_type text,
  p_caller text DEFAULT 'cron'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_step_key text;
  v_step_status text;
  v_pkg_status text;
  v_cancel_loop_count int;
  v_active_count int;
  v_pred_ok boolean := true;
  v_qtype record;
  v_predmap jsonb := jsonb_build_object(
    'auto_seed_exam_blueprints', jsonb_build_array('scaffold_learning_course'),
    'validate_blueprints', jsonb_build_array('auto_seed_exam_blueprints'),
    'generate_blueprint_variants', jsonb_build_array('validate_blueprints'),
    'validate_blueprint_variants', jsonb_build_array('generate_blueprint_variants'),
    'promote_blueprint_variants', jsonb_build_array('validate_blueprint_variants'),
    'generate_exam_pool', jsonb_build_array('validate_blueprints'),
    'validate_exam_pool', jsonb_build_array('generate_exam_pool'),
    'repair_exam_pool_quality', jsonb_build_array('validate_exam_pool'),
    'build_ai_tutor_index', jsonb_build_array('finalize_learning_content'),
    'validate_tutor_index', jsonb_build_array('build_ai_tutor_index'),
    'generate_oral_exam', jsonb_build_array('validate_exam_pool'),
    'validate_oral_exam', jsonb_build_array('generate_oral_exam'),
    'generate_lesson_minichecks', jsonb_build_array('finalize_learning_content'),
    'validate_lesson_minichecks', jsonb_build_array('generate_lesson_minichecks'),
    'generate_handbook', jsonb_build_array('finalize_learning_content'),
    'validate_handbook', jsonb_build_array('generate_handbook'),
    'enqueue_handbook_expand', jsonb_build_array('validate_handbook'),
    'expand_handbook', jsonb_build_array('enqueue_handbook_expand'),
    'validate_handbook_depth', jsonb_build_array('expand_handbook'),
    'elite_harden', jsonb_build_array('validate_exam_pool'),
    'run_integrity_check', jsonb_build_array('elite_harden'),
    'quality_council', jsonb_build_array('run_integrity_check'),
    'auto_publish', jsonb_build_array('quality_council')
  );
BEGIN
  v_step_key := regexp_replace(p_job_type, '^package_', '');

  -- 1) Job-Type quarantined?
  SELECT * INTO v_qtype FROM public.job_type_quarantine
   WHERE job_type=p_job_type AND cleared_at IS NULL AND blocked_until > now() LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('allow', false, 'reason','JOB_TYPE_QUARANTINED',
                              'blocked_until', v_qtype.blocked_until);
  END IF;

  -- 2) Package status must be building
  SELECT status INTO v_pkg_status FROM public.course_packages WHERE id = p_package_id;
  IF v_pkg_status IS NULL OR v_pkg_status <> 'building' THEN
    RETURN jsonb_build_object('allow', false, 'reason','PKG_NOT_BUILDING','pkg_status', v_pkg_status);
  END IF;

  -- 3) Step exists and is queued
  SELECT ps.status::text INTO v_step_status FROM public.package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key::text = v_step_key LIMIT 1;
  IF v_step_status IS NULL THEN
    RETURN jsonb_build_object('allow', false, 'reason','STEP_NOT_FOUND','step_key', v_step_key);
  END IF;
  IF v_step_status IN ('done','skipped','completed') THEN
    RETURN jsonb_build_object('allow', false, 'reason','STEP_TERMINAL','step_status', v_step_status);
  END IF;

  -- 4) DAG predecessors satisfied
  IF v_predmap ? v_step_key THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_predmap->v_step_key) AS pred(key)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.package_steps ps2
        WHERE ps2.package_id = p_package_id
          AND ps2.step_key::text = pred.key
          AND ps2.status IN ('done','skipped','completed')
      )
    ) INTO v_pred_ok;
    IF NOT v_pred_ok THEN
      RETURN jsonb_build_object('allow', false, 'reason','PREDECESSORS_NOT_DONE','step_key', v_step_key);
    END IF;
  END IF;

  -- 5) No active job already
  SELECT count(*) INTO v_active_count FROM public.job_queue
   WHERE package_id = p_package_id AND job_type = p_job_type
     AND status IN ('pending','queued','processing','running','batch_pending');
  IF v_active_count > 0 THEN
    RETURN jsonb_build_object('allow', false, 'reason','ACTIVE_JOB_EXISTS','active', v_active_count);
  END IF;

  -- 6) Cancel-cooldown: ≥3 cancels in last hour
  SELECT count(*) INTO v_cancel_loop_count FROM public.job_queue
   WHERE package_id = p_package_id AND job_type = p_job_type
     AND status='cancelled' AND created_at > now() - interval '1 hour';
  IF v_cancel_loop_count >= 3 THEN
    RETURN jsonb_build_object('allow', false, 'reason','CANCEL_COOLDOWN_ACTIVE',
                              'cancels_1h', v_cancel_loop_count);
  END IF;

  RETURN jsonb_build_object('allow', true, 'reason','OK','caller', p_caller);
END;
$$;

-- 5) ADMIN CLEAR FUNCTION ------------------------------------
CREATE OR REPLACE FUNCTION public.admin_clear_job_type_quarantine(p_job_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_count int;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;
  UPDATE public.job_type_quarantine
     SET cleared_at = now(), cleared_by = v_uid
   WHERE job_type = p_job_type AND cleared_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                   result_status, result_detail, metadata)
  VALUES ('job_type_quarantine_cleared','admin_clear_job_type_quarantine',
          'job_type', p_job_type, 'cleared',
          format('Cleared %s active quarantines for %s', v_count, p_job_type),
          jsonb_build_object('cleared_by', v_uid, 'count', v_count));

  RETURN jsonb_build_object('ok', true, 'cleared_count', v_count, 'job_type', p_job_type);
END;
$$;

-- 6) READ-VIEW for cockpit -----------------------------------
CREATE OR REPLACE VIEW public.v_job_type_quarantine_active AS
SELECT q.job_type, q.cancel_count, q.window_minutes, q.blocked_until, q.reason,
       q.metadata, q.created_at,
       GREATEST(0, EXTRACT(epoch FROM (q.blocked_until - now()))/60.0)::int AS minutes_remaining
  FROM public.job_type_quarantine q
 WHERE q.cleared_at IS NULL AND q.blocked_until > now()
 ORDER BY q.blocked_until DESC;

REVOKE ALL ON public.v_job_type_quarantine_active FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_job_type_quarantine_active TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_job_type_quarantine_active()
RETURNS SETOF public.v_job_type_quarantine_active
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.v_job_type_quarantine_active
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;
