
-- ============================================================
-- 1) FIX: admin_get_dag_blocked_drilldown — proper LIMIT/ORDER on log
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_dag_blocked_drilldown(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public STABLE AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_log jsonb;
  v_parent jsonb;
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT *
    INTO v_row
    FROM public.v_dag_blocked_jobs
   WHERE job_id = p_job_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'created_at') DESC), '[]'::jsonb)
    INTO v_log
    FROM (
      SELECT jsonb_build_object(
        'created_at',   created_at,
        'action_type',  action_type,
        'result_status',result_status,
        'metadata',     metadata
      ) AS x
      FROM public.auto_heal_log
      WHERE target_id = v_row.package_id::text
        AND created_at > now() - interval '7 days'
      ORDER BY created_at DESC
      LIMIT 20
    ) s;

  v_parent := jsonb_build_object(
    'parent_step_key',    v_row.parent_step_key,
    'parent_step_status', v_row.parent_step_status,
    'parent_active_jobs', v_row.parent_active_jobs,
    'parent_last_error',  v_row.parent_last_error,
    'parent_updated_at',  v_row.parent_updated_at
  );

  RETURN jsonb_build_object(
    'job_id',          v_row.job_id,
    'job_type',        v_row.job_type,
    'package_id',      v_row.package_id,
    'package_title',   v_row.package_title,
    'step_key',        v_row.step_key,
    'job_status',      v_row.job_status,
    'last_error',      v_row.last_error,
    'attempts',        v_row.attempts,
    'block_reason',    v_row.block_reason,
    'minutes_blocked', v_row.minutes_blocked,
    'bronze_locked',   v_row.bronze_locked,
    'parent',          v_parent,
    'recent_heal_log', v_log
  );
END $$;
GRANT EXECUTE ON FUNCTION public.admin_get_dag_blocked_drilldown(uuid) TO authenticated;

-- ============================================================
-- 2) Configurable Re-Enqueue Rules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dag_reenqueue_rules (
  step_key                text PRIMARY KEY,
  enabled                 boolean NOT NULL DEFAULT true,
  allow_bronze_override   boolean NOT NULL DEFAULT false,
  stagnation_threshold_min int NOT NULL DEFAULT 30,
  max_attempts            int NOT NULL DEFAULT 1,
  notes                   text,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid
);
ALTER TABLE public.dag_reenqueue_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dag_reenqueue_rules_admin_select ON public.dag_reenqueue_rules;
CREATE POLICY dag_reenqueue_rules_admin_select ON public.dag_reenqueue_rules
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

-- Seed safe defaults (only safe, idempotent repair/integrity/council steps)
INSERT INTO public.dag_reenqueue_rules (step_key, enabled, allow_bronze_override, stagnation_threshold_min, max_attempts, notes) VALUES
  ('quality_council',         true, true,  20, 1, 'Council failed/timed out — bronze override allowed'),
  ('run_integrity_check',     true, true,  20, 2, 'Integrity tail-step retry'),
  ('validate_tutor_index',    true, true,  30, 1, 'Tutor index validation retry'),
  ('validate_exam_pool',      true, true,  30, 1, 'Exam pool validation retry'),
  ('auto_publish',            true, false, 45, 1, 'Publish — never bronze-override (guarded)'),
  ('repair_exam_pool_quality',true, true,  40, 1, 'Quality repair retry')
ON CONFLICT (step_key) DO NOTHING;

