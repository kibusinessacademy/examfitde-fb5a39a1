-- 1. Central job_type_policies table
CREATE TABLE IF NOT EXISTS public.job_type_policies (
  job_type text PRIMARY KEY,
  is_repair boolean NOT NULL DEFAULT false,
  can_run_when_not_building boolean NOT NULL DEFAULT false,
  exempt_from_auto_cancel boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_type_policies ENABLE ROW LEVEL SECURITY;

-- Seed all known job types
INSERT INTO public.job_type_policies (job_type, is_repair, can_run_when_not_building, exempt_from_auto_cancel, notes)
VALUES
  ('blueprint_generate_variants', false, false, false, NULL),
  ('generate_curriculum_content', false, false, false, NULL),
  ('handbook_expand_section', false, false, false, NULL),
  ('lesson_generate_competency_bundle', false, false, false, NULL),
  ('lesson_generate_content', false, false, false, NULL),
  ('lesson_generate_content_shard', false, false, false, NULL),
  ('package_auto_publish', false, false, false, NULL),
  ('package_auto_seed_exam_blueprints', false, false, false, NULL),
  ('package_build_ai_tutor_index', false, false, false, NULL),
  ('package_elite_harden', false, false, false, NULL),
  ('package_enqueue_handbook_expand', false, false, false, NULL),
  ('package_exam_rebalance', true, true, true, 'Repair: exam pool rebalancing'),
  ('package_fanout_learning_content', false, false, false, NULL),
  ('package_finalize_learning_content', false, false, false, NULL),
  ('package_generate_blueprint_variants', false, false, false, NULL),
  ('package_generate_exam_pool', false, false, false, NULL),
  ('package_generate_glossary', false, false, false, NULL),
  ('package_generate_handbook', false, false, false, NULL),
  ('package_generate_learning_content', false, false, false, NULL),
  ('package_generate_lesson_minichecks', false, false, false, NULL),
  ('package_generate_oral_exam', false, false, false, NULL),
  ('package_promote_blueprint_variants', false, false, false, NULL),
  ('package_quality_council', false, false, true, 'Can run post-build, exempt from auto-cancel'),
  ('package_repair_exam_pool_quality', true, true, true, 'Repair: exam pool quality'),
  ('package_repair_minichecks', true, true, true, 'Repair: minicheck fixes'),
  ('package_run_integrity_check', false, false, true, 'Integrity checks exempt from auto-cancel'),
  ('package_scaffold_learning_course', false, false, false, NULL),
  ('package_validate_blueprint_variants', false, false, false, NULL),
  ('package_validate_blueprints', false, false, false, NULL),
  ('package_validate_exam_pool', false, false, true, 'Validation exempt from auto-cancel'),
  ('package_validate_handbook', false, false, false, NULL),
  ('package_validate_handbook_depth', false, false, false, NULL),
  ('package_validate_learning_content', false, false, false, NULL),
  ('package_validate_lesson_minichecks', false, false, false, NULL),
  ('package_validate_oral_exam', false, false, false, NULL),
  ('package_validate_tutor_index', false, false, false, NULL),
  ('pool_fill_bloom_gaps', true, true, true, 'Repair: bloom gap filling'),
  ('pool_fill_lf_gaps', true, true, true, 'Repair: learning field gap filling'),
  ('pool_fill_trap_gaps', true, true, true, 'Repair: trap gap filling'),
  ('rework_trap_retrofit', true, true, true, 'Repair: trap retrofit'),
  ('setup_course_package', false, false, false, NULL)
ON CONFLICT (job_type) DO NOTHING;

-- 2. Update claim_pending_jobs_v4 to use central table
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_lock_timeout_minutes integer DEFAULT 10,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT jq.id
    FROM job_queue jq
    LEFT JOIN course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      -- Package-Status-Guard: only building packages OR policy-whitelisted
      AND (
        cp.id IS NULL                                        -- system jobs (no package)
        OR cp.status = 'building'                            -- normal path
        OR COALESCE(jtp.can_run_when_not_building, false)    -- policy whitelist
      )
    ORDER BY jq.priority DESC NULLS LAST, jq.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF jq SKIP LOCKED
  )
  UPDATE job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_at = now()
  FROM claimable c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

-- 3. Update auto-cancel trigger to use central table
CREATE OR REPLACE FUNCTION public.fn_auto_cancel_jobs_on_package_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled int;
BEGIN
  IF OLD.status = 'building' AND NEW.status IS DISTINCT FROM 'building' THEN
    WITH cancelled AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s', OLD.status, NEW.status),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL
      FROM job_type_policies jtp
      WHERE jtp.job_type = jq.job_type
        AND jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT COALESCE(jtp.exempt_from_auto_cancel, false)
      RETURNING jq.id
    )
    SELECT count(*) INTO v_cancelled FROM cancelled;

    -- Also cancel jobs not in the policies table (unknown types should be cancelled)
    WITH cancelled_unknown AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s', OLD.status, NEW.status),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL
      WHERE jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT EXISTS (SELECT 1 FROM job_type_policies p WHERE p.job_type = jq.job_type AND p.exempt_from_auto_cancel)
      RETURNING jq.id
    )
    SELECT v_cancelled + count(*) INTO v_cancelled FROM cancelled_unknown;

    IF v_cancelled > 0 THEN
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('auto_cancel_on_exit', NEW.id, NULL,
              jsonb_build_object(
                'cancelled_count', v_cancelled,
                'old_status', OLD.status,
                'new_status', NEW.status
              ));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. CI guard function: detect RPC overloads
CREATE OR REPLACE FUNCTION public.fn_guard_no_rpc_overloads()
RETURNS TABLE(function_name text, overload_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.proname::text AS function_name, count(*) AS overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'claim_pending_jobs_v4',
      'acquire_next_package_lease_v2',
      'fn_reconcile_orphan_steps',
      'fn_return_job_to_pending_no_burn',
      'fn_auto_cancel_jobs_on_package_exit',
      'fn_cancel_zombie_jobs'
    )
  GROUP BY p.proname
  HAVING count(*) > 1;
$$;