
-- Council 7: Growth / CRM / Customer Success

-- Types (idempotent)
DO $$ BEGIN
  CREATE TYPE public.growth_action_status AS ENUM ('proposed','approved','sent','dismissed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.growth_action_type AS ENUM ('nudge_email','in_app_nudge','b2b_admin_nudge','survey','winback','upsell','adoption_tip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Risk scores
CREATE TABLE IF NOT EXISTS public.growth_risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  enterprise_account_id uuid NULL,
  score numeric NOT NULL DEFAULT 0,
  label text NOT NULL DEFAULT 'low',
  signals_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, enterprise_account_id)
);

-- 2) Recommended actions
CREATE TABLE IF NOT EXISTS public.growth_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type public.growth_action_type NOT NULL,
  target_user_id uuid NULL,
  enterprise_account_id uuid NULL,
  title text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.growth_action_status NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_actions_status
ON public.growth_actions(status, created_at DESC);

-- 3) Signal views
CREATE OR REPLACE VIEW public.v_user_last_activity AS
SELECT user_id, max(created_at) AS last_activity_at
FROM public.user_activity_log GROUP BY user_id;

CREATE OR REPLACE VIEW public.v_user_entitlement_count AS
SELECT user_id, count(*) AS entitlement_count
FROM public.entitlements GROUP BY user_id;

-- 4) RLS (using is_admin_user)
ALTER TABLE public.growth_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all_growth_risk_scores ON public.growth_risk_scores FOR ALL USING (false);
CREATE POLICY admin_all_growth_risk_scores ON public.growth_risk_scores FOR ALL USING (is_admin_user(auth.uid()));
CREATE POLICY deny_all_growth_actions ON public.growth_actions FOR ALL USING (false);
CREATE POLICY admin_all_growth_actions ON public.growth_actions FOR ALL USING (is_admin_user(auth.uid()));

-- 5) USER candidates RPC
CREATE OR REPLACE FUNCTION public.growth_user_candidates(
  p_cutoff timestamptz, p_limit int DEFAULT 50
)
RETURNS TABLE (user_id uuid, last_activity_at timestamptz, days_inactive int, entitlement_count int)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH ent AS (
    SELECT user_id, count(*)::int AS entitlement_count FROM public.entitlements GROUP BY user_id
  ),
  act AS (
    SELECT user_id, max(created_at) AS last_activity_at FROM public.user_activity_log GROUP BY user_id
  )
  SELECT e.user_id, a.last_activity_at,
    COALESCE(EXTRACT(day FROM (now() - a.last_activity_at))::int, 9999) AS days_inactive,
    e.entitlement_count
  FROM ent e LEFT JOIN act a ON a.user_id = e.user_id
  WHERE COALESCE(a.last_activity_at, '1970-01-01'::timestamptz) < p_cutoff
  ORDER BY days_inactive DESC LIMIT p_limit;
$$;

-- 6) ENTERPRISE candidates RPC
CREATE OR REPLACE FUNCTION public.growth_enterprise_candidates(p_limit int DEFAULT 50)
RETURNS TABLE (enterprise_account_id uuid, seats_total int, seats_claimed int, adoption_rate numeric)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH pkg_seats AS (
    SELECT lp.company_id AS enterprise_account_id,
      count(ls.id)::int AS seats_total,
      count(ls.assigned_at)::int AS seats_claimed
    FROM public.license_packages lp
    JOIN public.license_seats ls ON ls.package_id = lp.id
    WHERE lp.company_id IS NOT NULL GROUP BY lp.company_id
  )
  SELECT s.enterprise_account_id, s.seats_total, s.seats_claimed,
    CASE WHEN s.seats_total = 0 THEN 0 ELSE (s.seats_claimed::numeric / s.seats_total::numeric) END AS adoption_rate
  FROM pkg_seats s ORDER BY adoption_rate ASC, seats_total DESC LIMIT p_limit;
$$;
