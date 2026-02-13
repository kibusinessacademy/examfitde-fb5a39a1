
-- ====================================================================
-- Dominance Operating System (DOS) – Database Layer
-- ====================================================================

-- 1) Cluster definitions
CREATE TABLE IF NOT EXISTS public.market_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  example_occupations text[],
  max_active_dominance boolean DEFAULT false,
  wave_number int DEFAULT 0,
  seo_visibility_score numeric DEFAULT 0,
  competition_benchmark int DEFAULT 400,
  authority_question_strategy text, -- e.g. 'praxis_cases', 'scenario_based', 'regulatory_depth'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.market_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_market_clusters" ON public.market_clusters FOR ALL USING (true);

-- Seed the 6 macro clusters
INSERT INTO public.market_clusters (slug, label, example_occupations, wave_number, authority_question_strategy) VALUES
  ('handel', 'Handel', ARRAY['Einzelhandelskaufmann', 'Großhandelskaufmann', 'Verkäufer'], 1, 'praxis_cases'),
  ('industrie', 'Industrie', ARRAY['Industriekaufmann', 'Mechatroniker', 'Industriemechaniker'], 3, 'process_scenarios'),
  ('it', 'IT', ARRAY['Fachinformatiker', 'IT-Systemkaufmann', 'IT-Systemelektroniker'], 1, 'scenario_based'),
  ('finanzen', 'Finanzen', ARRAY['Bankkaufmann', 'Versicherungskaufmann', 'Steuerfachangestellter'], 2, 'regulatory_depth'),
  ('gesundheit', 'Gesundheit', ARRAY['MFA', 'Zahnmedizinische FA', 'Pflegefachkraft'], 3, 'clinical_cases'),
  ('verwaltung', 'Verwaltung', ARRAY['Büromanagement', 'Verwaltungsfachangestellter'], 2, 'administrative_processes')
ON CONFLICT (slug) DO NOTHING;

-- 2) Link portfolio_priority to clusters
ALTER TABLE public.portfolio_priority
  ADD COLUMN IF NOT EXISTS cluster_id uuid REFERENCES public.market_clusters(id),
  ADD COLUMN IF NOT EXISTS expansion_priority numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS question_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seo_ranking_score numeric DEFAULT 0;

-- 3) Cluster dominance snapshots (history)
CREATE TABLE IF NOT EXISTS public.cluster_dominance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid REFERENCES public.market_clusters(id),
  cds numeric NOT NULL DEFAULT 0,
  market_coverage numeric DEFAULT 0,
  avg_authority_index numeric DEFAULT 0,
  revenue_share numeric DEFAULT 0,
  seo_visibility numeric DEFAULT 0,
  competition_diff numeric DEFAULT 0,
  total_berufe int DEFAULT 0,
  covered_optimize int DEFAULT 0,
  covered_authority int DEFAULT 0,
  dominance_level text DEFAULT 'aufbau',
  snapshot_at timestamptz DEFAULT now()
);
ALTER TABLE public.cluster_dominance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_cds_snapshots" ON public.cluster_dominance_snapshots FOR ALL USING (true);

-- 4) Dominance control (global settings)
CREATE TABLE IF NOT EXISTS public.dominance_control (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active boolean DEFAULT true,
  max_active_dominance_clusters int DEFAULT 2,
  max_cluster_revenue_share numeric DEFAULT 45,
  dominance_thresholds jsonb DEFAULT '{"aufbau":0,"wettbewerbsfaehig":50,"marktfuehrer":70,"dominant":85}'::jsonb,
  expansion_weights jsonb DEFAULT '{"completion_gap":0.40,"demand":0.30,"competition_weakness":0.20,"synergy":0.10}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.dominance_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_dominance_control" ON public.dominance_control FOR ALL USING (true);

INSERT INTO public.dominance_control (is_active) VALUES (true) ON CONFLICT DO NOTHING;

-- 5) RPC: calculate cluster dominance scores
CREATE OR REPLACE FUNCTION public.evaluate_cluster_dominance()
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_cluster record;
  v_results jsonb := '[]'::jsonb;
  v_total_revenue numeric;
  v_cds numeric;
  v_market_coverage numeric;
  v_avg_auth numeric;
  v_rev_share numeric;
  v_seo numeric;
  v_comp_diff numeric;
  v_total int;
  v_opt int;
  v_auth int;
  v_level text;
  v_balance_warnings jsonb := '[]'::jsonb;
  v_max_rev_share numeric;
