
ALTER TABLE public.seo_bridge_type_registry
  ADD COLUMN IF NOT EXISTS pilot_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pilot_cap integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pilot_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS pilot_notes text;

UPDATE public.seo_bridge_governance
   SET max_outbound_per_source = 2, max_inbound_per_target = 5,
       max_per_apply_run = 60, min_semantic_similarity = 0.55,
       notes = COALESCE(notes,'') || ' | E3e.2 pilot tuned 2026-05-17'
 WHERE link_type = 'blog_to_pillar';

UPDATE public.seo_bridge_governance
   SET max_outbound_per_source = 2, max_inbound_per_target = 5,
       max_per_apply_run = 40, min_semantic_similarity = 0.65,
       notes = COALESCE(notes,'') || ' | E3e.2 pilot tuned 2026-05-17 (commercial target, conservative)'
 WHERE link_type = 'blog_to_exam_package';

UPDATE public.seo_bridge_governance
   SET notes = COALESCE(notes,'') || ' | E3e.2 pilot DEACTIVATED at registry; awaits perf-based cornerstone scoring'
 WHERE link_type = 'pillar_to_cornerstone_blog';

UPDATE public.seo_bridge_type_registry
   SET pilot_active = true, pilot_cap = 60, pilot_started_at = now(),
       pilot_notes = 'Authority-Consolidation Layer — 143 ready, avg_sim 0.988'
 WHERE link_type = 'blog_to_pillar';

UPDATE public.seo_bridge_type_registry
   SET pilot_active = true, pilot_cap = 40, pilot_started_at = now(),
       pilot_notes = 'Revenue-Bridge — 186 ready, avg_sim 0.950; bronze/review-locked excluded'
 WHERE link_type = 'blog_to_exam_package';

UPDATE public.seo_bridge_type_registry
   SET pilot_active = false, pilot_cap = 0,
       pilot_notes = 'Awaits new cornerstone scoring (perf_score / CTR / dwell / assisted_conv)'
 WHERE link_type = 'pillar_to_cornerstone_blog';

CREATE TABLE IF NOT EXISTS public.seo_bridge_pilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type text NOT NULL,
  cap_applied integer NOT NULL,
  candidates_evaluated integer NOT NULL DEFAULT 0,
  candidates_selected integer NOT NULL DEFAULT 0,
  distinct_sources integer NOT NULL DEFAULT 0,
  distinct_targets integer NOT NULL DEFAULT 0,
  avg_similarity numeric(5,4),
  min_similarity numeric(5,4),
  max_similarity numeric(5,4),
  governance_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  dry_run boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_seo_bridge_pilot_runs_link_type_created
  ON public.seo_bridge_pilot_runs (link_type, created_at DESC);
