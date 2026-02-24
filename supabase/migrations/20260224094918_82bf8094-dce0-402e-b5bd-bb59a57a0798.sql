
-- =============================================================
-- RPC Versioning Hardening: Idempotent Registry + v1→v2 Wrappers
-- =============================================================

-- 1) Add updated_at column if missing
ALTER TABLE public.rpc_version_registry
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2) Idempotent UPSERT for registry entries
INSERT INTO public.rpc_version_registry (rpc_name, version, is_current, successor_rpc, breaking_change_reason, updated_at)
VALUES
  ('claim_pending_jobs',              1, false, 'claim_pending_jobs_v2',              'Old overload without lease guard; two overloads consolidated', now()),
  ('claim_pending_jobs_v2',           2, true,  NULL,                                  NULL, now()),
  ('get_user_entitlements',           1, false, 'get_user_entitlements_v2',            'Added has_handbook column to return type', now()),
  ('get_user_entitlements_v2',        2, true,  NULL,                                  NULL, now()),
  ('calculate_readiness_score',       1, false, 'calculate_readiness_score_v2',        'Added confidence_level + recommendation columns', now()),
  ('calculate_readiness_score_v2',    2, true,  NULL,                                  NULL, now()),
  ('pipeline_write_lesson_content',   1, false, 'pipeline_write_lesson_content_v2',    'Added p_source param + audit trail', now()),
  ('pipeline_write_lesson_content_v2',2, true,  NULL,                                  NULL, now()),
  ('upsert_qa_finding',               1, false, 'upsert_qa_finding_v2',                'Added p_auto_resolve_key for idempotent resolution', now()),
  ('upsert_qa_finding_v2',            2, true,  NULL,                                  NULL, now())
ON CONFLICT (rpc_name, version) DO UPDATE SET
  is_current = EXCLUDED.is_current,
  successor_rpc = EXCLUDED.successor_rpc,
  breaking_change_reason = EXCLUDED.breaking_change_reason,
  updated_at = now();

-- Deprecate v1 only if not already deprecated
UPDATE public.rpc_version_registry
SET deprecated_at = COALESCE(deprecated_at, now()),
    updated_at = now()
WHERE version = 1
  AND deprecated_at IS NULL;

-- =============================================================
-- 3) v1 RPCs become thin wrappers delegating to v2 (single SSOT)
-- =============================================================

-- 3a) get_user_entitlements v1 → delegates to v2, drops has_handbook
CREATE OR REPLACE FUNCTION public.get_user_entitlements(
  p_user_id uuid,
  p_curriculum_id uuid DEFAULT NULL
)
RETURNS TABLE(
  curriculum_id uuid,
  has_learning_course boolean,
  has_exam_trainer boolean,
  has_ai_tutor boolean,
  has_oral_trainer boolean,
  valid_until timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    curriculum_id,
    has_learning_course,
    has_exam_trainer,
    has_ai_tutor,
    has_oral_trainer,
    valid_until
  FROM public.get_user_entitlements_v2(p_user_id, p_curriculum_id);
$$;

-- 3b) calculate_readiness_score v1 → delegates to v2, drops new columns
CREATE OR REPLACE FUNCTION public.calculate_readiness_score(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS TABLE(
  overall_readiness numeric,
  predicted_exam_score numeric,
  weak_areas jsonb,
  strong_areas jsonb,
  trend text,
  days_until_ready integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    overall_readiness,
    predicted_exam_score,
    weak_areas,
    strong_areas,
    trend,
    days_until_ready
  FROM public.calculate_readiness_score_v2(p_user_id, p_curriculum_id);
$$;

-- 3c) upsert_qa_finding v1 → delegates to v2 with NULL auto_resolve_key
CREATE OR REPLACE FUNCTION public.upsert_qa_finding(
  p_area text,
  p_severity qa_severity,
  p_title text,
  p_description text,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_qa_run_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.upsert_qa_finding_v2(p_area, p_severity, p_title, p_description, p_evidence, p_qa_run_id, NULL::text);
$$;

-- 3d) pipeline_write_lesson_content v1 → delegates to v2 with 'legacy' source
CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content(
  p_lesson_id uuid,
  p_title text,
  p_theory_md text,
  p_practice_md text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.pipeline_write_lesson_content_v2(p_lesson_id, p_title, p_theory_md, p_practice_md, p_metadata, 'legacy_v1_caller'::text);
END;
$$;

-- 3e) claim_pending_jobs v1 overloads → delegate to v2
DROP FUNCTION IF EXISTS public.claim_pending_jobs(integer);
DROP FUNCTION IF EXISTS public.claim_pending_jobs(integer, text, integer);

CREATE OR REPLACE FUNCTION public.claim_pending_jobs(p_limit integer DEFAULT 5)
RETURNS SETOF public.job_queue
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.claim_pending_jobs_v2(p_limit, 'legacy_v1'::text, 10);
$$;

CREATE OR REPLACE FUNCTION public.claim_pending_jobs(
  p_limit integer DEFAULT 5,
  p_worker_id text DEFAULT 'unknown',
  p_lock_timeout_minutes integer DEFAULT 10
)
RETURNS SETOF public.job_queue
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.claim_pending_jobs_v2(p_limit, p_worker_id, p_lock_timeout_minutes);
$$;

-- =============================================================
-- 4) Ledger: add verified_cycle for freshness checking
-- =============================================================
ALTER TABLE public.schema_version_ledger
  ADD COLUMN IF NOT EXISTS verified_cycle text;
