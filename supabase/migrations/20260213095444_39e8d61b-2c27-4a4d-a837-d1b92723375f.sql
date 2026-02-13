
-- ============================================================
-- TOTAL COVERAGE STRATEGY (TCS) – Migration
-- Shifts from cluster-dominance to full-market coverage + authority layer
-- ============================================================

-- 1) Add coverage_level to portfolio_priority (base / optimize / authority)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_priority' AND column_name='coverage_level') THEN
    ALTER TABLE public.portfolio_priority ADD COLUMN coverage_level text NOT NULL DEFAULT 'base';
  END IF;
END $$;

-- 2) Add coverage_priority formula column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_priority' AND column_name='coverage_priority') THEN
    ALTER TABLE public.portfolio_priority ADD COLUMN coverage_priority numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 3) Add publish gate thresholds per level
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portfolio_priority' AND column_name='min_confidence_for_level') THEN
    ALTER TABLE public.portfolio_priority ADD COLUMN min_confidence_for_level numeric NOT NULL DEFAULT 75;
  END IF;
END $$;

-- 4) Update rollout_control with TCS-specific fields
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rollout_control' AND column_name='strategy') THEN
    ALTER TABLE public.rollout_control ADD COLUMN strategy text NOT NULL DEFAULT 'total_coverage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rollout_control' AND column_name='base_exam_target') THEN
    ALTER TABLE public.rollout_control ADD COLUMN base_exam_target integer NOT NULL DEFAULT 600;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rollout_control' AND column_name='min_lf_coverage_base') THEN
    ALTER TABLE public.rollout_control ADD COLUMN min_lf_coverage_base numeric NOT NULL DEFAULT 85;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rollout_control' AND column_name='coverage_target_pct') THEN
    ALTER TABLE public.rollout_control ADD COLUMN coverage_target_pct numeric NOT NULL DEFAULT 95;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rollout_control' AND column_name='max_authority_slots') THEN
    ALTER TABLE public.rollout_control ADD COLUMN max_authority_slots integer NOT NULL DEFAULT 20;
  END IF;
END $$;

-- 5) Update existing ship_level_config default to include 'base'
UPDATE public.rollout_control
SET ship_level_config = '{"base": 600, "optimize": 850, "authority": 1200}'::jsonb
WHERE ship_level_config->>'base' IS NULL;

-- 6) RPC: recalculate_coverage_priorities
-- Uses: 0.35 * completion_gap + 0.25 * demand + 0.20 * revenue + 0.10 * competition_weakness + 0.10 * synergy
CREATE OR REPLACE FUNCTION public.recalculate_coverage_priorities()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  r record;
BEGIN
  FOR r IN SELECT * FROM portfolio_priority LOOP
    DECLARE
      v_completion_gap numeric;
      v_comp_weakness numeric;
      v_synergy numeric;
      v_cov_priority numeric;
      v_level text;
      v_min_conf numeric;
      v_exam_target integer;
    BEGIN
      -- completion_gap: inverse of completion (higher gap = higher priority)
      v_completion_gap := CASE r.completion_status
        WHEN 'published' THEN 5
        WHEN 'integrity_passed' THEN 20
        WHEN 'building' THEN 60
        WHEN 'queued' THEN 80
        ELSE 100
      END;

      v_comp_weakness := GREATEST(0, 100 - COALESCE(r.competition_score, 50));
      v_synergy := LEAST(100, COALESCE(r.demand_score, 50) * 0.5 + (100 - COALESCE(r.competition_score, 50)) * 0.5);

      v_cov_priority := ROUND(
        0.35 * v_completion_gap +
        0.25 * COALESCE(r.demand_score, 50) +
        0.20 * COALESCE(r.revenue_potential_score, 50) +
        0.10 * v_comp_weakness +
        0.10 * v_synergy
      , 1);

      -- Determine coverage level based on authority_index
      v_level := CASE
        WHEN COALESCE(r.authority_index, 0) >= 93 THEN 'authority'
        WHEN COALESCE(r.authority_index, 0) >= 70 THEN 'optimize'
        ELSE 'base'
      END;

      -- Staffed publish gate
      v_min_conf := CASE v_level
        WHEN 'authority' THEN 85
        WHEN 'optimize' THEN 80
        ELSE 75
      END;

      v_exam_target := CASE v_level
        WHEN 'authority' THEN 1200
        WHEN 'optimize' THEN 850
        ELSE 600
      END;

      UPDATE portfolio_priority SET
        coverage_priority = v_cov_priority,
        coverage_level = v_level,
        min_confidence_for_level = v_min_conf,
        exam_target = v_exam_target,
        updated_at = now()
      WHERE id = r.id;

      v_updated := v_updated + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

-- 7) RPC: get_coverage_stats – returns TCS dashboard data
CREATE OR REPLACE FUNCTION public.get_coverage_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_base integer;
  v_optimize integer;
  v_authority integer;
  v_not_started integer;
  v_coverage_pct numeric;
  v_ctrl record;
BEGIN
  SELECT count(*) INTO v_total FROM portfolio_priority;
  SELECT count(*) FILTER (WHERE coverage_level = 'base' AND completion_status NOT IN ('not_started','planning')) INTO v_base FROM portfolio_priority;
  SELECT count(*) FILTER (WHERE coverage_level = 'optimize') INTO v_optimize FROM portfolio_priority;
  SELECT count(*) FILTER (WHERE coverage_level = 'authority') INTO v_authority FROM portfolio_priority;
  SELECT count(*) FILTER (WHERE completion_status IN ('not_started','planning')) INTO v_not_started FROM portfolio_priority;

  v_coverage_pct := CASE WHEN v_total > 0 THEN ROUND(((v_total - v_not_started)::numeric / v_total) * 100, 1) ELSE 0 END;

  SELECT * INTO v_ctrl FROM rollout_control WHERE is_active = true LIMIT 1;

  RETURN jsonb_build_object(
    'total_berufe', v_total,
    'base_covered', v_base,
    'optimize_covered', v_optimize,
    'authority_covered', v_authority,
    'not_started', v_not_started,
    'coverage_pct', v_coverage_pct,
    'target_pct', COALESCE(v_ctrl.coverage_target_pct, 95),
    'base_exam_target', COALESCE(v_ctrl.base_exam_target, 600),
    'max_authority_slots', COALESCE(v_ctrl.max_authority_slots, 20),
    'strategy', COALESCE(v_ctrl.strategy, 'total_coverage'),
    'levels', jsonb_build_object(
      'base', jsonb_build_object('exam_target', 600, 'min_confidence', 75, 'count', v_base + v_not_started),
      'optimize', jsonb_build_object('exam_target', 850, 'min_confidence', 80, 'count', v_optimize),
      'authority', jsonb_build_object('exam_target', 1200, 'min_confidence', 85, 'count', v_authority)
    )
  );
END;
$$;
