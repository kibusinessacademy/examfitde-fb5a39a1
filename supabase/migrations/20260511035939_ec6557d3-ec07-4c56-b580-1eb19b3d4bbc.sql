CREATE OR REPLACE FUNCTION public.fn_growth_repair_complete_run(
  p_run_id uuid,
  p_artifact_ref jsonb DEFAULT NULL,
  p_council_verdict text DEFAULT NULL,
  p_council_score numeric DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run growth_repair_runs%ROWTYPE;
  v_module growth_repair_modules%ROWTYPE;
  v_post numeric;
  v_scores jsonb;
  v_gate_pass boolean := true;
  v_gate_reasons text[] := ARRAY[]::text[];
  v_final_status text;
BEGIN
  SELECT * INTO v_run FROM public.growth_repair_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;
  IF v_run.status NOT IN ('running','generating','gate_post','council') THEN
    RAISE EXCEPTION 'invalid_state: %', v_run.status;
  END IF;

  SELECT * INTO v_module FROM public.growth_repair_modules WHERE subscore = v_run.subscore;

  IF p_error IS NOT NULL THEN
    UPDATE public.growth_repair_runs
       SET status='failed', error=p_error, completed_at=now(), artifact_ref=p_artifact_ref
     WHERE id=p_run_id;
    INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('growth_repair_run_completed', v_run.package_id, 'package', 'failed',
      format('subscore=%s err=%s', v_run.subscore, left(p_error,200)),
      jsonb_build_object('run_id', p_run_id, 'subscore', v_run.subscore));
    RETURN jsonb_build_object('status','failed','reason',p_error);
  END IF;

  IF v_module.requires_pre_post_score THEN
    BEGIN
      v_scores := public.fn_compute_growth_quality_score(v_run.package_id);
      -- v_scores layout: { subscores: { cta: x, ... } }, also fallbacks for legacy paths
      v_post := COALESCE(
        (v_scores -> 'subscores' ->> v_run.subscore)::numeric,
        (v_scores ->> ('score_'||v_run.subscore))::numeric,
        (v_scores ->> v_run.subscore)::numeric
      );
    EXCEPTION WHEN OTHERS THEN v_post := NULL; END;

    IF v_post IS NULL THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons, 'post_score_unavailable');
    ELSIF v_run.pre_score IS NULL THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons, 'pre_score_unavailable');
    ELSIF v_post < v_run.pre_score THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons,
        format('score_regression %s→%s', v_run.pre_score, v_post));
    END IF;
  END IF;

  IF v_module.requires_council THEN
    IF p_council_verdict IS NULL OR p_council_score IS NULL THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons,'council_missing');
    ELSIF p_council_score < 75 THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons,
        format('council_below_bronze %s', p_council_score));
    ELSIF p_council_verdict NOT IN ('PASS','REVIEW_REQUIRED') THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons,
        format('council_verdict %s', p_council_verdict));
    END IF;
  END IF;

  v_final_status := CASE WHEN v_gate_pass THEN 'completed' ELSE 'rolled_back' END;

  UPDATE public.growth_repair_runs
     SET status = v_final_status,
         post_score = v_post,
         council_verdict = p_council_verdict,
         council_score = p_council_score,
         artifact_ref = p_artifact_ref,
         rollback_info = CASE WHEN v_gate_pass THEN NULL
                              ELSE jsonb_build_object('reasons', v_gate_reasons, 'at', now()) END,
         completed_at = now()
   WHERE id = p_run_id;

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('growth_repair_run_completed', v_run.package_id, 'package', v_final_status,
    format('subscore=%s pre=%s post=%s council=%s/%s',
      v_run.subscore, v_run.pre_score, v_post, p_council_verdict, p_council_score),
    jsonb_build_object(
      'run_id', p_run_id, 'subscore', v_run.subscore,
      'pre_score', v_run.pre_score, 'post_score', v_post,
      'gate_pass', v_gate_pass, 'gate_reasons', v_gate_reasons,
      'council_verdict', p_council_verdict, 'council_score', p_council_score
    ));

  RETURN jsonb_build_object(
    'status', v_final_status,
    'pre_score', v_run.pre_score,
    'post_score', v_post,
    'gate_pass', v_gate_pass,
    'gate_reasons', v_gate_reasons
  );
END;
$function$;

-- Auch start_run muss korrekten subscore-Pfad nutzen
CREATE OR REPLACE FUNCTION public.fn_growth_repair_start_run(
  p_package_id uuid,
  p_subscore text,
  p_job_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_module growth_repair_modules%ROWTYPE;
  v_pre numeric;
  v_scores jsonb;
  v_run_id uuid;
BEGIN
  SELECT * INTO v_module FROM public.growth_repair_modules WHERE subscore = p_subscore;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_subscore: %', p_subscore; END IF;
  IF NOT v_module.enabled THEN RAISE EXCEPTION 'module_disabled: %', p_subscore; END IF;

  IF v_module.requires_pre_post_score THEN
    BEGIN
      v_scores := public.fn_compute_growth_quality_score(p_package_id);
      v_pre := COALESCE(
        (v_scores -> 'subscores' ->> p_subscore)::numeric,
        (v_scores ->> ('score_'||p_subscore))::numeric,
        (v_scores ->> p_subscore)::numeric
      );
    EXCEPTION WHEN OTHERS THEN v_pre := NULL; END;
  END IF;

  INSERT INTO public.growth_repair_runs
    (package_id, subscore, job_id, status, pre_score, started_at)
  VALUES
    (p_package_id, p_subscore, p_job_id, 'running', v_pre, now())
  RETURNING id INTO v_run_id;

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('growth_repair_run_started', p_package_id, 'package', 'running',
    format('subscore=%s pre=%s', p_subscore, v_pre),
    jsonb_build_object('run_id', v_run_id, 'subscore', p_subscore, 'pre_score', v_pre, 'job_id', p_job_id));

  RETURN v_run_id;
END;
$function$;