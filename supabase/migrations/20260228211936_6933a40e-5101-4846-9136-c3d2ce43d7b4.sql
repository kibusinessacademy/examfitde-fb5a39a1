
BEGIN;

-- Must drop + recreate since column order changed
DROP VIEW IF EXISTS public.ops_blueprint_quality_kpis CASCADE;

CREATE VIEW public.ops_blueprint_quality_kpis AS
WITH comp AS (
  SELECT c.id AS competency_id, c.learning_field_id, c.bloom_level::text AS bloom_level
  FROM public.competencies c
),
bp AS (
  SELECT qb.id AS blueprint_id, qb.competency_id,
    COALESCE(
      CASE WHEN qb.status::text IN ('approved','active','published') THEN true ELSE NULL END,
      true
    ) AS is_effectively_active
  FROM public.question_blueprints qb
),
coverage AS (
  SELECT c.competency_id, c.learning_field_id, c.bloom_level,
    COUNT(b.blueprint_id) FILTER (WHERE b.is_effectively_active) AS active_blueprints
  FROM comp c LEFT JOIN bp b ON b.competency_id = c.competency_id
  GROUP BY 1,2,3
),
totals AS (
  SELECT
    COUNT(*)::int AS competencies_total,
    COUNT(*) FILTER (WHERE active_blueprints > 0)::int AS competencies_with_bp,
    COUNT(*) FILTER (WHERE active_blueprints = 0)::int AS competencies_without_bp,
    MIN(active_blueprints)::int AS min_active_blueprints_per_competency
  FROM coverage
),
bloom_dist AS (
  SELECT COALESCE(bloom_level, 'unknown') AS bloom_level,
    COUNT(*)::int AS competencies_total,
    COUNT(*) FILTER (WHERE active_blueprints > 0)::int AS competencies_with_bp,
    COUNT(*) FILTER (WHERE active_blueprints = 0)::int AS competencies_without_bp
  FROM coverage GROUP BY 1
),
lf_dist AS (
  SELECT lf.id AS learning_field_id, lf.code::text AS learning_field_code, lf.title::text AS learning_field_title,
    COUNT(*)::int AS competencies_total,
    COUNT(*) FILTER (WHERE c.active_blueprints > 0)::int AS competencies_with_bp,
    COUNT(*) FILTER (WHERE c.active_blueprints = 0)::int AS competencies_without_bp,
    MIN(c.active_blueprints)::int AS min_active_blueprints_in_lf
  FROM public.learning_fields lf JOIN coverage c ON c.learning_field_id = lf.id
  GROUP BY 1,2,3
),
low_bp AS (
  SELECT competency_id, learning_field_id, bloom_level, active_blueprints
  FROM coverage WHERE active_blueprints = 0
  ORDER BY bloom_level NULLS LAST, competency_id LIMIT 25
)
SELECT
  now() AS computed_at,
  t.competencies_total,
  t.competencies_with_bp,
  t.competencies_without_bp,
  t.min_active_blueprints_per_competency,
  CASE WHEN t.competencies_total = 0 THEN 0
       ELSE ROUND((t.competencies_with_bp::numeric / t.competencies_total::numeric) * 100, 2)
  END AS pct_competencies_with_bp,
  (SELECT jsonb_object_agg(bd.bloom_level, jsonb_build_object(
      'competencies_total', bd.competencies_total, 'with_blueprint', bd.competencies_with_bp,
      'without_blueprint', bd.competencies_without_bp,
      'pct_with_blueprint', CASE WHEN bd.competencies_total = 0 THEN 0
        ELSE ROUND((bd.competencies_with_bp::numeric / bd.competencies_total::numeric) * 100, 2) END
    )) FROM bloom_dist bd
  ) AS bloom_distribution,
  (SELECT jsonb_object_agg(ld.learning_field_code, jsonb_build_object(
      'learning_field_id', ld.learning_field_id, 'title', ld.learning_field_title,
      'competencies_total', ld.competencies_total, 'with_blueprint', ld.competencies_with_bp,
      'without_blueprint', ld.competencies_without_bp,
      'pct_with_blueprint', CASE WHEN ld.competencies_total = 0 THEN 0
        ELSE ROUND((ld.competencies_with_bp::numeric / ld.competencies_total::numeric) * 100, 2) END,
      'min_active_blueprints_in_lf', ld.min_active_blueprints_in_lf
    )) FROM lf_dist ld
  ) AS learning_field_distribution,
  (SELECT jsonb_agg(jsonb_build_object(
      'competency_id', competency_id, 'learning_field_id', learning_field_id,
      'bloom_level', bloom_level, 'active_blueprints', active_blueprints
    )) FROM low_bp
  ) AS sample_missing_blueprints
FROM totals t;

COMMENT ON VIEW public.ops_blueprint_quality_kpis IS
'Governance KPIs v2: blueprint coverage per competency + bloom + learning field distribution + min blueprints.';

