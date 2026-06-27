
CREATE TABLE IF NOT EXISTS public.course_profitability_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  product_id uuid NOT NULL,
  product_title text,
  product_slug text,
  window_days integer NOT NULL DEFAULT 90,
  units_sold integer NOT NULL DEFAULT 0,
  gross_revenue_cents bigint NOT NULL DEFAULT 0,
  stripe_fees_cents bigint NOT NULL DEFAULT 0,
  refunds_cents bigint NOT NULL DEFAULT 0,
  net_revenue_cents bigint NOT NULL DEFAULT 0,
  ai_cost_cents bigint NOT NULL DEFAULT 0,
  build_cost_cents bigint NOT NULL DEFAULT 0,
  overhead_cents bigint NOT NULL DEFAULT 0,
  total_cost_cents bigint NOT NULL DEFAULT 0,
  margin_cents bigint NOT NULL DEFAULT 0,
  margin_ratio numeric,
  payback_units integer,
  class text NOT NULL,
  recommendation_code text NOT NULL,
  recommendation_reason text,
  confidence numeric NOT NULL DEFAULT 0,
  inputs_hash text NOT NULL,
  evaluator_version text NOT NULL DEFAULT 'course-profit-os-1.0.0',
  cost_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  revenue_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cps_product ON public.course_profitability_snapshots(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cps_class ON public.course_profitability_snapshots(class, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cps_inputs_hash ON public.course_profitability_snapshots(inputs_hash);

GRANT SELECT ON public.course_profitability_snapshots TO authenticated;
GRANT ALL ON public.course_profitability_snapshots TO service_role;

ALTER TABLE public.course_profitability_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read course profitability"
  ON public.course_profitability_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Append-only guard: block UPDATE/DELETE outside service_role
CREATE OR REPLACE FUNCTION public.fn_course_profit_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'course_profitability_snapshots is append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cps_no_update ON public.course_profitability_snapshots;
CREATE TRIGGER trg_cps_no_update
  BEFORE UPDATE OR DELETE ON public.course_profitability_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.fn_course_profit_no_mutation();
