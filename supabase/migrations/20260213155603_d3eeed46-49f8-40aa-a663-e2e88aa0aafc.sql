
-- ═══════════════════════════════════════════════════════════════
-- Certification Cost Ledger: Unit Economics Engine
-- ═══════════════════════════════════════════════════════════════

-- 1) Job-level cost tracking
CREATE TABLE IF NOT EXISTS public.job_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  job_type text NOT NULL,
  provider text NOT NULL,
  tokens_input int NOT NULL DEFAULT 0,
  tokens_output int NOT NULL DEFAULT 0,
  cost_eur numeric(10,6) NOT NULL DEFAULT 0,
  package_id uuid,
  certification_id uuid,
  curriculum_id uuid,
  latency_ms int,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_costs_package ON public.job_costs(package_id);
CREATE INDEX idx_job_costs_certification ON public.job_costs(certification_id);
CREATE INDEX idx_job_costs_created ON public.job_costs(created_at);
CREATE INDEX idx_job_costs_job_type ON public.job_costs(job_type);

ALTER TABLE public.job_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on job_costs" ON public.job_costs FOR ALL USING (true);

-- 2) Certification cost snapshots (frozen at publish time)
CREATE TABLE IF NOT EXISTS public.certification_cost_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid,
  package_id uuid,
  curriculum_id uuid,
  certification_name text,
  publish_version int DEFAULT 1,
  total_cost_eur numeric(10,2) NOT NULL DEFAULT 0,
  cost_exam_generation numeric(10,2) DEFAULT 0,
  cost_oral_generation numeric(10,2) DEFAULT 0,
  cost_handbook numeric(10,2) DEFAULT 0,
  cost_qa numeric(10,2) DEFAULT 0,
  cost_other numeric(10,2) DEFAULT 0,
  total_questions int DEFAULT 0,
  total_orals int DEFAULT 0,
  total_domains int DEFAULT 0,
  total_tokens_input int DEFAULT 0,
  total_tokens_output int DEFAULT 0,
  governance_score numeric(5,2),
  coverage_pct numeric(5,2),
  selling_price_eur numeric(10,2),
  break_even_sales int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cert_snapshots_cert ON public.certification_cost_snapshots(certification_id);
CREATE INDEX idx_cert_snapshots_package ON public.certification_cost_snapshots(package_id);
ALTER TABLE public.certification_cost_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on cert_cost_snapshots" ON public.certification_cost_snapshots FOR ALL USING (true);

-- 3) Live aggregation view
CREATE OR REPLACE VIEW public.certification_cost_summary AS
SELECT
  jc.package_id,
  jc.certification_id,
  jc.curriculum_id,
  COALESCE(cp.title, jc.package_id::text) AS certification_name,
  COUNT(*) AS total_jobs,
  SUM(jc.cost_eur)::numeric(10,2) AS total_cost_eur,
  SUM(jc.tokens_input) AS total_tokens_input,
  SUM(jc.tokens_output) AS total_tokens_output,
  SUM(CASE WHEN jc.job_type IN ('package_generate_exam_pool','seed_exam_questions','generate_blueprint_questions','assessment_questions_generate') THEN jc.cost_eur ELSE 0 END)::numeric(10,2) AS cost_exam_generation,
  SUM(CASE WHEN jc.job_type IN ('package_generate_oral_exam','tutor_oral_exam_propose') THEN jc.cost_eur ELSE 0 END)::numeric(10,2) AS cost_oral_generation,
  SUM(CASE WHEN jc.job_type IN ('package_generate_handbook') THEN jc.cost_eur ELSE 0 END)::numeric(10,2) AS cost_handbook,
  SUM(CASE WHEN jc.job_type IN ('qc_worker_full','quality_gate_7','run_quality_checks','package_run_integrity_check') THEN jc.cost_eur ELSE 0 END)::numeric(10,2) AS cost_qa,
  SUM(CASE WHEN jc.job_type NOT IN ('package_generate_exam_pool','seed_exam_questions','generate_blueprint_questions','assessment_questions_generate','package_generate_oral_exam','tutor_oral_exam_propose','package_generate_handbook','qc_worker_full','quality_gate_7','run_quality_checks','package_run_integrity_check') THEN jc.cost_eur ELSE 0 END)::numeric(10,2) AS cost_other,
  MIN(jc.created_at) AS first_cost_at,
  MAX(jc.created_at) AS last_cost_at
FROM public.job_costs jc
LEFT JOIN public.course_packages cp ON cp.id = jc.package_id
GROUP BY jc.package_id, jc.certification_id, jc.curriculum_id, COALESCE(cp.title, jc.package_id::text);

-- 4) Provider pricing reference
CREATE TABLE IF NOT EXISTS public.provider_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  price_input_per_1k numeric(10,6) NOT NULL DEFAULT 0,
  price_output_per_1k numeric(10,6) NOT NULL DEFAULT 0,
  currency text DEFAULT 'EUR',
  effective_from date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(provider, model, effective_from)
);

