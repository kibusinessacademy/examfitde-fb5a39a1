CREATE OR REPLACE FUNCTION public.admin_seo_bridge_activation_execute(p_link_type text, p_candidate_ids uuid[], p_batch_label text, p_dry_run boolean DEFAULT true)
 RETURNS TABLE(run_id uuid, link_type text, dry_run boolean, requested_count integer, activated_count integer, skipped_count integer, cap_per_batch integer, governance jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_run_id uuid;
  v_corr uuid := gen_random_uuid();
  v_cap int;
  v_min_sim numeric;
  v_requested int := COALESCE(array_length(p_candidate_ids,1),0);
  v_activated int := 0;
  v_skipped int := 0;
  v_gov jsonb;
BEGIN
  IF NOT (has_role(v_uid,'admin'::app_role)
          OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RAISE EXCEPTION 'admin_seo_bridge_activation_execute: admin role required';
  END IF;

  IF p_link_type NOT IN ('blog_to_pillar','blog_to_exam_package') THEN
    RAISE EXCEPTION 'admin_seo_bridge_activation_execute: unsupported link_type %', p_link_type;
  END IF;

  v_cap := CASE p_link_type
             WHEN 'blog_to_pillar'       THEN 60
             WHEN 'blog_to_exam_package' THEN 25
           END;

  SELECT COALESCE(g.min_semantic_similarity, 0.0)
    INTO v_min_sim
    FROM public.seo_bridge_governance g
   WHERE g.link_type = p_link_type
   LIMIT 1;

  v_gov := jsonb_build_object(
    'link_type', p_link_type,
    'cap_per_batch', v_cap,
    'min_semantic_similarity', v_min_sim,
    'suggestions_status_on_commit', 'suggested',
    'requires_second_human_gate_for_active', true,
    'evaluated_at', now()
  );

  INSERT INTO public.seo_bridge_activation_runs(
    link_type, batch_label, requested_by, requested_count,
    dry_run, governance_snapshot, correlation_id
  ) VALUES (
    p_link_type, p_batch_label, v_uid, v_requested,
    p_dry_run, v_gov, v_corr
  ) RETURNING id INTO v_run_id;

  WITH input AS (
    SELECT unnest(p_candidate_ids) AS cand_id
  ),
  resolved AS (
    SELECT
      i.cand_id,
      c.source_url,
      c.target_url,
      c.target_title,
      c.similarity_score,
      c.governance_decision,
      c.link_type AS cand_link_type,
      CASE
        WHEN c.id IS NULL THEN 'CANDIDATE_NOT_FOUND'
        WHEN c.link_type <> p_link_type THEN 'LINK_TYPE_MISMATCH'
        WHEN c.source_url IS NULL OR c.target_url IS NULL THEN 'URL_MISSING'
        WHEN c.similarity_score < v_min_sim THEN 'BELOW_MIN_SIM'
        WHEN c.governance_decision NOT IN ('READY','PILOT_SELECTED') THEN 'NOT_READY'
        WHEN EXISTS (
          SELECT 1 FROM public.seo_internal_link_suggestions s
           WHERE s.source_url = c.source_url
             AND s.target_url = c.target_url
             AND COALESCE(s.link_type,'contextual') = p_link_type
        ) THEN 'DUPLICATE_SUGGESTION'
        ELSE NULL
      END AS skip_reason
    FROM input i
    LEFT JOIN public.seo_bridge_pilot_candidates c ON c.id = i.cand_id
  ),
  capped AS (
    SELECT
      r.*,
      ROW_NUMBER() OVER (
        PARTITION BY (skip_reason IS NULL)
        ORDER BY r.similarity_score DESC NULLS LAST, r.cand_id
      ) AS rn_eligible
    FROM resolved r
  )
  INSERT INTO public.seo_bridge_activations(
    run_id, pilot_candidate_id, link_type, source_url, target_url,
    anchor_text, status, skip_reason
  )
  SELECT
    v_run_id,
    cand_id,
    p_link_type,
    source_url,
    target_url,
    LEFT(COALESCE(target_title, target_url), 120),
    CASE
      WHEN skip_reason IS NOT NULL THEN 'skipped'
      WHEN rn_eligible > v_cap THEN 'skipped'
      ELSE 'planned'
    END,
    CASE
      WHEN skip_reason IS NOT NULL THEN skip_reason
      WHEN rn_eligible > v_cap THEN 'CAP_EXCEEDED'
      ELSE NULL
    END
  FROM capped;

  IF NOT p_dry_run THEN
    WITH planned AS (
      SELECT a.id AS activation_id, a.source_url, a.target_url, a.anchor_text, a.link_type AS lt
        FROM public.seo_bridge_activations a
       WHERE a.run_id = v_run_id AND a.status = 'planned'
    ),
    inserted AS (
      INSERT INTO public.seo_internal_link_suggestions AS s (
        source_url, target_url, anchor_text, link_type,
        relevance_score, priority, reason, status
      )
      SELECT
        p.source_url, p.target_url, p.anchor_text, p.lt,
        70, 6,
        'E3e.3 bridge pilot activation (' || p_link_type || ')',
        'suggested'
      FROM planned p
      ON CONFLICT (source_url, target_url, link_type) DO NOTHING
      RETURNING s.id AS suggestion_id, s.source_url AS s_source_url, s.target_url AS s_target_url, s.link_type AS s_link_type
    )
    UPDATE public.seo_bridge_activations a
       SET status = 'activated',
           suggestion_id = ins.suggestion_id
      FROM inserted ins
     WHERE a.run_id = v_run_id
       AND a.source_url = ins.s_source_url
       AND a.target_url = ins.s_target_url
       AND a.link_type = ins.s_link_type;

    UPDATE public.seo_bridge_activations a
       SET status = 'skipped',
           skip_reason = COALESCE(a.skip_reason,'RACE_DUPLICATE')
     WHERE a.run_id = v_run_id
       AND a.status = 'planned';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE a.status IN ('planned','activated'))::int,
    COUNT(*) FILTER (WHERE a.status = 'skipped')::int
  INTO v_activated, v_skipped
  FROM public.seo_bridge_activations a
  WHERE a.run_id = v_run_id;

  UPDATE public.seo_bridge_activation_runs r
     SET activated_count = v_activated,
         skipped_count   = v_skipped
   WHERE r.id = v_run_id;

  PERFORM public.fn_emit_audit(
    _action_type := 'seo_bridge_activation_proposed',
    _target_type := 'bridge_run',
    _target_id   := v_run_id::text,
    _result_status := 'ok',
    _payload := jsonb_build_object(
      'run_id', v_run_id,
      'link_type', p_link_type,
      'batch_label', p_batch_label,
      'requested_count', v_requested,
      'dry_run', p_dry_run,
      'cap_per_batch', v_cap,
      'planned_or_activated', v_activated,
      'skipped', v_skipped,
      'correlation_id', v_corr
    ),
    _trigger_source := 'admin_seo_bridge_activation_execute'
  );

  IF NOT p_dry_run THEN
    PERFORM public.fn_emit_audit(
      _action_type := 'seo_bridge_activation_committed',
      _target_type := 'bridge_run',
      _target_id   := v_run_id::text,
      _result_status := 'ok',
      _payload := jsonb_build_object(
        'run_id', v_run_id,
        'link_type', p_link_type,
        'activated_count', v_activated,
        'skipped_count', v_skipped,
        'correlation_id', v_corr
      ),
      _trigger_source := 'admin_seo_bridge_activation_execute'
    );
  END IF;

  RETURN QUERY
  SELECT v_run_id, p_link_type, p_dry_run,
         v_requested, v_activated, v_skipped, v_cap, v_gov;
END;
$function$;