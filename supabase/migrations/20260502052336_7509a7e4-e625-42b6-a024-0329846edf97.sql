-- ============================================================
-- 1. Multi-Layer Heal-Audit Tabelle
-- ============================================================
CREATE TABLE IF NOT EXISTS public.heal_audit_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  package_id uuid NOT NULL,
  heal_event_id uuid,
  trigger_source text NOT NULL,
  action_type text NOT NULL,
  -- 5 Ebenen
  symptom_before jsonb,
  symptom_after jsonb,
  step_layer_before jsonb,
  step_layer_after jsonb,
  dag_layer_before jsonb,
  dag_layer_after jsonb,
  gate_layer_before jsonb,
  gate_layer_after jsonb,
  artifact_layer_before jsonb,
  artifact_layer_after jsonb,
  result_status text NOT NULL DEFAULT 'success',
  notes text
);
CREATE INDEX IF NOT EXISTS idx_heal_audit_layers_pkg_created ON public.heal_audit_layers (package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heal_audit_layers_action ON public.heal_audit_layers (action_type, created_at DESC);
ALTER TABLE public.heal_audit_layers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "heal_audit_layers admin read" ON public.heal_audit_layers;
CREATE POLICY "heal_audit_layers admin read" ON public.heal_audit_layers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

-- ============================================================
-- 2. Package Quarantine Tabelle
-- ============================================================
CREATE TABLE IF NOT EXISTS public.package_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL UNIQUE,
  reason_code text NOT NULL,
  reason_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by text
);
CREATE INDEX IF NOT EXISTS idx_pkg_quarantine_active ON public.package_quarantine (package_id) WHERE released_at IS NULL;
ALTER TABLE public.package_quarantine ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "package_quarantine admin read" ON public.package_quarantine;
CREATE POLICY "package_quarantine admin read" ON public.package_quarantine FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

-- ============================================================
-- 3. Helper: Snapshot Layers
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_snapshot_package_layers(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'symptom', jsonb_build_object(
      'pkg_status', cp.status, 'gate_class', cp.gate_class,
      'failed_jobs_total', (SELECT COUNT(*) FROM job_queue jq WHERE jq.package_id=p_package_id AND jq.status='failed'),
      'active_jobs', (SELECT COUNT(*) FROM job_queue jq WHERE jq.package_id=p_package_id AND jq.status IN ('pending','processing'))
    ),
    'step_layer', (SELECT jsonb_agg(jsonb_build_object('step_key',ps.step_key,'status',ps.status::text,'attempts',ps.attempts) ORDER BY ps.step_key)
                   FROM package_steps ps WHERE ps.package_id=p_package_id),
    'dag_layer', (SELECT jsonb_agg(DISTINCT jsonb_build_object('job_type',jq.job_type,'status',jq.status,'count',1))
                  FROM job_queue jq WHERE jq.package_id=p_package_id AND jq.status IN ('pending','processing','failed')),
    'gate_layer', jsonb_build_object('gate_class', cp.gate_class, 'in_quarantine', EXISTS(SELECT 1 FROM package_quarantine q WHERE q.package_id=p_package_id AND q.released_at IS NULL)),
    'artifact_layer', jsonb_build_object(
      'approved_questions', (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=p_package_id AND eq.status='approved'),
      'total_questions', (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=p_package_id)
    )
  ) INTO v
  FROM course_packages cp WHERE cp.id=p_package_id;
  RETURN v;
END $$;

