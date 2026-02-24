
-- =============================================================
-- Schema Hardening v4: Cycle-bump, TTL deprecation, Critical scope,
-- Stable alias RPCs, Security definer audit
-- =============================================================

-- ─── 1) Contract table: add missing_since for TTL deprecation ───
ALTER TABLE public.schema_contracts
  ADD COLUMN IF NOT EXISTS missing_since timestamptz;

-- ─── 2) Ledger: add sync_cycle for cycle-bump invalidation ───
ALTER TABLE public.schema_version_ledger
  ADD COLUMN IF NOT EXISTS sync_cycle text;

-- ─── 3) Replace sync_schema_contracts with cycle-bump + TTL deprecation ───
CREATE OR REPLACE FUNCTION public.sync_schema_contracts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_updated int := 0;
  v_deprecated int := 0;
  v_missing_marked int := 0;
  v_skipped int := 0;
  v_hash text;
  v_rec record;
  v_seen_keys text[] := ARRAY[]::text[];
  v_lock_acquired boolean;
  v_cycle_id text;
  v_deprecation_ttl interval := interval '3 days';
BEGIN
  -- Advisory lock to prevent parallel sync races
  SELECT pg_try_advisory_lock(hashtext('sync_schema_contracts')) INTO v_lock_acquired;
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'another sync in progress');
  END IF;

  -- Generate unique cycle ID for this sync run
  v_cycle_id := to_char(now(), 'YYYYMMDD_HH24MISS') || '_' || gen_random_uuid()::text;

  BEGIN
    -- ── Columns ──
    FOR v_rec IN
      SELECT
        table_name || '.' || column_name AS entity,
        jsonb_build_object('data_type', data_type, 'is_nullable', is_nullable, 'column_default', column_default) AS spec
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name NOT LIKE 'pg_%'
        AND table_name NOT IN ('schema_contracts', 'schema_drift_log', 'schema_version_ledger', 'rpc_version_registry')
      ORDER BY table_name, ordinal_position
    LOOP
      v_hash := md5(v_rec.spec::text);
      v_seen_keys := array_append(v_seen_keys, 'column:' || v_rec.entity);

      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at, missing_since)
      VALUES ('column', v_rec.entity, v_rec.spec, false, 'Auto-synced', v_hash, now(), NULL, NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET
        expected_spec = EXCLUDED.expected_spec,
        contract_hash = EXCLUDED.contract_hash,
        updated_at = CASE WHEN schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash THEN now() ELSE schema_contracts.updated_at END,
        deprecated_at = NULL,
        missing_since = NULL
      WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
         OR schema_contracts.deprecated_at IS NOT NULL
         OR schema_contracts.missing_since IS NOT NULL;

      IF FOUND THEN
        v_updated := v_updated + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    END LOOP;

    -- ── RPCs ──
    FOR v_rec IN
      SELECT
        p.proname AS entity,
        jsonb_build_object('return_type', pg_get_function_result(p.oid), 'argument_types', pg_get_function_identity_arguments(p.oid), 'security', CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END) AS spec
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname NOT LIKE 'pg_%'
    LOOP
      v_hash := md5(v_rec.spec::text);
      v_seen_keys := array_append(v_seen_keys, 'rpc:' || v_rec.entity);
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at, missing_since)
      VALUES ('rpc', v_rec.entity, v_rec.spec, false, 'Auto-synced', v_hash, now(), NULL, NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET
        expected_spec = EXCLUDED.expected_spec, contract_hash = EXCLUDED.contract_hash,
        updated_at = CASE WHEN schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash THEN now() ELSE schema_contracts.updated_at END,
        deprecated_at = NULL, missing_since = NULL
      WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
         OR schema_contracts.deprecated_at IS NOT NULL
         OR schema_contracts.missing_since IS NOT NULL;
    END LOOP;

    -- ── Tables ──
    FOR v_rec IN
      SELECT table_name AS entity FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('schema_contracts', 'schema_drift_log', 'schema_version_ledger', 'rpc_version_registry')
    LOOP
      v_seen_keys := array_append(v_seen_keys, 'table:' || v_rec.entity);
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at, missing_since)
      VALUES ('table', v_rec.entity, '{}'::jsonb, false, 'Auto-synced', md5('{}'), now(), NULL, NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET deprecated_at = NULL, missing_since = NULL
      WHERE schema_contracts.deprecated_at IS NOT NULL OR schema_contracts.missing_since IS NOT NULL;
    END LOOP;

    -- ── Views ──
    FOR v_rec IN
      SELECT table_name AS entity FROM information_schema.views WHERE table_schema = 'public'
    LOOP
      v_seen_keys := array_append(v_seen_keys, 'view:' || v_rec.entity);
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at, missing_since)
      VALUES ('view', v_rec.entity, '{}'::jsonb, false, 'Auto-synced', md5('{}'), now(), NULL, NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET deprecated_at = NULL, missing_since = NULL
      WHERE schema_contracts.deprecated_at IS NOT NULL OR schema_contracts.missing_since IS NOT NULL;
    END LOOP;

    -- ── RLS Policies ──
    FOR v_rec IN
      SELECT tablename || '.' || policyname AS entity,
        jsonb_build_object('cmd', cmd, 'permissive', permissive, 'roles', roles) AS spec
      FROM pg_policies WHERE schemaname = 'public'
    LOOP
      v_hash := md5(v_rec.spec::text);
      v_seen_keys := array_append(v_seen_keys, 'rls_policy:' || v_rec.entity);
      INSERT INTO schema_contracts (contract_type, entity_name, expected_spec, is_critical, description, contract_hash, updated_at, deprecated_at, missing_since)
      VALUES ('rls_policy', v_rec.entity, v_rec.spec, false, 'Auto-synced', v_hash, now(), NULL, NULL)
      ON CONFLICT (contract_type, entity_name) DO UPDATE SET
        expected_spec = EXCLUDED.expected_spec, contract_hash = EXCLUDED.contract_hash,
        updated_at = CASE WHEN schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash THEN now() ELSE schema_contracts.updated_at END,
        deprecated_at = NULL, missing_since = NULL
      WHERE schema_contracts.contract_hash IS DISTINCT FROM EXCLUDED.contract_hash
         OR schema_contracts.deprecated_at IS NOT NULL
         OR schema_contracts.missing_since IS NOT NULL;
    END LOOP;

    -- ── TTL deprecation: mark missing_since first, deprecate after TTL ──
    -- Step 1: Mark newly missing entities with missing_since (soft signal)
    UPDATE schema_contracts
    SET missing_since = COALESCE(missing_since, now()),
        updated_at = now()
    WHERE deprecated_at IS NULL
      AND missing_since IS NULL
      AND NOT ((contract_type || ':' || entity_name) = ANY(v_seen_keys))
      AND contract_type IN ('column', 'rpc', 'table', 'view', 'rls_policy');
    GET DIAGNOSTICS v_missing_marked = ROW_COUNT;

    -- Step 2: Promote to deprecated after TTL (3 days missing)
    UPDATE schema_contracts
    SET deprecated_at = now(),
        updated_at = now()
    WHERE deprecated_at IS NULL
      AND missing_since IS NOT NULL
      AND missing_since < (now() - v_deprecation_ttl)
      AND NOT ((contract_type || ':' || entity_name) = ANY(v_seen_keys))
      AND contract_type IN ('column', 'rpc', 'table', 'view', 'rls_policy');
    GET DIAGNOSTICS v_deprecated = ROW_COUNT;

    -- ── Cycle bump: invalidate all ledger caches ──
    UPDATE schema_version_ledger
    SET sync_cycle = v_cycle_id,
        verified_ok = false,
        updated_at = now();

    -- Release lock
    PERFORM pg_advisory_unlock(hashtext('sync_schema_contracts'));

    RETURN jsonb_build_object(
      'synced_at', now(),
      'cycle_id', v_cycle_id,
      'updated', v_updated,
      'skipped_unchanged', v_skipped,
      'missing_marked', v_missing_marked,
      'deprecated_after_ttl', v_deprecated,
      'status', 'ok'
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('sync_schema_contracts'));
    RAISE;
  END;
END;
$$;

-- ─── 4) Set is_critical only for pipeline/auth/security essentials ───
-- First: default everything to non-critical
UPDATE public.schema_contracts SET is_critical = false WHERE is_critical = true;

