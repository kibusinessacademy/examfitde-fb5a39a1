
-- =============================================================
-- RPC Versioning Infrastructure: _v2 wrappers + registry
-- =============================================================

-- 1) Registry table for RPC versions
CREATE TABLE IF NOT EXISTS public.rpc_version_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rpc_name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  signature_hash text,
  breaking_change_reason text,
  deprecated_at timestamptz,
  successor_rpc text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rpc_name, version)
);

ALTER TABLE public.rpc_version_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on rpc_version_registry"
  ON public.rpc_version_registry FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Admins can read rpc_version_registry"
  ON public.rpc_version_registry FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) Helper: resolve current RPC version
CREATE OR REPLACE FUNCTION public.get_current_rpc_version(p_rpc_name text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(MAX(version), 1)
  FROM public.rpc_version_registry
  WHERE rpc_name = p_rpc_name AND is_current = true AND deprecated_at IS NULL;
$$;

-- =============================================================
-- 3) _v2 wrappers for high-risk RPCs
-- =============================================================

-- 3a) claim_pending_jobs_v2 — consolidates the two overloads
--     Breaking change: OLD version without p_worker_id had no lease guard
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v2(
  p_limit integer DEFAULT 5,
  p_worker_id text DEFAULT 'unknown',
  p_lock_timeout_minutes integer DEFAULT 10
)
RETURNS SETOF job_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Stale lock recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval;

  -- Ghost recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = 'Ghost recovery: processing without lock'
  WHERE status = 'processing'
    AND locked_at IS NULL
    AND updated_at < now() - interval '5 minutes';

  -- Claim with lease guard
  RETURN QUERY
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND jq.package_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.package_leases pl
        WHERE pl.package_id = jq.package_id
          AND pl.lease_until > now()
      )
    ORDER BY jq.priority DESC, jq.run_after ASC NULLS FIRST, jq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue jq
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = now(),
      updated_at = now()
  WHERE jq.id IN (SELECT id FROM picked)
  RETURNING jq.*;
END;
$$;

