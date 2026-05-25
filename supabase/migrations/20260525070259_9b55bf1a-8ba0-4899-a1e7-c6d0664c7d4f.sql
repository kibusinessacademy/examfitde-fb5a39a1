
-- ============================================================
-- Berufs-KI Phase 3 — Quality, Feedback & Versioning
-- ============================================================

-- 1) Run evaluation columns
ALTER TABLE public.berufs_ki_workflow_runs
  ADD COLUMN IF NOT EXISTS quality_score numeric,
  ADD COLUMN IF NOT EXISTS user_rating smallint,
  ADD COLUMN IF NOT EXISTS feedback_text text,
  ADD COLUMN IF NOT EXISTS completion_status text,
  ADD COLUMN IF NOT EXISTS output_sections_detected text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS output_sections_missing text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sections_coverage_pct numeric,
  ADD COLUMN IF NOT EXISTS definition_version_at_run integer,
  ADD COLUMN IF NOT EXISTS source_run_id uuid REFERENCES public.berufs_ki_workflow_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_of uuid REFERENCES public.berufs_ki_workflow_runs(id) ON DELETE SET NULL;

ALTER TABLE public.berufs_ki_workflow_runs
  DROP CONSTRAINT IF EXISTS berufs_ki_workflow_runs_user_rating_check;
ALTER TABLE public.berufs_ki_workflow_runs
  ADD CONSTRAINT berufs_ki_workflow_runs_user_rating_check
  CHECK (user_rating IS NULL OR user_rating IN (-1, 0, 1));

ALTER TABLE public.berufs_ki_workflow_runs
  DROP CONSTRAINT IF EXISTS berufs_ki_workflow_runs_completion_check;
ALTER TABLE public.berufs_ki_workflow_runs
  ADD CONSTRAINT berufs_ki_workflow_runs_completion_check
  CHECK (completion_status IS NULL OR completion_status IN ('complete','partial','empty','unknown'));

CREATE INDEX IF NOT EXISTS idx_berufs_ki_runs_quality
  ON public.berufs_ki_workflow_runs (workflow_id, created_at DESC)
  WHERE status = 'ok';

-- 2) Versions table — snapshot on definition change
CREATE TABLE IF NOT EXISTS public.berufs_ki_workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.berufs_ki_workflow_definitions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  system_prompt text NOT NULL,
  user_prompt_template text NOT NULL,
  input_schema jsonb NOT NULL,
  output_schema jsonb NOT NULL,
  tier_required text NOT NULL,
  model_recommendation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

ALTER TABLE public.berufs_ki_workflow_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "berufs_ki_versions_admin_read" ON public.berufs_ki_workflow_versions;
CREATE POLICY "berufs_ki_versions_admin_read"
  ON public.berufs_ki_workflow_versions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) Auto-version trigger
CREATE OR REPLACE FUNCTION public.fn_berufs_ki_snapshot_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Always insert a snapshot of the new state (for INSERT or relevant UPDATEs)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.system_prompt IS NOT DISTINCT FROM OLD.system_prompt
       AND NEW.user_prompt_template IS NOT DISTINCT FROM OLD.user_prompt_template
       AND NEW.input_schema IS NOT DISTINCT FROM OLD.input_schema
       AND NEW.output_schema IS NOT DISTINCT FROM OLD.output_schema
       AND NEW.tier_required IS NOT DISTINCT FROM OLD.tier_required
       AND NEW.model_recommendation IS NOT DISTINCT FROM OLD.model_recommendation THEN
      RETURN NEW;
    END IF;
    NEW.version := COALESCE(OLD.version, 1) + 1;
    NEW.updated_at := now();
  END IF;

  INSERT INTO public.berufs_ki_workflow_versions
    (workflow_id, version, slug, title, system_prompt, user_prompt_template,
     input_schema, output_schema, tier_required, model_recommendation)
  VALUES
    (NEW.id, NEW.version, NEW.slug, NEW.title, NEW.system_prompt, NEW.user_prompt_template,
     NEW.input_schema, NEW.output_schema, NEW.tier_required, NEW.model_recommendation)
  ON CONFLICT (workflow_id, version) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_berufs_ki_snapshot_version ON public.berufs_ki_workflow_definitions;
CREATE TRIGGER trg_berufs_ki_snapshot_version
  BEFORE INSERT OR UPDATE ON public.berufs_ki_workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.fn_berufs_ki_snapshot_version();

-- Backfill v1 snapshots for existing workflows
INSERT INTO public.berufs_ki_workflow_versions
  (workflow_id, version, slug, title, system_prompt, user_prompt_template,
   input_schema, output_schema, tier_required, model_recommendation)
SELECT id, version, slug, title, system_prompt, user_prompt_template,
       input_schema, output_schema, tier_required, model_recommendation
FROM public.berufs_ki_workflow_definitions
ON CONFLICT (workflow_id, version) DO NOTHING;