-- Recreate RPC with v2 signature (old was already dropped in previous migration)
CREATE OR REPLACE FUNCTION public.check_blueprint_quality_kpis(
  p_min_pct_competencies_with_bp numeric DEFAULT 95,
  p_allow_unknown_bloom boolean DEFAULT false,
  p_min_pct_with_bp_per_bloom numeric DEFAULT 90,
  p_min_active_blueprints_per_competency int DEFAULT 1,
  p_min_pct_with_bp_per_learning_field numeric DEFAULT 90,
  p_min_active_blueprints_in_learning_field int DEFAULT 1
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v jsonb; v_failures jsonb := '[]'::jsonb;
  v_pct numeric; v_min_bp int;
  v_bloom jsonb; v_lf jsonb;
  k text; row jsonb; pct_x numeric; min_x int;
BEGIN
  SELECT to_jsonb(vw) INTO v FROM public.ops_blueprint_quality_kpis vw;
  IF v IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'failures', jsonb_build_array(
      jsonb_build_object('kind','missing_view','message','ops_blueprint_quality_kpis returned NULL')));
  END IF;

  -- A) Overall coverage
  v_pct := COALESCE((v->>'pct_competencies_with_bp')::numeric, 0);
  IF v_pct < p_min_pct_competencies_with_bp THEN
    v_failures := v_failures || jsonb_build_object('kind','coverage',
      'message', format('Competency blueprint coverage %.2f%% below %.2f%%', v_pct, p_min_pct_competencies_with_bp),
      'metric','pct_competencies_with_bp','value',v_pct,'threshold',p_min_pct_competencies_with_bp);
  END IF;

  -- B) Min active blueprints per competency
  v_min_bp := COALESCE((v->>'min_active_blueprints_per_competency')::int, 0);
  IF v_min_bp < p_min_active_blueprints_per_competency THEN
    v_failures := v_failures || jsonb_build_object('kind','min_blueprints_per_competency',
      'message', format('Min active blueprints per competency is %s, below required %s', v_min_bp, p_min_active_blueprints_per_competency),
      'metric','min_active_blueprints_per_competency','value',v_min_bp,'threshold',p_min_active_blueprints_per_competency);
  END IF;

  -- C) Bloom distribution
  v_bloom := COALESCE(v->'bloom_distribution', '{}'::jsonb);
  IF (v_bloom ? 'unknown') AND (NOT p_allow_unknown_bloom) THEN
    v_failures := v_failures || jsonb_build_object('kind','bloom_unknown',
      'message','Bloom level "unknown" exists but not allowed by policy.','metric','bloom_distribution.unknown');
  END IF;
  FOR k IN SELECT jsonb_object_keys(v_bloom) LOOP
    row := v_bloom->k;
    pct_x := COALESCE((row->>'pct_with_blueprint')::numeric, 0);
    IF k <> 'unknown' AND pct_x < p_min_pct_with_bp_per_bloom THEN
      v_failures := v_failures || jsonb_build_object('kind','bloom_coverage',
        'message', format('Bloom "%s" coverage %.2f%% below %.2f%%', k, pct_x, p_min_pct_with_bp_per_bloom),
        'metric', format('bloom_distribution.%s.pct_with_blueprint', k),'value',pct_x,'threshold',p_min_pct_with_bp_per_bloom);
    END IF;
  END LOOP;

  -- D) Learning field distribution
  v_lf := COALESCE(v->'learning_field_distribution', '{}'::jsonb);
  FOR k IN SELECT jsonb_object_keys(v_lf) LOOP
    row := v_lf->k;
    pct_x := COALESCE((row->>'pct_with_blueprint')::numeric, 0);
    min_x := COALESCE((row->>'min_active_blueprints_in_lf')::int, 0);
    IF pct_x < p_min_pct_with_bp_per_learning_field THEN
      v_failures := v_failures || jsonb_build_object('kind','learning_field_coverage',
        'message', format('LF "%s" coverage %.2f%% below %.2f%%', k, pct_x, p_min_pct_with_bp_per_learning_field),
        'metric', format('learning_field_distribution.%s.pct_with_blueprint', k),'value',pct_x,'threshold',p_min_pct_with_bp_per_learning_field);
    END IF;
    IF min_x < p_min_active_blueprints_in_learning_field THEN
      v_failures := v_failures || jsonb_build_object('kind','learning_field_min_blueprints',
        'message', format('LF "%s" min active blueprints %s below required %s', k, min_x, p_min_active_blueprints_in_learning_field),
        'metric', format('learning_field_distribution.%s.min_active_blueprints_in_lf', k),'value',min_x,'threshold',p_min_active_blueprints_in_learning_field);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', jsonb_array_length(v_failures) = 0, 'failures', v_failures, 'snapshot', v);
END;
$$;

REVOKE ALL ON FUNCTION public.check_blueprint_quality_kpis(numeric,boolean,numeric,int,numeric,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_blueprint_quality_kpis(numeric,boolean,numeric,int,numeric,int) TO service_role;

COMMIT;