-- Then: mark only the essential tables/RPCs as critical
UPDATE public.schema_contracts
SET is_critical = true
WHERE
  -- Critical tables
  (contract_type = 'table' AND entity_name IN (
    'job_queue', 'entitlements', 'curricula', 'content_versions',
    'exam_questions', 'lessons', 'course_packages', 'courses',
    'profiles', 'user_roles', 'schema_version_ledger', 'schema_contracts'
  ))
  -- Critical RPCs (v2 + core)
  OR (contract_type = 'rpc' AND entity_name IN (
    'claim_pending_jobs_v2', 'get_user_entitlements_v2',
    'calculate_readiness_score_v2', 'pipeline_write_lesson_content_v2',
    'upsert_qa_finding_v2', 'check_schema_drift', 'sync_schema_contracts',
    'check_user_entitlement', 'has_role', 'run_integrity_check'
  ))
  -- Critical columns on key tables
  OR (contract_type = 'column' AND (
    entity_name LIKE 'job_queue.%'
    OR entity_name LIKE 'entitlements.%'
    OR entity_name LIKE 'content_versions.%'
    OR entity_name LIKE 'schema_version_ledger.%'
  ));

-- ─── 5) Stable alias RPCs (*_current) ───

-- 5a) Generic resolver: returns the current version's RPC name
CREATE OR REPLACE FUNCTION public.resolve_current_rpc(p_base_name text)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT rpc_name
  FROM public.rpc_version_registry
  WHERE (rpc_name = p_base_name OR rpc_name LIKE p_base_name || '_v%')
    AND is_current = true
    AND deprecated_at IS NULL
  ORDER BY version DESC
  LIMIT 1;
