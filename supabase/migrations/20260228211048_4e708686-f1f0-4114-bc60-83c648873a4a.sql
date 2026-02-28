
-- ops_blueprint_quality_kpis: Governance KPIs for blueprint coverage + bloom distribution
-- Safe: uses actual schema columns (competencies.bloom_level, question_blueprints.status)

-- 1) View
CREATE OR REPLACE VIEW public.ops_blueprint_quality_kpis AS
WITH coverage AS (
  SELECT
    c.id AS competency_id,
    COALESCE(c.bloom_level, 'unknown') AS bloom_level,
    COUNT(qb.id) FILTER (WHERE qb.status = 'approved') AS active_blueprints
  FROM public.competencies c
  LEFT JOIN public.question_blueprints qb ON qb.competency_id = c.id
  GROUP BY c.id, c.bloom_level
),
bloom_dist AS (
  SELECT
    bloom_level,
    COUNT(*)::int AS competencies_total,
    COUNT(*) FILTER (WHERE active_blueprints > 0)::int AS competencies_with_bp
  FROM coverage
  GROUP BY 1
),
totals AS (
  SELECT
    COUNT(*)::int AS competencies_total,
    COUNT(*) FILTER (WHERE active_blueprints > 0)::int AS competencies_with_bp,
    COUNT(*) FILTER (WHERE active_blueprints = 0)::int AS competencies_without_bp
  FROM coverage
)
SELECT
  now() AS computed_at,
  t.competencies_total,
  t.competencies_with_bp,
  t.competencies_without_bp,
  CASE WHEN t.competencies_total = 0 THEN 0
       ELSE ROUND((t.competencies_with_bp::numeric / t.competencies_total::numeric) * 100, 2)
  END AS pct_competencies_with_bp,
  (
    SELECT jsonb_object_agg(bd.bloom_level, jsonb_build_object(
      'competencies_total', bd.competencies_total,
      'with_blueprint', bd.competencies_with_bp,
      'pct_with_blueprint',
        CASE WHEN bd.competencies_total = 0 THEN 0
             ELSE ROUND((bd.competencies_with_bp::numeric / bd.competencies_total::numeric) * 100, 2)
        END
    ))
    FROM bloom_dist bd
  ) AS bloom_distribution,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'competency_id', x.competency_id,
      'bloom_level', x.bloom_level,
      'active_blueprints', x.active_blueprints
    ))
    FROM (
      SELECT competency_id, bloom_level, active_blueprints
      FROM coverage
      WHERE active_blueprints = 0
      ORDER BY bloom_level NULLS LAST, competency_id
      LIMIT 25
    ) x
  ) AS sample_missing_blueprints
FROM totals t;

COMMENT ON VIEW public.ops_blueprint_quality_kpis IS
'Governance KPIs: blueprint coverage per competency + bloom distribution snapshot (SSOT integrity).';

-- 2) RPC: check thresholds, return ok + failures + snapshot
CREATE OR REPLACE FUNCTION public.check_blueprint_quality_kpis(
  p_min_pct_competencies_with_bp numeric DEFAULT 95,
  p_allow_unknown_bloom boolean DEFAULT false,
  p_min_pct_with_bp_per_bloom numeric DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_pct numeric;
  v_bloom jsonb;
  k text;
  row_val jsonb;
  pct_bloom numeric;
BEGIN
  SELECT to_jsonb(vw) INTO v
  FROM public.ops_blueprint_quality_kpis vw;

  IF v IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'failures', jsonb_build_array(
      jsonb_build_object('kind','missing_view','message','ops_blueprint_quality_kpis returned NULL')
    ));
  END IF;

  v_pct := COALESCE((v->>'pct_competencies_with_bp')::numeric, 0);
  IF v_pct < p_min_pct_competencies_with_bp THEN
    v_failures := v_failures || jsonb_build_object(
      'kind','coverage',
      'message', format('Competency blueprint coverage %.2f%% is below threshold %.2f%%', v_pct, p_min_pct_competencies_with_bp),
      'metric','pct_competencies_with_bp',
      'value', v_pct,
      'threshold', p_min_pct_competencies_with_bp
    );
  END IF;

  v_bloom := COALESCE(v->'bloom_distribution', '{}'::jsonb);

  -- unknown bloom handling
  IF (v_bloom ? 'unknown') AND (NOT p_allow_unknown_bloom) THEN
    v_failures := v_failures || jsonb_build_object(
      'kind','bloom_unknown',
      'message','Bloom level "unknown" exists in competencies but is not allowed by policy.',
      'metric','bloom_distribution.unknown'
    );
  END IF;

  -- per-bloom minimum coverage
  FOR k IN SELECT jsonb_object_keys(v_bloom)
  LOOP
    row_val := v_bloom->k;
    pct_bloom := COALESCE((row_val->>'pct_with_blueprint')::numeric, 0);
    IF k <> 'unknown' AND pct_bloom < p_min_pct_with_bp_per_bloom THEN
      v_failures := v_failures || jsonb_build_object(
        'kind','bloom_coverage',
        'message', format('Bloom "%s" coverage %.2f%% below %.2f%%', k, pct_bloom, p_min_pct_with_bp_per_bloom),
        'metric', format('bloom_distribution.%s.pct_with_blueprint', k),
        'value', pct_bloom,
        'threshold', p_min_pct_with_bp_per_bloom
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_failures) = 0,
    'failures', v_failures,
    'snapshot', v
  );
END;
$$;

-- Lock down to service_role only
REVOKE ALL ON FUNCTION public.check_blueprint_quality_kpis(numeric, boolean, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_blueprint_quality_kpis(numeric, boolean, numeric) TO service_role;