-- ============================================================
-- 4. Drift-Detector v4: Obsolete Failed Tail Jobs
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_detect_obsolete_failed_tail_jobs(
  p_dry_run boolean DEFAULT false,
  p_debug boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_cancelled int := 0;
  v_pkg_count int := 0;
  v_debug_data jsonb := '[]'::jsonb;
  v_tail_steps text[] := ARRAY['run_integrity_check','quality_council','auto_publish','repair_exam_pool_quality','elite_harden','build_ai_tutor_index','validate_tutor_index','promote_blueprint_variants'];
  v_obsolete_job_types text[] := ARRAY['package_run_integrity_check','package_quality_council','package_generate_exam_pool','package_validate_exam_pool','package_repair_exam_pool_quality'];
  r record;
  v_before jsonb;
  v_after jsonb;
  v_cancelled_in_pkg int;
BEGIN
  FOR r IN
    SELECT DISTINCT ps.package_id
    FROM package_steps ps
    WHERE ps.step_key = ANY(v_tail_steps)
      AND ps.status::text IN ('queued','pending_enqueue')
      AND ps.updated_at < now() - interval '10 minutes'
      AND EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.status = 'failed'
          AND jq.job_type = ANY(v_obsolete_job_types)
          AND jq.updated_at < now() - interval '30 minutes'
      )
      AND (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=ps.package_id AND eq.status='approved') >= 50
      AND NOT EXISTS (SELECT 1 FROM package_quarantine pq WHERE pq.package_id=ps.package_id AND pq.released_at IS NULL)
  LOOP
    v_before := fn_snapshot_package_layers(r.package_id);

    IF NOT p_dry_run THEN
      UPDATE job_queue SET status='cancelled',
        last_error = COALESCE(last_error,'') || ' | OBSOLETE_TAIL_BLOCK_v4: cancelled by drift-detector',
        updated_at = now()
      WHERE package_id = r.package_id
        AND status = 'failed'
        AND job_type = ANY(v_obsolete_job_types)
        AND updated_at < now() - interval '30 minutes';
      GET DIAGNOSTICS v_cancelled_in_pkg = ROW_COUNT;
      v_cancelled := v_cancelled + v_cancelled_in_pkg;

      -- Nudge tail steps: clear debounce + reset to queued
      UPDATE package_steps SET
        meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at',
        updated_at = now()
      WHERE package_id = r.package_id
        AND step_key = ANY(v_tail_steps)
        AND status::text IN ('queued','pending_enqueue');
    END IF;

    v_after := fn_snapshot_package_layers(r.package_id);
    v_pkg_count := v_pkg_count + 1;

    INSERT INTO heal_audit_layers (
      package_id, trigger_source, action_type,
      symptom_before, symptom_after,
      step_layer_before, step_layer_after,
      dag_layer_before, dag_layer_after,
      gate_layer_before, gate_layer_after,
      artifact_layer_before, artifact_layer_after,
      result_status, notes
    ) VALUES (
      r.package_id, 'fn_detect_obsolete_failed_tail_jobs', 'obsolete_failed_tail_cleanup_v4',
      v_before->'symptom', v_after->'symptom',
      v_before->'step_layer', v_after->'step_layer',
      v_before->'dag_layer', v_after->'dag_layer',
      v_before->'gate_layer', v_after->'gate_layer',
      v_before->'artifact_layer', v_after->'artifact_layer',
      CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
      format('Cancelled %s obsolete failed jobs blocking tail phase', COALESCE(v_cancelled_in_pkg,0))
    );

    IF p_debug THEN
      v_debug_data := v_debug_data || jsonb_build_object(
        'package_id', r.package_id,
        'predecessors_done', (SELECT jsonb_agg(ps.step_key) FROM package_steps ps WHERE ps.package_id=r.package_id AND ps.status::text IN ('done','skipped')),
        'tail_blocked', (SELECT jsonb_agg(jsonb_build_object('step',ps.step_key,'age_min', extract(epoch from now()-ps.updated_at)/60)) FROM package_steps ps WHERE ps.package_id=r.package_id AND ps.step_key=ANY(v_tail_steps) AND ps.status::text IN ('queued','pending_enqueue')),
        'matched_features', jsonb_build_object('approved_q_ge_50', true, 'failed_age_gt_30min', true, 'tail_age_gt_10min', true)
      );
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('obsolete_failed_tail_cleanup_v4', 'system', NULL,
          CASE WHEN v_pkg_count=0 THEN 'noop' ELSE 'success' END,
          format('packages=%s, jobs_cancelled=%s, dry_run=%s', v_pkg_count, v_cancelled, p_dry_run),
          jsonb_build_object('packages', v_pkg_count, 'jobs_cancelled', v_cancelled, 'dry_run', p_dry_run, 'debug', v_debug_data));

  RETURN jsonb_build_object('packages', v_pkg_count, 'jobs_cancelled', v_cancelled, 'dry_run', p_dry_run, 'debug', v_debug_data);
END $$;

