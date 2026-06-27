
-- STORE.OPS.PREDICTION.OS.1 — append-only prediction storage.

CREATE TABLE IF NOT EXISTS public.store_ops_prediction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  operation_key text NOT NULL,
  planned_action_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  expected_manifest_count integer NOT NULL DEFAULT 0,
  planned_mode text,
  success_probability numeric NOT NULL DEFAULT 0,
  expected_failures integer NOT NULL DEFAULT 0,
  expected_blocked integer NOT NULL DEFAULT 0,
  expected_succeeded integer NOT NULL DEFAULT 0,
  expected_duration_seconds integer NOT NULL DEFAULT 0,
  expected_manual_interventions integer NOT NULL DEFAULT 0,
  queue_load_factor numeric NOT NULL DEFAULT 0,
  risk_total integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'low',
  risk_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score numeric NOT NULL DEFAULT 0,
  confidence_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  explainability jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_ops_prediction_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.store_ops_prediction_runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  key text NOT NULL,
  value_numeric numeric,
  value_text text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_ops_prediction_runs_evaluated_at
  ON public.store_ops_prediction_runs (evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_ops_prediction_results_run_id
  ON public.store_ops_prediction_results (run_id);
CREATE INDEX IF NOT EXISTS idx_store_ops_prediction_results_kind
  ON public.store_ops_prediction_results (kind);

GRANT SELECT ON public.store_ops_prediction_runs TO authenticated;
GRANT SELECT ON public.store_ops_prediction_results TO authenticated;
GRANT ALL ON public.store_ops_prediction_runs TO service_role;
GRANT ALL ON public.store_ops_prediction_results TO service_role;

ALTER TABLE public.store_ops_prediction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_ops_prediction_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_ops_prediction_runs admin read"
  ON public.store_ops_prediction_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "store_ops_prediction_results admin read"
  ON public.store_ops_prediction_results
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Append-only enforcement: block UPDATE and DELETE on both tables.
CREATE OR REPLACE FUNCTION public.fn_store_ops_prediction_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'store_ops_prediction_% is append-only', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_store_ops_prediction_runs_no_mutation
  ON public.store_ops_prediction_runs;
CREATE TRIGGER trg_store_ops_prediction_runs_no_mutation
  BEFORE UPDATE OR DELETE ON public.store_ops_prediction_runs
  FOR EACH ROW EXECUTE FUNCTION public.fn_store_ops_prediction_no_mutation();

DROP TRIGGER IF EXISTS trg_store_ops_prediction_results_no_mutation
  ON public.store_ops_prediction_results;
CREATE TRIGGER trg_store_ops_prediction_results_no_mutation
  BEFORE UPDATE OR DELETE ON public.store_ops_prediction_results
  FOR EACH ROW EXECUTE FUNCTION public.fn_store_ops_prediction_no_mutation();