-- 4) Feedback RPC for owners
CREATE OR REPLACE FUNCTION public.berufs_ki_record_feedback(
  p_run_id uuid,
  p_rating smallint,
  p_feedback text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  IF p_rating IS NULL OR p_rating NOT IN (-1, 0, 1) THEN
    RAISE EXCEPTION 'invalid_rating';
  END IF;

  UPDATE public.berufs_ki_workflow_runs
     SET user_rating = p_rating,
         feedback_text = NULLIF(left(COALESCE(p_feedback, ''), 1000), '')
   WHERE id = p_run_id
     AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'run_not_found_or_forbidden';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.berufs_ki_record_feedback(uuid, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.berufs_ki_record_feedback(uuid, smallint, text) TO authenticated;

-- 5) Admin Quality Dashboard
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_quality_dashboard(p_window_hours integer DEFAULT 168)
RETURNS TABLE (
  workflow_id uuid,
  slug text,
  title text,
  category text,
  tier_required text,
  is_active boolean,
  version integer,
  runs_window integer,
  ok_runs integer,
  error_runs integer,
  blocked_runs integer,
  rate_limited_runs integer,
  ok_rate numeric,
  error_rate numeric,
  avg_latency_ms numeric,
  avg_coverage_pct numeric,
  helpful_count integer,
  partial_count integer,
  unhelpful_count integer,
  rating_score numeric,
  lock_blocked integer,
  lock_conversions integer,
  last_run_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(hours => GREATEST(p_window_hours, 1));
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT r.workflow_id, r.status, r.latency_ms, r.sections_coverage_pct,
           r.user_rating, r.user_id, r.error_reason, r.created_at, r.tier_at_run
    FROM public.berufs_ki_workflow_runs r
    WHERE r.created_at >= v_since
  ),
  agg AS (
    SELECT
      b.workflow_id,
      COUNT(*)::int AS runs_window,
      COUNT(*) FILTER (WHERE b.status = 'ok')::int AS ok_runs,
      COUNT(*) FILTER (WHERE b.status = 'error')::int AS error_runs,
      COUNT(*) FILTER (WHERE b.status = 'blocked')::int AS blocked_runs,
      COUNT(*) FILTER (WHERE b.status = 'rate_limited')::int AS rate_limited_runs,
      AVG(b.latency_ms) FILTER (WHERE b.status = 'ok')::numeric AS avg_latency_ms,
      AVG(b.sections_coverage_pct) FILTER (WHERE b.status = 'ok')::numeric AS avg_coverage_pct,
      COUNT(*) FILTER (WHERE b.user_rating = 1)::int AS helpful_count,
      COUNT(*) FILTER (WHERE b.user_rating = 0)::int AS partial_count,
      COUNT(*) FILTER (WHERE b.user_rating = -1)::int AS unhelpful_count,
      COUNT(*) FILTER (WHERE b.status = 'blocked' AND b.error_reason LIKE 'tier%')::int AS lock_blocked,
      MAX(b.created_at) AS last_run_at
    FROM base b
    GROUP BY b.workflow_id
  ),
  conv AS (
    -- users who hit a lock and later ran any pro/business workflow successfully
    SELECT b.workflow_id,
           COUNT(DISTINCT b.user_id) FILTER (
             WHERE b.status = 'blocked'
               AND EXISTS (
                 SELECT 1 FROM public.berufs_ki_workflow_runs r2
                 WHERE r2.user_id = b.user_id
                   AND r2.status = 'ok'
                   AND r2.tier_at_run IN ('pro','business')
                   AND r2.created_at > b.created_at
               )
           )::int AS lock_conversions
    FROM base b
    GROUP BY b.workflow_id
  )
  SELECT
    d.id, d.slug, d.title, d.category, d.tier_required, d.is_active, d.version,
    COALESCE(a.runs_window, 0),
    COALESCE(a.ok_runs, 0),
    COALESCE(a.error_runs, 0),
    COALESCE(a.blocked_runs, 0),
    COALESCE(a.rate_limited_runs, 0),
    CASE WHEN COALESCE(a.runs_window,0) > 0
         THEN ROUND(a.ok_runs::numeric / a.runs_window, 4) ELSE 0 END,
    CASE WHEN COALESCE(a.runs_window,0) > 0
         THEN ROUND(a.error_runs::numeric / a.runs_window, 4) ELSE 0 END,
    ROUND(COALESCE(a.avg_latency_ms, 0), 0),
    ROUND(COALESCE(a.avg_coverage_pct, 0), 1),
    COALESCE(a.helpful_count, 0),
    COALESCE(a.partial_count, 0),
    COALESCE(a.unhelpful_count, 0),
    CASE WHEN COALESCE(a.helpful_count,0)+COALESCE(a.partial_count,0)+COALESCE(a.unhelpful_count,0) > 0
         THEN ROUND(
           (COALESCE(a.helpful_count,0) - COALESCE(a.unhelpful_count,0))::numeric
           / NULLIF(a.helpful_count+a.partial_count+a.unhelpful_count, 0)
         , 3)
         ELSE NULL END,
    COALESCE(a.lock_blocked, 0),
    COALESCE(c.lock_conversions, 0),
    a.last_run_at
  FROM public.berufs_ki_workflow_definitions d
  LEFT JOIN agg a ON a.workflow_id = d.id
  LEFT JOIN conv c ON c.workflow_id = d.id
  ORDER BY COALESCE(a.runs_window, 0) DESC, d.title;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_berufs_ki_quality_dashboard(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_quality_dashboard(integer) TO authenticated;
