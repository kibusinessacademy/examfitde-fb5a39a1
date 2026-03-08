
BEGIN;

-- ============================================================
-- 1. CRON REGISTRY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_cron_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_key text NOT NULL UNIQUE,
  layer_key text NOT NULL,
  edge_function_name text NOT NULL,
  cadence_key text NOT NULL,
  timeout_seconds integer NOT NULL DEFAULT 300,
  max_parallel integer NOT NULL DEFAULT 1,
  is_enabled boolean NOT NULL DEFAULT true,
  criticality text NOT NULL DEFAULT 'warn',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_cron_registry_criticality_chk CHECK (
    criticality IN ('info','warn','critical')
  )
);

-- ============================================================
-- 2. CRON EXECUTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_cron_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_key text NOT NULL,
  execution_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  runner_id text,
  duration_ms integer,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  CONSTRAINT system_cron_executions_status_chk CHECK (
    status IN ('running','done','failed','skipped','stale')
  )
);

CREATE INDEX IF NOT EXISTS idx_system_cron_executions_lookup
  ON public.system_cron_executions (cron_key, status, started_at DESC);

-- ============================================================
-- 3. RUNNER REGISTRY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_runner_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_key text NOT NULL UNIQUE,
  layer_key text NOT NULL,
  runner_type text NOT NULL,
  max_concurrency integer NOT NULL DEFAULT 1,
  is_enabled boolean NOT NULL DEFAULT true,
  heartbeat_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_runner_registry_type_chk CHECK (
    runner_type IN ('cron','queue_worker','edge_orchestrator','watchdog')
  )
);

-- ============================================================
-- 4. RETRY POLICIES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_retry_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL UNIQUE,
  scope_type text NOT NULL,
  scope_ref text NOT NULL,
  max_attempts integer NOT NULL DEFAULT 5,
  backoff_mode text NOT NULL DEFAULT 'exponential',
  base_delay_seconds integer NOT NULL DEFAULT 30,
  max_delay_seconds integer NOT NULL DEFAULT 1800,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_retry_policies_scope_chk CHECK (
    scope_type IN ('job_type','cron_key','edge_function')
  ),
  CONSTRAINT system_retry_policies_backoff_chk CHECK (
    backoff_mode IN ('fixed','linear','exponential')
  )
);

-- ============================================================
-- 5. SCHEDULER GUARDRAILS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_scheduler_guardrails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardrail_key text NOT NULL UNIQUE,
  layer_key text NOT NULL,
  guardrail_type text NOT NULL,
  threshold_numeric numeric NOT NULL DEFAULT 0,
  action_mode text NOT NULL DEFAULT 'alert_only',
  is_enabled boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_scheduler_guardrails_action_chk CHECK (
    action_mode IN ('alert_only','throttle','pause','skip_new_claims','auto_release')
  )
);

-- ============================================================
-- 6. EXECUTION LEASES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_execution_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_key text NOT NULL UNIQUE,
  lease_scope text NOT NULL,
  scope_ref text,
  owner_key text NOT NULL,
  lease_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT system_execution_leases_status_chk CHECK (
    status IN ('active','released','expired','stale')
  )
);

CREATE INDEX IF NOT EXISTS idx_system_execution_leases_lookup
  ON public.system_execution_leases (lease_scope, status, lease_until);

-- ============================================================
-- 7. ORPHAN EXECUTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_orphan_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orphan_type text NOT NULL,
  object_ref text NOT NULL,
  severity text NOT NULL DEFAULT 'warn',
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT system_orphan_executions_severity_chk CHECK (
    severity IN ('info','warn','critical')
  ),
  CONSTRAINT system_orphan_executions_status_chk CHECK (
    status IN ('open','resolved')
  )
);

CREATE INDEX IF NOT EXISTS idx_system_orphan_executions_lookup
  ON public.system_orphan_executions (status, orphan_type, created_at DESC);

-- ============================================================
-- SEED
-- ============================================================

INSERT INTO public.system_cron_registry (cron_key, layer_key, edge_function_name, cadence_key, timeout_seconds, max_parallel, criticality)
VALUES
  ('control-plane-cron', 'control', 'control-plane-cron', '15m', 120, 1, 'critical'),
  ('control-plane-phase2-cron', 'control', 'control-plane-phase2-cron', 'hourly', 180, 1, 'warn'),
  ('executive-phase3-cron', 'control', 'executive-phase3-cron', 'daily', 240, 1, 'warn'),
  ('system-probe-cron', 'control', 'system-probe-cron', 'nightly', 300, 1, 'critical'),
  ('campaign-automation-cron', 'campaigns', 'campaign-automation-cron', '15m', 180, 1, 'warn'),
  ('distribution-cron', 'distribution', 'distribution-cron', '15m', 180, 1, 'warn'),
  ('optimization-cron', 'optimization', 'optimization-cron', 'hourly', 180, 1, 'warn')
ON CONFLICT (cron_key) DO NOTHING;

INSERT INTO public.system_runner_registry (runner_key, layer_key, runner_type, max_concurrency)
VALUES
  ('pipeline-runner', 'production', 'queue_worker', 8),
  ('content-runner', 'production', 'queue_worker', 12),
  ('production-watchdog', 'production', 'watchdog', 2),
  ('campaign-asset-worker', 'campaigns', 'queue_worker', 4),
  ('distribution-worker', 'distribution', 'queue_worker', 4),
  ('optimization-executor', 'optimization', 'queue_worker', 3)