-- ============================================================
-- 5. Gate-Class Quarantäne Detector
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_quarantine_terminal_gate_conflicts(p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r record;
  v_count int := 0;
  v_before jsonb;
  v_after jsonb;
BEGIN
  FOR r IN
    SELECT cp.id, cp.title, cp.gate_class, cp.status,
      (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') AS approved_q
    FROM course_packages cp
    WHERE cp.gate_class = 'terminal'
      AND cp.status NOT IN ('published','archived')
      AND NOT EXISTS (SELECT 1 FROM package_quarantine q WHERE q.package_id=cp.id AND q.released_at IS NULL)
  LOOP
    IF r.approved_q >= 50 THEN
      v_before := fn_snapshot_package_layers(r.id);
      IF NOT p_dry_run THEN
        INSERT INTO package_quarantine (package_id, reason_code, reason_detail)
        VALUES (r.id, 'TERMINAL_GATE_CONFLICT',
                jsonb_build_object('gate_class', r.gate_class, 'status', r.status, 'approved_q', r.approved_q,
                                   'detail', 'gate_class=terminal but package has approved questions and is not published — manual review required'))
        ON CONFLICT (package_id) DO NOTHING;
      END IF;
      v_after := fn_snapshot_package_layers(r.id);
      v_count := v_count + 1;
      INSERT INTO heal_audit_layers (package_id, trigger_source, action_type,
        symptom_before, symptom_after, gate_layer_before, gate_layer_after,
        artifact_layer_before, artifact_layer_after, result_status, notes)
      VALUES (r.id, 'fn_quarantine_terminal_gate_conflicts', 'gate_conflict_quarantine',
        v_before->'symptom', v_after->'symptom',
        v_before->'gate_layer', v_after->'gate_layer',
        v_before->'artifact_layer', v_after->'artifact_layer',
        CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
        format('Quarantined: gate_class=terminal + status=%s + approved_q=%s', r.status, r.approved_q));
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('gate_conflict_quarantine', 'system',
          CASE WHEN v_count=0 THEN 'noop' ELSE 'success' END,
          format('quarantined=%s', v_count),
          jsonb_build_object('quarantined', v_count, 'dry_run', p_dry_run));

  RETURN jsonb_build_object('quarantined', v_count, 'dry_run', p_dry_run);
END $$;

-- ============================================================
-- 6. Live Pipeline View
-- ============================================================
CREATE OR REPLACE VIEW public.v_package_pipeline_live AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status AS pkg_status,
  cp.gate_class,
  EXISTS(SELECT 1 FROM package_quarantine q WHERE q.package_id=cp.id AND q.released_at IS NULL) AS in_quarantine,
  (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') AS approved_questions,
  (SELECT jsonb_agg(jsonb_build_object('step_key',ps.step_key,'status',ps.status::text,'attempts',ps.attempts,'last_error',ps.last_error,'updated_at',ps.updated_at) ORDER BY ps.updated_at DESC)
   FROM package_steps ps WHERE ps.package_id=cp.id) AS steps,
  (SELECT jsonb_agg(jsonb_build_object('job_type',jq.job_type,'status',jq.status,'attempts',jq.attempts,'last_error',jq.last_error,'updated_at',jq.updated_at))
   FROM job_queue jq WHERE jq.package_id=cp.id AND jq.status IN ('pending','processing','failed') AND jq.updated_at > now() - interval '24 hours') AS active_jobs,
  (SELECT COUNT(*) FROM job_queue jq WHERE jq.package_id=cp.id AND jq.status='failed') AS failed_jobs_total,
  (SELECT MAX(jq.updated_at) FROM job_queue jq WHERE jq.package_id=cp.id) AS last_job_activity
FROM course_packages cp;

REVOKE ALL ON public.v_package_pipeline_live FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_package_pipeline_live TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_package_pipeline_live(p_package_id uuid DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS SETOF public.v_package_pipeline_live LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT * FROM public.v_package_pipeline_live
    WHERE (p_package_id IS NULL OR package_id = p_package_id)
    ORDER BY last_job_activity DESC NULLS LAST
    LIMIT p_limit;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_heal_audit_layers(p_package_id uuid DEFAULT NULL, p_limit int DEFAULT 100)
RETURNS SETOF public.heal_audit_layers LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.heal_audit_layers
    WHERE (p_package_id IS NULL OR package_id = p_package_id)
    ORDER BY created_at DESC LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_package_pipeline_live(uuid,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_audit_layers(uuid,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_obsolete_failed_tail_jobs(boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_quarantine_terminal_gate_conflicts(boolean) TO service_role;