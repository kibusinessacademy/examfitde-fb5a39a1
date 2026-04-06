
-- Priority scoring results per package
CREATE TABLE public.priority_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  demand_score numeric NOT NULL DEFAULT 0,
  monetization_score numeric NOT NULL DEFAULT 0,
  pipeline_score numeric NOT NULL DEFAULT 0,
  reuse_score numeric NOT NULL DEFAULT 0,
  overall_score numeric NOT NULL DEFAULT 0,
  recommended_priority int NOT NULL DEFAULT 5,
  reasoning jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id)
);

ALTER TABLE public.priority_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage priority_scores" ON public.priority_scores
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Configurable scoring rules
CREATE TABLE public.priority_score_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  rule_type text NOT NULL DEFAULT 'keyword', -- keyword, track_bonus, threshold
  pattern text,        -- ILIKE pattern for keyword rules
  weight numeric NOT NULL DEFAULT 1.0,
  dimension text NOT NULL DEFAULT 'demand', -- demand, monetization, pipeline, reuse
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.priority_score_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage priority_score_rules" ON public.priority_score_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default scoring rules
INSERT INTO public.priority_score_rules (rule_key, rule_type, pattern, weight, dimension, description) VALUES
  -- Demand: IHK Core keywords
  ('demand_fachinformatiker', 'keyword', '%Fachinformatiker%', 10, 'demand', 'Core IT Ausbildung'),
  ('demand_industriekauf', 'keyword', '%Industriekauf%', 10, 'demand', 'Top kaufm. Ausbildung'),
  ('demand_bueromanagement', 'keyword', '%Büromanagement%', 10, 'demand', 'Top kaufm. Ausbildung'),
  ('demand_mechatroniker', 'keyword', '%Mechatroniker%', 9, 'demand', 'Core techn. Ausbildung'),
  ('demand_elektroniker', 'keyword', '%Elektroniker%', 8, 'demand', 'Techn. Ausbildung'),
  ('demand_lagerlogistik', 'keyword', '%Lagerlogistik%', 8, 'demand', 'Logistik Core'),
  ('demand_fachlagerist', 'keyword', '%Fachlagerist%', 7, 'demand', 'Logistik Einstieg'),
  ('demand_zerspanungsmech', 'keyword', '%Zerspanungsmechaniker%', 7, 'demand', 'Techn. Metall'),
  ('demand_berufskraftfahrer', 'keyword', '%Berufskraftfahrer%', 6, 'demand', 'Logistik / Transport'),
  -- Monetization: Fachwirte + §34
  ('monet_fachwirt', 'keyword', '%Fachwirt%', 9, 'monetization', 'Fortbildung, hohe Zahlungsbereitschaft'),
  ('monet_bilanzbuchhalter', 'keyword', '%Bilanzbuchhalter%', 9, 'monetization', 'Premium Fortbildung'),
  ('monet_meister', 'keyword', '%Meister%', 8, 'monetization', 'Meister-Fortbildung'),
  ('monet_34f', 'keyword', '%34f%', 8, 'monetization', '§34f Finanzanlagenvermittler'),
  ('monet_34i', 'keyword', '%34i%', 8, 'monetization', '§34i Immobiliardarlehensvermittler'),
  ('monet_34c', 'keyword', '%34c%', 7, 'monetization', '§34c Immobilienmakler'),
  ('monet_betriebswirt', 'keyword', '%Betriebswirt%', 9, 'monetization', 'Premium akademisch'),
  -- Track bonuses
  ('track_ausbildung_voll', 'track_bonus', 'AUSBILDUNG_VOLL', 3, 'reuse', 'Vollausbau = max Blueprint Reuse'),
  ('track_exam_first_plus', 'track_bonus', 'EXAM_FIRST_PLUS', 2, 'reuse', 'Schriftl. + Mündl.'),
  ('track_studium', 'track_bonus', 'STUDIUM', 2, 'reuse', 'Akademischer Track');

-- Core scoring function
CREATE OR REPLACE FUNCTION public.compute_priority_scores()
RETURNS TABLE(scored int, skipped int) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scored int := 0;
  v_skipped int := 0;
  pkg RECORD;
  rule RECORD;
  v_demand numeric;
  v_monet numeric;
  v_pipeline numeric;
  v_reuse numeric;
  v_overall numeric;
  v_rec_prio int;
  v_reasoning jsonb;
  v_matched_rules text[];
