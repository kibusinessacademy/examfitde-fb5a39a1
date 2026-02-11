
-- Council 7 Phase 1 (repo-compatible): Growth / CRM / Kundenbindung

-- Drop old views/functions from previous attempt
DROP VIEW IF EXISTS public.v_user_last_activity;
DROP VIEW IF EXISTS public.v_user_entitlement_count;
DROP FUNCTION IF EXISTS public.growth_user_candidates(timestamptz, int);
DROP FUNCTION IF EXISTS public.growth_enterprise_candidates(int);

-- Types (idempotent)
DO $$ BEGIN
  CREATE TYPE public.growth_action_status AS ENUM ('proposed','approved','sent','dismissed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.growth_action_type AS ENUM ('in_app_nudge','b2b_admin_nudge','survey','winback','upsell','adoption_tip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Risk scores (user-level)
DROP TABLE IF EXISTS public.growth_risk_scores CASCADE;
CREATE TABLE public.growth_risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score numeric NOT NULL DEFAULT 0,
  label text NOT NULL DEFAULT 'low',
  signals_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- 2) Actions table
DROP TABLE IF EXISTS public.growth_actions CASCADE;
CREATE TABLE public.growth_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type public.growth_action_type NOT NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.growth_action_status NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_growth_actions_status ON public.growth_actions(status, created_at DESC);

-- 3) RLS
ALTER TABLE public.growth_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all_growth_risk_scores ON public.growth_risk_scores FOR ALL USING (false);
CREATE POLICY admin_all_growth_risk_scores ON public.growth_risk_scores FOR ALL USING (is_admin_user(auth.uid()));

CREATE POLICY deny_all_growth_actions ON public.growth_actions FOR ALL USING (false);
CREATE POLICY admin_all_growth_actions ON public.growth_actions FOR ALL USING (is_admin_user(auth.uid()));

-- 4) Candidate RPC: course_enrollments + learning_progress (SSOT)
CREATE OR REPLACE FUNCTION public.growth_user_candidates(
  p_cutoff timestamptz,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  user_id uuid,
  last_accessed_at timestamptz,
  last_progress_at timestamptz,
  days_inactive int,
  lessons_completed int
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH enroll AS (
    SELECT ce.user_id, max(ce.last_accessed_at) AS last_accessed_at
    FROM public.course_enrollments ce
    GROUP BY ce.user_id
  ),
  prog AS (
    SELECT lp.user_id, max(lp.updated_at) AS last_progress_at,
           count(*) FILTER (WHERE lp.completed = true) AS lessons_completed
    FROM public.learning_progress lp
    GROUP BY lp.user_id
  )
  SELECT
    e.user_id,
    e.last_accessed_at,
    p.last_progress_at,
    COALESCE(EXTRACT(day FROM (now() - COALESCE(e.last_accessed_at, p.last_progress_at, '1970-01-01'::timestamptz)))::int, 9999),
    COALESCE(p.lessons_completed, 0)::int
  FROM enroll e
  LEFT JOIN prog p ON p.user_id = e.user_id
  WHERE COALESCE(e.last_accessed_at, p.last_progress_at, '1970-01-01'::timestamptz) < p_cutoff
  ORDER BY 4 DESC
  LIMIT p_limit;
$$;
