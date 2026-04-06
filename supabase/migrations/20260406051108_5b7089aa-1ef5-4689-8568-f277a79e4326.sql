
DROP FUNCTION IF EXISTS compute_priority_scores();

CREATE OR REPLACE FUNCTION compute_priority_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pkg RECORD;
  rule RECORD;
  s_demand numeric;
  s_monet numeric;
  s_pipeline numeric;
  s_reuse numeric;
  s_fresh numeric;
  s_total numeric;
  cnt integer := 0;
  pkg_title text;
BEGIN
  FOR pkg IN
    SELECT cp.id, cp.title AS pkg_title, cp.build_progress, cp.status, cp.track::text AS track_text,
           c.title AS cert_title, c.certification_type
    FROM course_packages cp
    LEFT JOIN curricula c ON c.id = cp.curriculum_id
  LOOP
    pkg_title := COALESCE(pkg.pkg_title, pkg.cert_title, '');
    s_demand := 0; s_monet := 0; s_pipeline := 0; s_reuse := 0; s_fresh := 0;

    FOR rule IN
      SELECT * FROM priority_score_rules WHERE is_active = true
    LOOP
      IF rule.rule_type = 'keyword' AND pkg_title ILIKE rule.pattern THEN
        CASE rule.dimension
          WHEN 'demand' THEN s_demand := GREATEST(s_demand, rule.weight);
          WHEN 'monetization' THEN s_monet := GREATEST(s_monet, rule.weight);
          WHEN 'reuse' THEN s_reuse := GREATEST(s_reuse, rule.weight);
          WHEN 'freshness' THEN s_fresh := GREATEST(s_fresh, rule.weight);
          ELSE NULL;
        END CASE;
      END IF;

      IF rule.rule_type = 'track' AND pkg.track_text = rule.pattern THEN
        CASE rule.dimension
          WHEN 'reuse' THEN s_reuse := GREATEST(s_reuse, rule.weight);
          WHEN 'monetization' THEN s_monet := GREATEST(s_monet, rule.weight);
          ELSE NULL;
        END CASE;
      END IF;

      IF rule.rule_type = 'cert_type' AND pkg.certification_type = rule.pattern THEN
        CASE rule.dimension
          WHEN 'monetization' THEN s_monet := GREATEST(s_monet, rule.weight);
          WHEN 'reuse' THEN s_reuse := GREATEST(s_reuse, rule.weight);
          ELSE NULL;
        END CASE;
      END IF;
    END LOOP;

    IF pkg.build_progress = 0 THEN s_pipeline := 10;
    ELSIF pkg.build_progress < 30 THEN s_pipeline := 7;
    ELSIF pkg.build_progress < 70 THEN s_pipeline := 4;
    ELSE s_pipeline := 1;
    END IF;

    s_total := (s_demand * 0.30) + (s_monet * 0.30) + (s_pipeline * 0.10) + (s_reuse * 0.20) + (s_fresh * 0.10);

    INSERT INTO priority_scores (package_id, score_demand, score_monetization, score_pipeline, score_reuse, total_score)
    VALUES (pkg.id, s_demand, s_monet, s_pipeline, s_reuse, s_total)
    ON CONFLICT (package_id) DO UPDATE SET
      score_demand = EXCLUDED.score_demand,
      score_monetization = EXCLUDED.score_monetization,
      score_pipeline = EXCLUDED.score_pipeline,
      score_reuse = EXCLUDED.score_reuse,
      total_score = EXCLUDED.total_score,
      computed_at = now();

    cnt := cnt + 1;
  END LOOP;

  RETURN cnt;
END;
$$;