ON CONFLICT (runner_key) DO NOTHING;

INSERT INTO public.system_retry_policies (policy_key, scope_type, scope_ref, max_attempts, backoff_mode, base_delay_seconds, max_delay_seconds)
VALUES
  ('retry.job.lesson_generate_content', 'job_type', 'lesson_generate_content', 5, 'exponential', 30, 1800),
  ('retry.job.lesson_generate_competency_bundle', 'job_type', 'lesson_generate_competency_bundle', 5, 'exponential', 20, 900),
  ('retry.job.package_generate_learning_content', 'job_type', 'package_generate_learning_content', 4, 'exponential', 60, 1800),
  ('retry.cron.system-probe-cron', 'cron_key', 'system-probe-cron', 2, 'fixed', 300, 600),
  ('retry.edge.control-plane-cron', 'edge_function', 'control-plane-cron', 2, 'fixed', 120, 300)
ON CONFLICT (policy_key) DO NOTHING;

INSERT INTO public.system_scheduler_guardrails (guardrail_key, layer_key, guardrail_type, threshold_numeric, action_mode)
VALUES
  ('production.max_active_jobs', 'production', 'max_active_jobs', 500, 'throttle'),
  ('production.max_failed_1h', 'production', 'max_failed_1h', 75, 'skip_new_claims'),
  ('control.max_running_crons', 'control', 'max_running_crons', 2, 'skip_new_claims'),
  ('global.max_stale_leases', 'global', 'max_stale_leases', 25, 'auto_release'),
  ('campaigns.max_active_jobs', 'campaigns', 'max_active_jobs', 120, 'throttle'),
  ('distribution.max_active_jobs', 'distribution', 'max_active_jobs', 120, 'throttle')
ON CONFLICT (guardrail_key) DO NOTHING;

-- ============================================================
-- RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_cron_execution(
  p_cron_key text,
  p_runner_id text DEFAULT 'system',
  p_timeout_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing integer := 0;
  v_execution_key text;
  v_id uuid;
BEGIN
  SELECT count(*)
  INTO v_existing
  FROM public.system_cron_executions
  WHERE cron_key = p_cron_key
    AND status = 'running'
    AND started_at > now() - make_interval(secs => p_timeout_seconds);

  IF v_existing > 0 THEN
    RETURN jsonb_build_object('ok', false, 'claimed', false, 'reason', 'already_running');
  END IF;

  v_execution_key := p_cron_key || ':' || extract(epoch from now())::bigint::text;

  INSERT INTO public.system_cron_executions (cron_key, execution_key, status, runner_id, started_at)
  VALUES (p_cron_key, v_execution_key, 'running', p_runner_id, now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'claimed', true, 'execution_id', v_id, 'execution_key', v_execution_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_cron_execution(
  p_execution_id uuid,
  p_status text,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.system_cron_executions
  SET status = p_status,
      result = coalesce(p_result, '{}'::jsonb),
      error_message = p_error_message,
      finished_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000))::int
  WHERE id = p_execution_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_system_execution_lease(
  p_lease_key text,
  p_lease_scope text,
  p_scope_ref text,
  p_owner_key text,
  p_minutes integer DEFAULT 10,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active record;
  v_id uuid;
BEGIN
  SELECT *
  INTO v_active
  FROM public.system_execution_leases
  WHERE lease_key = p_lease_key
    AND status = 'active'
    AND lease_until > now()
  LIMIT 1;

  IF v_active.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'claimed', false, 'reason', 'lease_active');
  END IF;

  INSERT INTO public.system_execution_leases (lease_key, lease_scope, scope_ref, owner_key, lease_until, status, meta)
  VALUES (p_lease_key, p_lease_scope, p_scope_ref, p_owner_key, now() + make_interval(mins => p_minutes), 'active', coalesce(p_meta, '{}'::jsonb))
  ON CONFLICT (lease_key)
  DO UPDATE SET
    lease_scope = excluded.lease_scope,
    scope_ref = excluded.scope_ref,
    owner_key = excluded.owner_key,
    lease_until = excluded.lease_until,
    status = 'active',
    meta = excluded.meta,
    updated_at = now(),
    released_at = NULL
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'claimed', true, 'lease_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_system_execution_lease(
  p_lease_key text,
  p_owner_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.system_execution_leases
  SET status = 'released', released_at = now(), updated_at = now()
  WHERE lease_key = p_lease_key
    AND status = 'active'
    AND (p_owner_key IS NULL OR owner_key = p_owner_key);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'released_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.run_scheduler_governance_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_running_crons integer := 0;
  v_stale_leases integer := 0;
  v_failed_jobs_1h integer := 0;
  v_ok boolean := true;
BEGIN
  SELECT count(*) INTO v_running_crons
  FROM public.system_cron_executions
  WHERE status = 'running' AND started_at > now() - interval '1 hour';

  SELECT count(*) INTO v_stale_leases
  FROM public.system_execution_leases
  WHERE status = 'active' AND lease_until < now();

  SELECT count(*) INTO v_failed_jobs_1h
  FROM public.job_queue
  WHERE status = 'failed' AND updated_at > now() - interval '1 hour';

  v_ok := (v_running_crons <= 5 AND v_stale_leases = 0);

  RETURN jsonb_build_object(
    'ok', v_ok,
    'running_crons', v_running_crons,
    'stale_leases', v_stale_leases,
    'failed_jobs_1h', v_failed_jobs_1h
  );
END;
$$;

COMMIT;
