
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
           c.title as course_title, cp.track::text as track_text
    FROM course_packages cp
    LEFT JOIN courses c ON c.id = cp.course_id
    WHERE cp.status NOT IN ('published', 'archived', 'deleted')
  LOOP
    IF pkg.course_title IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_demand := 0; v_monet := 0; v_pipeline := 0; v_reuse := 0;
    v_matched_rules := ARRAY[]::text[];

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

    FOR rule IN
      SELECT * FROM priority_score_rules WHERE is_active AND rule_type = 'track_bonus'
    LOOP
      IF pkg.track_text = rule.pattern THEN
        v_matched_rules := array_append(v_matched_rules, rule.rule_key);
        CASE rule.dimension
          WHEN 'reuse' THEN v_reuse := v_reuse + rule.weight;
          WHEN 'demand' THEN v_demand := v_demand + rule.weight;
          WHEN 'monetization' THEN v_monet := v_monet + rule.weight;
        END CASE;
      END IF;
    END LOOP;

    v_pipeline := v_pipeline + LEAST(pkg.build_progress / 10.0, 10);
    v_overall := (v_demand * 0.35) + (v_monet * 0.30) + (v_pipeline * 0.15) + (v_reuse * 0.20);

    -- Thresholds: Prio 1 >= 3.0, Prio 2 >= 1.5, Prio 3 >= 0.8
    v_rec_prio := CASE
      WHEN v_overall >= 3.0 THEN 1
      WHEN v_overall >= 1.5 THEN 2
      WHEN v_overall >= 0.8 THEN 3
      ELSE 5
    END;

    v_reasoning := jsonb_build_object(
      'matched_rules', v_matched_rules,
      'scores', jsonb_build_object('demand', v_demand, 'monetization', v_monet, 'pipeline', v_pipeline, 'reuse', v_reuse),
      'current_priority', pkg.priority
    );

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
