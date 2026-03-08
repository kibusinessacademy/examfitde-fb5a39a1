
BEGIN;

-- ============================================================
-- 1. CONTRACT REGISTRY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_contract_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_key text NOT NULL UNIQUE,
  contract_type text NOT NULL,
  contract_name text NOT NULL,
  version text NOT NULL DEFAULT '1',
  owner_layer text NOT NULL,
  expected_shape jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_contract_registry_type_chk CHECK (
    contract_type IN ('rpc','edge_function','table','view','enum','mapping')
  )
);

-- ============================================================
-- 2. SSOT MAPPINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_ssot_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_key text NOT NULL UNIQUE,
  mapping_type text NOT NULL,
  source_key text NOT NULL,
  target_key text NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_ssot_mappings_type_chk CHECK (
    mapping_type IN ('step_job','job_edge','status_flow','layer_channel','asset_distribution')
  )
);

-- ============================================================
-- 3. ENUM REGISTRY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_enum_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enum_key text NOT NULL UNIQUE,
  enum_scope text NOT NULL,
  allowed_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_of_truth text NOT NULL DEFAULT 'db',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. CONTRACT VIOLATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_contract_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warn',
  contract_key text,
  mapping_key text,
  object_ref text,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT system_contract_violations_severity_chk CHECK (
    severity IN ('info','warn','critical')
  ),
  CONSTRAINT system_contract_violations_status_chk CHECK (
    status IN ('open','resolved')
  )
);

CREATE INDEX IF NOT EXISTS idx_system_contract_violations_status
  ON public.system_contract_violations (status, severity, created_at DESC);

-- ============================================================
-- 5. HEALTH ASSERTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_health_assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assertion_key text NOT NULL UNIQUE,
  assertion_scope text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  severity text NOT NULL DEFAULT 'warn',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_health_assertions_severity_chk CHECK (
    severity IN ('info','warn','critical')
  )
);

INSERT INTO public.system_health_assertions (assertion_key, assertion_scope, severity, config)
VALUES
  ('pipeline_status_integrity', 'pipeline', 'critical', '{}'::jsonb),
  ('contract_registry_consistency', 'contracts', 'warn', '{}'::jsonb),
  ('ssot_mapping_complete', 'mappings', 'critical', '{}'::jsonb),
  ('enum_registry_consistency', 'enums', 'warn', '{}'::jsonb)
ON CONFLICT (assertion_key) DO NOTHING;

-- ============================================================
-- SEED: Core RPC contracts
-- ============================================================

INSERT INTO public.system_contract_registry (contract_key, contract_type, contract_name, owner_layer, expected_shape)
VALUES
  ('rpc.check_fan_out_completion', 'rpc', 'check_fan_out_completion', 'production', '{"returns":"jsonb"}'),
  ('rpc.get_learning_content_progress', 'rpc', 'get_learning_content_progress', 'production', '{"returns":"jsonb"}'),
  ('rpc.get_competency_bundle_progress', 'rpc', 'get_competency_bundle_progress', 'production', '{"returns":"jsonb"}'),
  ('rpc.compute_curriculum_gtm_score', 'rpc', 'compute_curriculum_gtm_score', 'revenue', '{"returns":"jsonb"}'),
  ('rpc.sync_campaign_launch_plans', 'rpc', 'sync_campaign_launch_plans', 'campaigns', '{"returns":"jsonb"}'),
  ('rpc.enqueue_distribution_targets', 'rpc', 'enqueue_distribution_targets', 'distribution', '{"returns":"jsonb"}')
ON CONFLICT (contract_key) DO NOTHING;

INSERT INTO public.system_contract_registry (contract_key, contract_type, contract_name, owner_layer, expected_shape)
VALUES
  ('edge.control-plane-cron', 'edge_function', 'control-plane-cron', 'control', '{"method":"POST"}'),
  ('edge.control-plane-phase2-cron', 'edge_function', 'control-plane-phase2-cron', 'control', '{"method":"POST"}'),
  ('edge.executive-phase3-cron', 'edge_function', 'executive-phase3-cron', 'control', '{"method":"POST"}'),
  ('edge.campaign-automation-cron', 'edge_function', 'campaign-automation-cron', 'campaigns', '{"method":"POST"}'),
  ('edge.distribution-cron', 'edge_function', 'distribution-cron', 'distribution', '{"method":"POST"}'),
  ('edge.optimization-cron', 'edge_function', 'optimization-cron', 'optimization', '{"method":"POST"}')
ON CONFLICT (contract_key) DO NOTHING;