INSERT INTO public.provider_pricing (provider, model, price_input_per_1k, price_output_per_1k) VALUES
  ('openai', 'gpt-4o', 0.0025, 0.01),
  ('openai', 'gpt-4o-mini', 0.00015, 0.0006),
  ('openai', 'gpt-4.1', 0.002, 0.008),
  ('openai', 'gpt-4.1-mini', 0.0004, 0.0016),
  ('anthropic', 'claude-sonnet-4-20250514', 0.003, 0.015),
  ('anthropic', 'claude-3-5-haiku-20241022', 0.0008, 0.004),
  ('google', 'gemini-2.5-flash', 0.00015, 0.0006),
  ('google', 'gemini-2.5-pro', 0.00125, 0.01)
ON CONFLICT DO NOTHING;

ALTER TABLE public.provider_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on provider_pricing" ON public.provider_pricing FOR ALL USING (true);

-- 5) Function to log job cost
CREATE OR REPLACE FUNCTION public.log_job_cost(
  p_job_id uuid,
  p_job_type text,
  p_provider text,
  p_tokens_input int DEFAULT 0,
  p_tokens_output int DEFAULT 0,
  p_cost_eur numeric DEFAULT NULL,
  p_package_id uuid DEFAULT NULL,
  p_certification_id uuid DEFAULT NULL,
  p_curriculum_id uuid DEFAULT NULL,
  p_latency_ms int DEFAULT NULL,
  p_model text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cost numeric;
  v_id uuid;
BEGIN
  IF p_cost_eur IS NULL AND p_model IS NOT NULL THEN
    SELECT (p_tokens_input * pp.price_input_per_1k / 1000.0) + (p_tokens_output * pp.price_output_per_1k / 1000.0)
    INTO v_cost
    FROM provider_pricing pp
    WHERE pp.provider = p_provider AND pp.model = p_model
    ORDER BY pp.effective_from DESC LIMIT 1;
  END IF;
  
  v_cost := COALESCE(p_cost_eur, v_cost, 0);
  
  INSERT INTO job_costs (job_id, job_type, provider, tokens_input, tokens_output, cost_eur, package_id, certification_id, curriculum_id, latency_ms, model)
  VALUES (p_job_id, p_job_type, p_provider, p_tokens_input, p_tokens_output, v_cost, p_package_id, p_certification_id, p_curriculum_id, p_latency_ms, p_model)
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- 6) Snapshot function at publish
CREATE OR REPLACE FUNCTION public.snapshot_certification_cost(
  p_package_id uuid,
  p_certification_id uuid DEFAULT NULL,
  p_selling_price numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_total_cost numeric;
  v_cost_exam numeric;
  v_cost_oral numeric;
  v_cost_handbook numeric;
  v_cost_qa numeric;
  v_cost_other numeric;
  v_tokens_in int;
  v_tokens_out int;
  v_questions int;
  v_domains int;
  v_version int;
  v_name text;
BEGIN
  SELECT 
    COALESCE(SUM(cost_eur),0), 
    COALESCE(SUM(tokens_input),0), 
    COALESCE(SUM(tokens_output),0),
    COALESCE(SUM(CASE WHEN job_type IN ('package_generate_exam_pool','seed_exam_questions') THEN cost_eur ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN job_type IN ('package_generate_oral_exam') THEN cost_eur ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN job_type IN ('package_generate_handbook') THEN cost_eur ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN job_type IN ('qc_worker_full','quality_gate_7') THEN cost_eur ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN job_type NOT IN ('package_generate_exam_pool','seed_exam_questions','package_generate_oral_exam','package_generate_handbook','qc_worker_full','quality_gate_7') THEN cost_eur ELSE 0 END),0)
  INTO v_total_cost, v_tokens_in, v_tokens_out, v_cost_exam, v_cost_oral, v_cost_handbook, v_cost_qa, v_cost_other
  FROM job_costs WHERE package_id = p_package_id;
  
  SELECT COUNT(*) INTO v_questions FROM exam_questions eq
    JOIN course_packages cp ON cp.curriculum_id = eq.curriculum_id
    WHERE cp.id = p_package_id;
  
  SELECT COUNT(DISTINCT eq.learning_field_id) INTO v_domains FROM exam_questions eq
    JOIN course_packages cp ON cp.curriculum_id = eq.curriculum_id
    WHERE cp.id = p_package_id;

  SELECT COALESCE(MAX(publish_version), 0) + 1 INTO v_version FROM certification_cost_snapshots WHERE package_id = p_package_id;
  SELECT title INTO v_name FROM course_packages WHERE id = p_package_id;
  
  INSERT INTO certification_cost_snapshots (
    certification_id, package_id, certification_name, publish_version,
    total_cost_eur, cost_exam_generation, cost_oral_generation, cost_handbook, cost_qa, cost_other,
    total_questions, total_domains,
    total_tokens_input, total_tokens_output,
    selling_price_eur, break_even_sales
  ) VALUES (
    p_certification_id, p_package_id, v_name, v_version,
    v_total_cost, v_cost_exam, v_cost_oral, v_cost_handbook, v_cost_qa, v_cost_other,
    v_questions, v_domains, v_tokens_in, v_tokens_out,
    p_selling_price,
    CASE WHEN COALESCE(p_selling_price,0) > 0 THEN CEIL(v_total_cost / p_selling_price) ELSE NULL END
  ) RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;