-- ============================================================
-- 3) HARDEN admin_manual_reenqueue_step — whitelist via registry
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_manual_reenqueue_step(
  p_package_id uuid,
  p_step_key   text,
  p_reason     text DEFAULT 'manual_dashboard_reenqueue'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_curr      uuid;
  v_id        uuid;
  v_job_type  text;
  v_rule      record;
  v_allow_bronze boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_step_key IS NULL OR p_step_key !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'invalid_step_key:%', p_step_key;
  END IF;

  -- Resolve canonical job_type via registry (allowlist gate)
  SELECT job_type
    INTO v_job_type
    FROM public.ops_job_type_registry
   WHERE job_type = p_step_key
      OR job_type = 'package_'||p_step_key
   ORDER BY (job_type = 'package_'||p_step_key) DESC
   LIMIT 1;

  IF v_job_type IS NULL THEN
    -- Fallback: must be a known DAG step
    IF NOT EXISTS (
      SELECT 1 FROM public.step_dag_edges
      WHERE child_step_key = p_step_key OR parent_step_key = p_step_key
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'unknown_step_key:%', p_step_key;
    END IF;
    v_job_type := 'package_'||p_step_key;
  END IF;

  SELECT curriculum_id INTO v_curr FROM public.course_packages WHERE id = p_package_id;
  IF v_curr IS NULL THEN RAISE EXCEPTION 'package_not_found'; END IF;

  -- Bronze override only if rule explicitly allows it for this step_key
  SELECT * INTO v_rule
    FROM public.dag_reenqueue_rules
   WHERE step_key = p_step_key AND enabled = true;
  v_allow_bronze := COALESCE(v_rule.allow_bronze_override, false);

  PERFORM set_config('app.transition_source','admin_manual_reenqueue:'||v_uid::text, true);

  INSERT INTO public.job_queue
    (job_type, package_id, status, run_after, payload, meta, enqueue_source)
  VALUES (
    v_job_type, p_package_id, 'pending', now(),
    jsonb_build_object(
      'package_id', p_package_id,
      'curriculum_id', v_curr,
      'bronze_lock_override', v_allow_bronze,
      'enqueue_source', p_reason
    ),
    jsonb_build_object(
      'enqueue_source', p_reason,
      'manual_admin', v_uid,
      'rule_allowed_bronze', v_allow_bronze
    ),
    p_reason
  ) RETURNING id INTO v_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('manual_reenqueue_step','package', p_package_id::text, 'success',
          jsonb_build_object(
            'step_key', p_step_key,
            'job_type', v_job_type,
            'job_id', v_id,
            'admin', v_uid,
            'reason', p_reason,
            'bronze_override', v_allow_bronze
          ));

  RETURN jsonb_build_object('ok', true, 'job_id', v_id, 'step_key', p_step_key,
                            'job_type', v_job_type, 'bronze_override', v_allow_bronze);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_manual_reenqueue_step(uuid,text,text) TO authenticated;

-- ============================================================
-- 4) Suggestion RPC — uses rules to recommend re-enqueues
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_reenqueue_suggestions()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public STABLE AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  RETURN jsonb_build_object(
    'rules', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.step_key)
      FROM public.dag_reenqueue_rules r
    ), '[]'::jsonb),
    'suggestions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'package_id',     b.package_id,
        'package_title',  b.package_title,
        'step_key',       b.step_key,
        'job_id',         b.job_id,
        'minutes_blocked',b.minutes_blocked,
        'block_reason',   b.block_reason,
        'rule_step',      r.step_key,
        'allow_bronze_override', r.allow_bronze_override,
        'threshold_min',  r.stagnation_threshold_min
      ))
      FROM public.v_dag_blocked_jobs b
      JOIN public.dag_reenqueue_rules r
        ON r.step_key = b.step_key AND r.enabled = true
      WHERE b.minutes_blocked >= r.stagnation_threshold_min
    ), '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.admin_get_reenqueue_suggestions() TO authenticated;

-- ============================================================
-- 5) Admin upsert for rules (whitelist editing)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_reenqueue_rule(
  p_step_key text,
  p_enabled  boolean,
  p_allow_bronze boolean,
  p_threshold_min int,
  p_max_attempts int DEFAULT 1,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_step_key IS NULL OR p_step_key !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'invalid_step_key';
  END IF;
  IF p_threshold_min IS NULL OR p_threshold_min < 1 OR p_threshold_min > 1440 THEN
    RAISE EXCEPTION 'invalid_threshold';
  END IF;

  INSERT INTO public.dag_reenqueue_rules
    (step_key, enabled, allow_bronze_override, stagnation_threshold_min, max_attempts, notes, updated_at, updated_by)
  VALUES (p_step_key, p_enabled, p_allow_bronze, p_threshold_min, COALESCE(p_max_attempts,1), p_notes, now(), v_uid)
  ON CONFLICT (step_key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        allow_bronze_override = EXCLUDED.allow_bronze_override,
        stagnation_threshold_min = EXCLUDED.stagnation_threshold_min,
        max_attempts = EXCLUDED.max_attempts,
        notes = COALESCE(EXCLUDED.notes, public.dag_reenqueue_rules.notes),
        updated_at = now(),
        updated_by = v_uid;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('reenqueue_rule_upsert','config', p_step_key, 'success',
          jsonb_build_object('enabled',p_enabled,'allow_bronze',p_allow_bronze,
                             'threshold_min',p_threshold_min,'admin',v_uid));

  RETURN jsonb_build_object('ok', true, 'step_key', p_step_key);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_upsert_reenqueue_rule(text,boolean,boolean,int,int,text) TO authenticated;