INSERT INTO public.system_ssot_mappings (mapping_key, mapping_type, source_key, target_key, meta)
VALUES
  ('step.generate_learning_content->job.package_generate_learning_content', 'step_job', 'generate_learning_content', 'package_generate_learning_content', '{"fan_out":true}'),
  ('step.generate_exam_pool->job.package_generate_exam_pool', 'step_job', 'generate_exam_pool', 'package_generate_exam_pool', '{"fan_out":true}'),
  ('job.lesson_generate_competency_bundle->edge.lesson-generate-competency-bundle', 'job_edge', 'lesson_generate_competency_bundle', 'lesson-generate-competency-bundle', '{}'::jsonb),
  ('job.lesson_generate_content->edge.lesson-generate-content', 'job_edge', 'lesson_generate_content', 'lesson-generate-content', '{}'::jsonb),
  ('job.package_generate_learning_content->edge.package-generate-learning-content', 'job_edge', 'package_generate_learning_content', 'package-generate-learning-content', '{}'::jsonb)
ON CONFLICT (mapping_key) DO NOTHING;

INSERT INTO public.system_enum_registry (enum_key, enum_scope, allowed_values)
VALUES
  ('course_packages.status', 'table', '["queued","planning","building","draft","published","failed","archived"]'::jsonb),
  ('job_queue.status', 'table', '["queued","pending","processing","done","failed","dead","cancelled","skipped"]'::jsonb),
  ('package_steps.status', 'table', '["queued","enqueued","running","done","failed","cancelled","skipped"]'::jsonb),
  ('campaign_asset_queue.status', 'table', '["queued","processing","done","failed","dead","skipped"]'::jsonb),
  ('distribution_queue.status', 'table', '["queued","processing","done","failed","dead","skipped"]'::jsonb),
  ('optimization_actions.status', 'table', '["queued","processing","done","failed","skipped"]'::jsonb)
ON CONFLICT (enum_key) DO NOTHING;

-- ============================================================
-- AUDIT RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.assert_ssot_mapping_complete()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing_count integer := 0;
BEGIN
  SELECT count(*)
  INTO v_missing_count
  FROM public.system_ssot_mappings
  WHERE is_required = true
    AND is_active = true
    AND (source_key IS NULL OR target_key IS NULL OR btrim(source_key) = '' OR btrim(target_key) = '');

  RETURN jsonb_build_object(
    'ok', v_missing_count = 0,
    'missing_count', v_missing_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_contract_registry_consistency()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inactive_required integer := 0;
BEGIN
  SELECT count(*)
  INTO v_inactive_required
  FROM public.system_contract_registry
  WHERE is_active = false
    AND contract_key IN (
      'rpc.check_fan_out_completion',
      'rpc.get_learning_content_progress',
      'edge.control-plane-cron'
    );

  RETURN jsonb_build_object(
    'ok', v_inactive_required = 0,
    'inactive_required', v_inactive_required
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_enum_registry_consistency()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
BEGIN
  SELECT count(*)
  INTO v_total
  FROM public.system_enum_registry
  WHERE jsonb_typeof(allowed_values) <> 'array';

  RETURN jsonb_build_object(
    'ok', v_total = 0,
    'invalid_enum_rows', v_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_pipeline_status_integrity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invalid_steps integer := 0;
  v_invalid_jobs integer := 0;
BEGIN
  SELECT count(*)
  INTO v_invalid_steps
  FROM public.package_steps
  WHERE status NOT IN ('queued','enqueued','running','done','failed','cancelled','skipped');

  SELECT count(*)
  INTO v_invalid_jobs
  FROM public.job_queue
  WHERE status NOT IN ('queued','pending','processing','done','failed','dead','cancelled','skipped');

  RETURN jsonb_build_object(
    'ok', (v_invalid_steps = 0 AND v_invalid_jobs = 0),
    'invalid_step_status_rows', v_invalid_steps,
    'invalid_job_status_rows', v_invalid_jobs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_system_contract_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ssot jsonb;
  v_contracts jsonb;
  v_enums jsonb;
  v_pipeline jsonb;
  v_ok boolean;
BEGIN
  SELECT public.assert_ssot_mapping_complete() INTO v_ssot;
  SELECT public.assert_contract_registry_consistency() INTO v_contracts;
  SELECT public.assert_enum_registry_consistency() INTO v_enums;
  SELECT public.assert_pipeline_status_integrity() INTO v_pipeline;

  v_ok :=
    coalesce((v_ssot->>'ok')::boolean, false)
    AND coalesce((v_contracts->>'ok')::boolean, false)
    AND coalesce((v_enums->>'ok')::boolean, false)
    AND coalesce((v_pipeline->>'ok')::boolean, false);

  RETURN jsonb_build_object(
    'ok', v_ok,
    'ssot', v_ssot,
    'contracts', v_contracts,
    'enums', v_enums,
    'pipeline', v_pipeline
  );
END;
$$;

COMMIT;
