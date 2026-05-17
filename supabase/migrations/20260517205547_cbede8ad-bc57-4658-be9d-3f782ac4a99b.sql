CREATE OR REPLACE FUNCTION public.admin_seo_bridge_pilot_generate(p_link_type text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        ON p_link_type='blog_to_exam_package' AND cp.id::text = r.target_id
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
    SELECT v_run_id, c.link_type, c.source_id::uuid, c.source_layer, c.source_url, c.source_title,
           c.target_id::uuid, c.target_layer, c.target_url, c.target_title,
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
$function$;