ALTER TABLE public.seo_bridge_pilot_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bridge_pilot_runs_admin_select ON public.seo_bridge_pilot_runs;
CREATE POLICY bridge_pilot_runs_admin_select ON public.seo_bridge_pilot_runs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS bridge_pilot_runs_service_all ON public.seo_bridge_pilot_runs;
CREATE POLICY bridge_pilot_runs_service_all ON public.seo_bridge_pilot_runs FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE TABLE IF NOT EXISTS public.seo_bridge_pilot_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.seo_bridge_pilot_runs(id) ON DELETE CASCADE,
  link_type text NOT NULL,
  source_id uuid NOT NULL,
  source_layer text NOT NULL,
  source_url text,
  source_title text,
  target_id uuid NOT NULL,
  target_layer text NOT NULL,
  target_url text,
  target_title text,
  similarity_score numeric(5,4) NOT NULL,
  rank_in_source integer NOT NULL,
  governance_decision text NOT NULL,
  explainability jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_seo_bridge_pilot_candidates_link_type
  ON public.seo_bridge_pilot_candidates (link_type, similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_seo_bridge_pilot_candidates_target
  ON public.seo_bridge_pilot_candidates (target_id);
ALTER TABLE public.seo_bridge_pilot_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bridge_pilot_candidates_admin_select ON public.seo_bridge_pilot_candidates;
CREATE POLICY bridge_pilot_candidates_admin_select ON public.seo_bridge_pilot_candidates FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS bridge_pilot_candidates_service_all ON public.seo_bridge_pilot_candidates;
CREATE POLICY bridge_pilot_candidates_service_all ON public.seo_bridge_pilot_candidates FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

INSERT INTO public.ops_audit_contract (action_type, required_keys, schema_version, owner_module)
VALUES
 ('seo_bridge_pilot_generate_run',
   ARRAY['link_type','cap_applied','candidates_evaluated','candidates_selected','dry_run','correlation_id'],
   1, 'seo.e3e2.bridge_pilot'),
 ('seo_bridge_pilot_governance_updated',
   ARRAY['link_type','field','old_value','new_value'],
   1, 'seo.e3e2.bridge_pilot'),
 ('seo_bridge_pilot_explainability_sampled',
   ARRAY['link_type','sample_size','correlation_id'],
   1, 'seo.e3e2.bridge_pilot')
ON CONFLICT (action_type) DO UPDATE
SET required_keys = EXCLUDED.required_keys,
    schema_version = EXCLUDED.schema_version,
    owner_module = EXCLUDED.owner_module,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.admin_seo_bridge_pilot_generate(
  p_link_type text,
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_is_service boolean := (auth.jwt() ->> 'role') = 'service_role';
  v_reg record; v_gov record;
  v_run_id uuid := gen_random_uuid();
  v_corr text := gen_random_uuid()::text;
  v_evaluated int := 0; v_selected int := 0;
  v_distinct_src int := 0; v_distinct_tgt int := 0;
  v_avg numeric(5,4); v_min numeric(5,4); v_max numeric(5,4);
  v_gov_snapshot jsonb;
BEGIN
  IF NOT (v_is_admin OR v_is_service) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT * INTO v_reg FROM public.seo_bridge_type_registry WHERE link_type = p_link_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown bridge link_type %', p_link_type; END IF;
  IF NOT v_reg.pilot_active OR v_reg.pilot_cap <= 0 THEN
    RETURN jsonb_build_object('status','skipped','reason','pilot_inactive_or_cap_zero','link_type',p_link_type);
  END IF;
  SELECT * INTO v_gov FROM public.seo_bridge_governance WHERE link_type = p_link_type;
  v_gov_snapshot := to_jsonb(v_gov);

  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  WITH ready AS (
    SELECT c.* FROM public.v_seo_bridge_candidates_v1 c
     WHERE c.link_type = p_link_type AND c.decision = 'READY'
       AND COALESCE(c.duplicate_existing,false)=false
       AND COALESCE(c.source_published,false)=true
       AND COALESCE(c.target_published,false)=true
  ),
  filtered AS (
    SELECT r.* FROM ready r
      LEFT JOIN public.course_packages cp
        ON p_link_type='blog_to_exam_package' AND cp.id=r.target_id
     WHERE p_link_type<>'blog_to_exam_package'
        OR NOT public.fn_is_bronze_locked(cp.id)
  ),
  per_source_capped AS (
    SELECT f.*, row_number() OVER (PARTITION BY f.source_id ORDER BY f.similarity_score DESC, f.target_id) AS rn_src
      FROM filtered f
  ),
  per_source_kept AS (
    SELECT * FROM per_source_capped WHERE rn_src <= v_gov.max_outbound_per_source
  ),
  per_target_capped AS (
    SELECT k.*, row_number() OVER (PARTITION BY k.target_id ORDER BY k.similarity_score DESC, k.source_id) AS rn_tgt
      FROM per_source_kept k
  ),
  per_target_kept AS (
    SELECT * FROM per_target_capped WHERE rn_tgt <= v_gov.max_inbound_per_target
  ),
  global_capped AS (
    SELECT t.*, row_number() OVER (ORDER BY t.similarity_score DESC, t.source_id, t.target_id) AS rn_global
      FROM per_target_kept t
  )
  SELECT * FROM global_capped WHERE rn_global <= v_reg.pilot_cap;

  SELECT count(*)::int INTO v_evaluated FROM public.v_seo_bridge_candidates_v1
   WHERE link_type = p_link_type AND decision = 'READY';

  SELECT count(*)::int, count(DISTINCT source_id)::int, count(DISTINCT target_id)::int,
         avg(similarity_score)::numeric(5,4),
         min(similarity_score)::numeric(5,4),
         max(similarity_score)::numeric(5,4)
    INTO v_selected, v_distinct_src, v_distinct_tgt, v_avg, v_min, v_max
    FROM _cand;

  IF NOT p_dry_run THEN
    INSERT INTO public.seo_bridge_pilot_runs(
      id, link_type, cap_applied, candidates_evaluated, candidates_selected,
      distinct_sources, distinct_targets, avg_similarity, min_similarity, max_similarity,
      governance_snapshot, correlation_id, dry_run, created_by
    ) VALUES (
      v_run_id, p_link_type, v_reg.pilot_cap, v_evaluated, v_selected,
      v_distinct_src, v_distinct_tgt, v_avg, v_min, v_max,
      v_gov_snapshot, v_corr, false, auth.uid()
    );

    INSERT INTO public.seo_bridge_pilot_candidates(
      run_id, link_type, source_id, source_layer, source_url, source_title,
      target_id, target_layer, target_url, target_title,
      similarity_score, rank_in_source, governance_decision, explainability
    )
    SELECT v_run_id, c.link_type, c.source_id, c.source_layer, c.source_url, c.source_title,
           c.target_id, c.target_layer, c.target_url, c.target_title,
           c.similarity_score, c.rn_src::int, 'PILOT_SELECTED',
           jsonb_build_object(
             'similarity', c.similarity_score,
             'rank_in_source', c.rn_src,
             'rank_in_target', c.rn_tgt,
             'rank_global', c.rn_global,
             'gates', jsonb_build_object(
               'min_sim', v_gov.min_semantic_similarity,
               'max_out_per_source', v_gov.max_outbound_per_source,
               'max_in_per_target', v_gov.max_inbound_per_target,
               'pilot_cap', v_reg.pilot_cap
             )
           )
      FROM _cand c;
  END IF;

  PERFORM public.fn_emit_audit(
    _action_type := 'seo_bridge_pilot_generate_run',
    _target_type := 'bridge_type',
    _target_id   := p_link_type,
    _result_status := 'ok',
    _payload := jsonb_build_object(
      'link_type', p_link_type, 'cap_applied', v_reg.pilot_cap,
      'candidates_evaluated', v_evaluated, 'candidates_selected', v_selected,
      'distinct_sources', v_distinct_src, 'distinct_targets', v_distinct_tgt,
      'avg_similarity', v_avg, 'min_similarity', v_min, 'max_similarity', v_max,
      'dry_run', p_dry_run, 'correlation_id', v_corr,
      'run_id', CASE WHEN p_dry_run THEN NULL ELSE v_run_id::text END
    ),
    _trigger_source := 'admin_seo_bridge_pilot_generate',
    _error_message := NULL
  );

  RETURN jsonb_build_object(
    'status','ok','link_type', p_link_type,'dry_run', p_dry_run,
    'run_id', CASE WHEN p_dry_run THEN NULL ELSE v_run_id END,
    'correlation_id', v_corr,'cap_applied', v_reg.pilot_cap,
    'candidates_evaluated', v_evaluated,'candidates_selected', v_selected,
    'distinct_sources', v_distinct_src,'distinct_targets', v_distinct_tgt,
    'avg_similarity', v_avg,'min_similarity', v_min,'max_similarity', v_max
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_seo_bridge_pilot_generate(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_bridge_pilot_generate(text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_bridge_pilot_snapshot()
RETURNS TABLE(
  link_type text, pilot_active boolean, pilot_cap int, last_run_at timestamptz,
  last_correlation_id text, last_candidates_evaluated int, last_candidates_selected int,
  last_distinct_sources int, last_distinct_targets int,
  last_avg_similarity numeric, last_min_similarity numeric, last_max_similarity numeric,
  last_dry_run boolean
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT r.link_type, r.pilot_active, r.pilot_cap, lr.created_at, lr.correlation_id,
    lr.candidates_evaluated, lr.candidates_selected, lr.distinct_sources, lr.distinct_targets,
    lr.avg_similarity, lr.min_similarity, lr.max_similarity, lr.dry_run
  FROM public.seo_bridge_type_registry r
  LEFT JOIN LATERAL (
    SELECT * FROM public.seo_bridge_pilot_runs s
     WHERE s.link_type = r.link_type ORDER BY s.created_at DESC LIMIT 1
  ) lr ON true
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
     OR (auth.jwt() ->> 'role') = 'service_role'
  ORDER BY r.pilot_active DESC, r.link_type;
$$;
REVOKE ALL ON FUNCTION public.admin_get_bridge_pilot_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bridge_pilot_snapshot() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_bridge_pilot_explainability_sample(
  p_link_type text, p_limit int DEFAULT 20
) RETURNS TABLE(
  source_url text, source_title text, target_url text, target_title text,
  similarity_score numeric, rank_in_source int, governance_decision text,
  explainability jsonb, run_created_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_corr text := gen_random_uuid()::text;
  v_size int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  RETURN QUERY
  WITH latest AS (
    SELECT id FROM public.seo_bridge_pilot_runs
     WHERE link_type = p_link_type ORDER BY created_at DESC LIMIT 1
  )
  SELECT c.source_url, c.source_title, c.target_url, c.target_title,
         c.similarity_score, c.rank_in_source, c.governance_decision,
         c.explainability, r.created_at
    FROM public.seo_bridge_pilot_candidates c
    JOIN public.seo_bridge_pilot_runs r ON r.id = c.run_id
   WHERE c.run_id = (SELECT id FROM latest)
   ORDER BY c.similarity_score DESC, c.rank_in_source
   LIMIT GREATEST(p_limit, 1);
  GET DIAGNOSTICS v_size = ROW_COUNT;
  PERFORM public.fn_emit_audit(
    _action_type := 'seo_bridge_pilot_explainability_sampled',
    _target_type := 'bridge_type',
    _target_id := p_link_type,
    _result_status := 'ok',
    _payload := jsonb_build_object('link_type', p_link_type, 'sample_size', v_size, 'correlation_id', v_corr),
    _trigger_source := 'admin_get_bridge_pilot_explainability_sample',
    _error_message := NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_bridge_pilot_explainability_sample(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bridge_pilot_explainability_sample(text, int) TO authenticated, service_role;

SELECT public.fn_emit_audit(
  _action_type := 'seo_bridge_pilot_governance_updated',
  _target_type := 'bridge_type',
  _target_id := 'blog_to_pillar',
  _result_status := 'ok',
  _payload := jsonb_build_object('link_type','blog_to_pillar','field','pilot_config',
    'old_value', jsonb_build_object('pilot_active',false,'cap',0),
    'new_value', jsonb_build_object('pilot_active',true,'cap',60,'max_out',2,'max_in',5,'min_sim',0.55)),
  _trigger_source := 'migration_e3e2',
  _error_message := NULL
);
SELECT public.fn_emit_audit(
  _action_type := 'seo_bridge_pilot_governance_updated',
  _target_type := 'bridge_type',
  _target_id := 'blog_to_exam_package',
  _result_status := 'ok',
  _payload := jsonb_build_object('link_type','blog_to_exam_package','field','pilot_config',
    'old_value', jsonb_build_object('pilot_active',false,'cap',0),
    'new_value', jsonb_build_object('pilot_active',true,'cap',40,'max_out',2,'max_in',5,'min_sim',0.65,'bronze_locked_excluded',true)),
  _trigger_source := 'migration_e3e2',
  _error_message := NULL
);
SELECT public.fn_emit_audit(
  _action_type := 'seo_bridge_pilot_governance_updated',
  _target_type := 'bridge_type',
  _target_id := 'pillar_to_cornerstone_blog',
  _result_status := 'ok',
  _payload := jsonb_build_object('link_type','pillar_to_cornerstone_blog','field','pilot_config',
    'old_value', jsonb_build_object('pilot_active',false,'cap',0),
    'new_value', jsonb_build_object('pilot_active',false,'cap',0,'reason','awaits_performance_based_cornerstone_scoring')),
  _trigger_source := 'migration_e3e2',
  _error_message := NULL
);