BEGIN
  -- Get total revenue across all portfolio
  SELECT COALESCE(SUM(revenue_monthly), 0) INTO v_total_revenue FROM portfolio_priority;
  SELECT COALESCE(max_cluster_revenue_share, 45) INTO v_max_rev_share FROM dominance_control WHERE is_active LIMIT 1;

  FOR v_cluster IN SELECT * FROM market_clusters ORDER BY wave_number, slug LOOP
    -- Count berufe in cluster
    SELECT 
      COUNT(*),
      COUNT(*) FILTER (WHERE authority_index >= 70),
      COUNT(*) FILTER (WHERE authority_index >= 93),
      COALESCE(AVG(authority_index), 0),
      COALESCE(SUM(revenue_monthly), 0),
      COALESCE(AVG(seo_ranking_score), 0),
      COALESCE(AVG(question_count), 0)
    INTO v_total, v_opt, v_auth, v_avg_auth, v_rev_share, v_seo, v_comp_diff
    FROM portfolio_priority WHERE cluster_id = v_cluster.id;

    -- Market coverage = optimize+ / total
    v_market_coverage := CASE WHEN v_total > 0 THEN ROUND(v_opt::numeric / v_total * 100) ELSE 0 END;

    -- Revenue share as % of total
    v_rev_share := CASE WHEN v_total_revenue > 0 THEN ROUND(v_rev_share / v_total_revenue * 100, 1) ELSE 0 END;

    -- Competition diff: avg questions vs benchmark
    v_comp_diff := LEAST(100, CASE WHEN v_cluster.competition_benchmark > 0
      THEN ROUND(v_comp_diff / v_cluster.competition_benchmark * 100)
      ELSE 0 END);

    -- SEO visibility capped at 100
    v_seo := LEAST(100, v_seo);

    -- CDS formula
    v_cds := ROUND(
      0.30 * v_market_coverage
      + 0.25 * LEAST(v_avg_auth, 100)
      + 0.20 * LEAST(v_rev_share * 5, 100)  -- scale revenue share
      + 0.15 * v_seo
      + 0.10 * v_comp_diff
    );

    -- Dominance level
    v_level := CASE
      WHEN v_cds >= 85 THEN 'dominant'
      WHEN v_cds >= 70 THEN 'marktfuehrer'
      WHEN v_cds >= 50 THEN 'wettbewerbsfaehig'
      ELSE 'aufbau'
    END;

    -- Snapshot
    INSERT INTO cluster_dominance_snapshots (cluster_id, cds, market_coverage, avg_authority_index, revenue_share, seo_visibility, competition_diff, total_berufe, covered_optimize, covered_authority, dominance_level)
    VALUES (v_cluster.id, v_cds, v_market_coverage, v_avg_auth, v_rev_share, v_seo, v_comp_diff, v_total, v_opt, v_auth, v_level);

    -- Balance warning
    IF v_rev_share > v_max_rev_share THEN
      v_balance_warnings := v_balance_warnings || jsonb_build_object('cluster', v_cluster.label, 'revenue_share', v_rev_share, 'max', v_max_rev_share);
    END IF;

    v_results := v_results || jsonb_build_object(
      'cluster_id', v_cluster.id,
      'slug', v_cluster.slug,
      'label', v_cluster.label,
      'wave', v_cluster.wave_number,
      'strategy', v_cluster.authority_question_strategy,
      'cds', v_cds,
      'level', v_level,
      'market_coverage', v_market_coverage,
      'avg_authority', ROUND(v_avg_auth),
      'revenue_share', v_rev_share,
      'seo_visibility', v_seo,
      'competition_diff', v_comp_diff,
      'total', v_total,
      'optimize', v_opt,
      'authority', v_auth,
      'is_active_wave', v_cluster.max_active_dominance
    );
  END LOOP;

  -- Expansion priorities
  UPDATE portfolio_priority pp SET expansion_priority = ROUND(
    0.40 * (100 - COALESCE(pp.authority_index, 0))  -- completion gap
    + 0.30 * COALESCE(pp.demand_score, 0)
    + 0.20 * (100 - COALESCE(pp.competition_score, 0))
    + 0.10 * 50  -- synergy placeholder
  ) WHERE pp.cluster_id IS NOT NULL;

  RETURN jsonb_build_object(
    'clusters', v_results,
    'balance_warnings', v_balance_warnings,
    'total_revenue', v_total_revenue
  );
END;
$$;