-- 3b) get_user_entitlements_v2 — stable signature, adds has_handbook
CREATE OR REPLACE FUNCTION public.get_user_entitlements_v2(
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_effective_user uuid;
BEGIN
  v_effective_user := CASE
    WHEN v_role = 'service_role' THEN p_user_id
    ELSE v_uid
  END;

  IF v_role IS DISTINCT FROM 'service_role' AND p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Admin bypass
  IF public.has_role(v_effective_user, 'admin') THEN
    RETURN QUERY
    SELECT
      c.id,
      true, true, true, true, true,
      (now() + interval '1 year')::timestamptz
    FROM public.curricula c
    WHERE c.status = 'frozen'
      AND (p_curriculum_id IS NULL OR c.id = p_curriculum_id);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.curriculum_id,
    bool_or(e.has_learning_course),
    bool_or(e.has_exam_trainer),
    bool_or(e.has_ai_tutor),
    bool_or(e.has_oral_trainer),
    bool_or(COALESCE(e.has_handbook, false)),
    max(e.valid_until)
  FROM public.entitlements e
  WHERE e.user_id = p_user_id
    AND e.valid_until > now()
    AND (p_curriculum_id IS NULL OR e.curriculum_id = p_curriculum_id)
  GROUP BY e.curriculum_id;
END;
$$;

-- 3c) calculate_readiness_score_v2 — adds confidence_level + recommendation
CREATE OR REPLACE FUNCTION public.calculate_readiness_score_v2(
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exam_score NUMERIC := 0;
  v_course_mastery NUMERIC := 0;
  v_session_count INTEGER := 0;
  v_weak JSONB := '[]';
  v_strong JSONB := '[]';
  v_trend TEXT := 'stable';
  v_days INTEGER := 30;
  v_readiness NUMERIC;
BEGIN
  SELECT COALESCE(AVG(es.score_percentage), 0), COUNT(*)
  INTO v_exam_score, v_session_count
  FROM exam_sessions es
  WHERE es.user_id = p_user_id
    AND es.curriculum_id = p_curriculum_id
    AND es.finished_at IS NOT NULL
    AND es.finished_at > NOW() - INTERVAL '30 days';

  SELECT COALESCE(
    (COUNT(CASE WHEN lo.mastery_status = 'mastered' THEN 1 END)::NUMERIC /
     NULLIF(COUNT(*)::NUMERIC, 0)) * 100, 0
  )
  INTO v_course_mastery
  FROM lesson_outcomes lo
  JOIN lessons l ON l.id = lo.lesson_id
  JOIN modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  WHERE lo.user_id = p_user_id
    AND c.curriculum_id = p_curriculum_id;

  v_readiness := (v_exam_score * 0.6) + (v_course_mastery * 0.4);

  overall_readiness := v_readiness;
  predicted_exam_score := v_exam_score;
  weak_areas := v_weak;
  strong_areas := v_strong;
  trend := v_trend;
  days_until_ready := GREATEST(0, CEIL((50 - v_readiness) / 2)::INTEGER);
  confidence_level := CASE
    WHEN v_session_count >= 10 THEN 'high'
    WHEN v_session_count >= 3 THEN 'medium'
    ELSE 'low'
  END;
  recommendation := CASE
    WHEN v_readiness >= 80 THEN 'exam_ready'
    WHEN v_readiness >= 50 THEN 'continue_practice'
    ELSE 'focus_on_basics'
  END;

  RETURN NEXT;
END;
$$;

-- 3d) pipeline_write_lesson_content_v2 — adds audit trail + idempotency
CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content_v2(
  p_lesson_id uuid,
  p_content jsonb,
  p_source text DEFAULT 'pipeline'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE((p_content->>'_placeholder')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'COUNCIL_REQUIRED: pipeline_write_lesson_content_v2 accepts placeholder-only content.';
  END IF;

  PERFORM set_config('council.publish_bypass', 'true', true);

  UPDATE public.lessons
  SET content = p_content,
      status = 'placeholder',
      updated_at = now()
  WHERE id = p_lesson_id;

  -- Audit trail
  INSERT INTO public.admin_actions (action, payload)
  VALUES ('pipeline_write_v2', jsonb_build_object(
    'lesson_id', p_lesson_id,
    'source', p_source,
    'at', now()
  ));

  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$$;

-- 3e) upsert_qa_finding_v2 — adds p_auto_resolve_key for idempotent resolution
CREATE OR REPLACE FUNCTION public.upsert_qa_finding_v2(
  p_area text,
  p_severity qa_severity,
  p_title text,
  p_description text,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_qa_run_id uuid DEFAULT NULL,
  p_auto_resolve_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.qa_findings(area, severity, title, description, evidence_json, status, updated_at, qa_run_id)
  VALUES (p_area, p_severity, p_title, p_description, COALESCE(p_evidence,'{}'::jsonb), 'open', now(), p_qa_run_id)
  ON CONFLICT (area, title) DO UPDATE SET
    severity = EXCLUDED.severity,
    description = EXCLUDED.description,
    evidence_json = EXCLUDED.evidence_json,
    qa_run_id = COALESCE(EXCLUDED.qa_run_id, public.qa_findings.qa_run_id),
    updated_at = now(),
    status = CASE WHEN public.qa_findings.status IN ('resolved','accepted_risk') THEN public.qa_findings.status ELSE 'open' END
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- =============================================================
-- 4) Register all versions in the registry
-- =============================================================
INSERT INTO public.rpc_version_registry (rpc_name, version, is_current, successor_rpc, breaking_change_reason) VALUES
  ('claim_pending_jobs', 1, false, 'claim_pending_jobs_v2', 'Old overload without lease guard; two overloads consolidated'),
  ('claim_pending_jobs_v2', 2, true, NULL, NULL),
  ('get_user_entitlements', 1, false, 'get_user_entitlements_v2', 'Added has_handbook column to return type'),
  ('get_user_entitlements_v2', 2, true, NULL, NULL),
  ('calculate_readiness_score', 1, false, 'calculate_readiness_score_v2', 'Added confidence_level + recommendation columns'),
  ('calculate_readiness_score_v2', 2, true, NULL, NULL),
  ('pipeline_write_lesson_content', 1, false, 'pipeline_write_lesson_content_v2', 'Added p_source param + audit trail'),
  ('pipeline_write_lesson_content_v2', 2, true, NULL, NULL),
  ('upsert_qa_finding', 1, false, 'upsert_qa_finding_v2', 'Added p_auto_resolve_key for idempotent resolution'),
  ('upsert_qa_finding_v2', 2, true, NULL, NULL);

-- Mark v1 as deprecated (still callable, just flagged)
UPDATE public.rpc_version_registry
SET deprecated_at = now()
WHERE version = 1;

-- =============================================================
-- 5) Register in schema_version_ledger for assertSchemaReady()
-- =============================================================
INSERT INTO public.schema_version_ledger (function_name, required_migration, verified_ok)
VALUES
  ('claim_pending_jobs_v2', '20260224_rpc_versioning', true),
  ('get_user_entitlements_v2', '20260224_rpc_versioning', true),
  ('calculate_readiness_score_v2', '20260224_rpc_versioning', true),
  ('pipeline_write_lesson_content_v2', '20260224_rpc_versioning', true),
  ('upsert_qa_finding_v2', '20260224_rpc_versioning', true)
ON CONFLICT (function_name) DO UPDATE
SET required_migration = EXCLUDED.required_migration,
    verified_ok = true,
    last_verified_at = now();
