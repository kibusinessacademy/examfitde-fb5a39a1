DO $mig$
DECLARE
  v_correlation uuid := gen_random_uuid();
  v_inserted int := 0;
  v_skipped int := 0;
  v_eligible int;
  v_pillars int;
  rec record;
  v_did boolean;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN decision='READY_TO_SUGGEST' THEN 1 ELSE 0 END),0)::int,
         COALESCE(COUNT(DISTINCT CASE WHEN decision='READY_TO_SUGGEST' THEN cert_pillar_id END),0)::int
    INTO v_eligible, v_pillars
  FROM public.v_persona_landing_cert_pillar_link_candidates;

  PERFORM public.fn_emit_audit(
    _action_type:='persona_cert_pillar_link_detected',
    _target_type:='seo_bridge', _result_status:='ok',
    _payload:=jsonb_build_object(
      'eligible_pairs',v_eligible,'distinct_pillars',v_pillars,
      'correlation_id',v_correlation,'cap',v_eligible,'dry_run',false,
      'mode','A2_full_run_via_migration'));

  FOR rec IN
    SELECT * FROM public.v_persona_landing_cert_pillar_link_candidates
    WHERE decision='READY_TO_SUGGEST'
    ORDER BY cert_pillar_id, persona_page_id
  LOOP
    WITH ins AS (
      INSERT INTO public.seo_internal_link_suggestions
        (source_url,target_url,link_type,anchor_text,status,relevance_score,priority,reason)
      VALUES (rec.source_url,rec.target_url,'cluster_to_pillar',
              COALESCE(rec.cert_title,rec.cert_slug),'suggested',88,1,
              'A2 persona_landing→cert_pillar bridge ('||rec.persona_type||')')
      ON CONFLICT (source_url,target_url,link_type) DO NOTHING
      RETURNING 1
    ) SELECT EXISTS(SELECT 1 FROM ins) INTO v_did;
    IF v_did THEN v_inserted := v_inserted+1; ELSE v_skipped := v_skipped+1; END IF;

    WITH ins AS (
      INSERT INTO public.seo_internal_link_suggestions
        (source_url,target_url,link_type,anchor_text,status,relevance_score,priority,reason)
      VALUES (rec.target_url,rec.source_url,'pillar_to_cluster',
              COALESCE(rec.persona_title,rec.persona_slug),'suggested',83,2,
              'A2 cert_pillar→persona_landing backlink ('||rec.persona_type||')')
      ON CONFLICT (source_url,target_url,link_type) DO NOTHING
      RETURNING 1
    ) SELECT EXISTS(SELECT 1 FROM ins) INTO v_did;
    IF v_did THEN v_inserted := v_inserted+1; ELSE v_skipped := v_skipped+1; END IF;
  END LOOP;

  PERFORM public.fn_emit_audit(
    _action_type:='persona_cert_pillar_link_summary',
    _target_type:='seo_bridge', _result_status:='ok',
    _payload:=jsonb_build_object(
      'correlation_id',v_correlation,'eligible_pairs',v_eligible,'distinct_pillars',v_pillars,
      'inserted',v_inserted,'skipped_existing',v_skipped,'dry_run',false,
      'reason','A2 full bridge run via migration (4 waves consolidated)',
      'mode','A2_full_run_via_migration'));

  RAISE NOTICE 'A2 done: eligible=% pillars=% inserted=% skipped_existing=%',
    v_eligible, v_pillars, v_inserted, v_skipped;
END
$mig$;