BEGIN
  FOR pkg IN
    SELECT cp.id as package_id, cp.status, cp.build_progress, cp.priority,
           c.title as course_title, cp.track
    FROM course_packages cp
    LEFT JOIN courses c ON c.id = cp.course_id
    WHERE cp.status NOT IN ('published', 'archived', 'deleted')
  LOOP
    v_demand := 0; v_monet := 0; v_pipeline := 0; v_reuse := 0;
    v_matched_rules := ARRAY[]::text[];

    -- Apply keyword rules
    FOR rule IN
      SELECT * FROM priority_score_rules WHERE is_active AND rule_type = 'keyword'
    LOOP
      IF pkg.course_title ILIKE rule.pattern THEN
        v_matched_rules := array_append(v_matched_rules, rule.rule_key);
        CASE rule.dimension
          WHEN 'demand' THEN v_demand := v_demand + rule.weight;
          WHEN 'monetization' THEN v_monet := v_monet + rule.weight;
          WHEN 'pipeline' THEN v_pipeline := v_pipeline + rule.weight;
          WHEN 'reuse' THEN v_reuse := v_reuse + rule.weight;
        END CASE;
      END IF;
    END LOOP;

    -- Apply track bonuses
    FOR rule IN
      SELECT * FROM priority_score_rules WHERE is_active AND rule_type = 'track_bonus'
    LOOP
      IF pkg.track = rule.pattern THEN
        v_matched_rules := array_append(v_matched_rules, rule.rule_key);
        CASE rule.dimension
          WHEN 'reuse' THEN v_reuse := v_reuse + rule.weight;
          WHEN 'demand' THEN v_demand := v_demand + rule.weight;
          WHEN 'monetization' THEN v_monet := v_monet + rule.weight;
        END CASE;
      END IF;
    END LOOP;

    -- Pipeline efficiency: higher progress = higher pipeline score
    v_pipeline := v_pipeline + LEAST(pkg.build_progress / 10.0, 10);

    -- Composite score (weighted)
    v_overall := (v_demand * 0.35) + (v_monet * 0.30) + (v_pipeline * 0.15) + (v_reuse * 0.20);

    -- Map to priority tier
    v_rec_prio := CASE
      WHEN v_overall >= 5 THEN 1
      WHEN v_overall >= 3 THEN 2
      WHEN v_overall >= 1.5 THEN 3
      ELSE 5
    END;

    v_reasoning := jsonb_build_object(
      'matched_rules', v_matched_rules,
      'scores', jsonb_build_object('demand', v_demand, 'monetization', v_monet, 'pipeline', v_pipeline, 'reuse', v_reuse),
      'current_priority', pkg.priority
    );

    -- Upsert score
    INSERT INTO priority_scores (package_id, demand_score, monetization_score, pipeline_score, reuse_score, overall_score, recommended_priority, reasoning, computed_at)
    VALUES (pkg.package_id, v_demand, v_monet, v_pipeline, v_reuse, v_overall, v_rec_prio, v_reasoning, now())
    ON CONFLICT (package_id) DO UPDATE SET
      demand_score = EXCLUDED.demand_score,
      monetization_score = EXCLUDED.monetization_score,
      pipeline_score = EXCLUDED.pipeline_score,
      reuse_score = EXCLUDED.reuse_score,
      overall_score = EXCLUDED.overall_score,
      recommended_priority = EXCLUDED.recommended_priority,
      reasoning = EXCLUDED.reasoning,
      computed_at = EXCLUDED.computed_at;

    v_scored := v_scored + 1;
  END LOOP;

  RETURN QUERY SELECT v_scored, v_skipped;
END;
$$;

-- Apply scores to packages (only queued/draft/blocked)
CREATE OR REPLACE FUNCTION public.apply_priority_from_scores(p_dry_run boolean DEFAULT true)
RETURNS TABLE(package_id uuid, old_priority int, new_priority int, overall_score numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH changes AS (
    SELECT ps.package_id,
           cp.priority as old_prio,
           ps.recommended_priority as new_prio,
           ps.overall_score
    FROM priority_scores ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE cp.status IN ('queued', 'draft', 'setup_complete', 'blocked')
      AND cp.priority != ps.recommended_priority
  )
  SELECT c.package_id, c.old_prio, c.new_prio, c.overall_score
  FROM changes c;

  IF NOT p_dry_run THEN
    UPDATE course_packages cp
    SET priority = ps.recommended_priority
    FROM priority_scores ps
    WHERE cp.id = ps.package_id
      AND cp.status IN ('queued', 'draft', 'setup_complete', 'blocked')
      AND cp.priority != ps.recommended_priority;
  END IF;
END;
$$;