$$;

-- 5b) Concrete _current aliases that delegate to the active version

CREATE OR REPLACE FUNCTION public.get_user_entitlements_current(
  p_user_id uuid,
  p_curriculum_id uuid DEFAULT NULL
)
RETURNS TABLE(
  curriculum_id uuid,
  has_learning_course boolean,
  has_exam_trainer boolean,
  has_ai_tutor boolean,
  has_oral_trainer boolean,
  has_handbook boolean,
  valid_until timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.get_user_entitlements_v2(p_user_id, p_curriculum_id);
$$;

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_current(
  p_limit integer DEFAULT 5,
  p_worker_id text DEFAULT 'unknown',
  p_lock_timeout_minutes integer DEFAULT 10
)
RETURNS SETOF public.job_queue
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.claim_pending_jobs_v2(p_limit, p_worker_id, p_lock_timeout_minutes);
$$;

CREATE OR REPLACE FUNCTION public.calculate_readiness_score_current(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS TABLE(
  overall_readiness numeric,
  predicted_exam_score numeric,
  weak_areas jsonb,
  strong_areas jsonb,
  trend text,
  days_until_ready integer,
  confidence_level text,
  recommendation text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.calculate_readiness_score_v2(p_user_id, p_curriculum_id);
$$;

CREATE OR REPLACE FUNCTION public.upsert_qa_finding_current(
  p_area text,
  p_severity qa_severity,
  p_title text,
  p_description text,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_qa_run_id uuid DEFAULT NULL,
  p_auto_resolve_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.upsert_qa_finding_v2(p_area, p_severity, p_title, p_description, p_evidence, p_qa_run_id, p_auto_resolve_key);
$$;

CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content_current(
  p_lesson_id uuid,
  p_title text,
  p_theory_md text,
  p_practice_md text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT 'current_alias'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.pipeline_write_lesson_content_v2(p_lesson_id, p_title, p_theory_md, p_practice_md, p_metadata, p_source);
END;
$$;

-- Register _current aliases in registry
INSERT INTO public.rpc_version_registry (rpc_name, version, is_current, successor_rpc, breaking_change_reason, updated_at)
VALUES
  ('get_user_entitlements_current',         2, true, NULL, 'Stable alias → v2', now()),
  ('claim_pending_jobs_current',            2, true, NULL, 'Stable alias → v2', now()),
  ('calculate_readiness_score_current',     2, true, NULL, 'Stable alias → v2', now()),
  ('upsert_qa_finding_current',             2, true, NULL, 'Stable alias → v2', now()),
  ('pipeline_write_lesson_content_current', 2, true, NULL, 'Stable alias → v2', now())
ON CONFLICT (rpc_name, version) DO UPDATE SET
  is_current = EXCLUDED.is_current,
  updated_at = now();

-- ─── 6) Security Definer Audit: Convert non-essential RPCs to INVOKER ───
-- resolve_current_rpc is already INVOKER (created above)
-- get_current_rpc_version can be INVOKER too (reads public registry)
CREATE OR REPLACE FUNCTION public.get_current_rpc_version(p_rpc_name text)
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT COALESCE(MAX(version), 1)
  FROM public.rpc_version_registry
  WHERE rpc_name = p_rpc_name AND is_current = true AND deprecated_at IS NULL;
$$;
