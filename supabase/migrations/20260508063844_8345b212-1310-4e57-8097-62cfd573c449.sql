CREATE OR REPLACE FUNCTION public.admin_bronze_targeted_repair_dispatch(p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_is_admin boolean; v_pkg record; v_council record;
  v_score numeric; v_badge text; v_verdict text; v_rules_failed int;
  v_attempts int; v_failed_rules jsonb; v_repair_vector jsonb;
  v_dispatch_kind text; v_job_id uuid; v_curriculum_id uuid;
  v_idem text;
BEGIN
  v_caller_is_admin := has_role(auth.uid(), 'admin'::app_role);
  IF NOT v_caller_is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT cp.* INTO v_pkg FROM course_packages cp WHERE cp.id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id; END IF;
  v_curriculum_id := v_pkg.curriculum_id;
  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_CURRICULUM_ID for package %', p_package_id;
  END IF;

  SELECT ps.* INTO v_council FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'quality_council'
   ORDER BY ps.updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUNCIL_STEP_NOT_FOUND for package %', p_package_id; END IF;

  v_score        := NULLIF(v_council.meta->>'score','')::numeric;
  v_badge        := v_council.meta->>'badge';
  v_verdict      := v_council.meta->>'verdict';
  v_rules_failed := COALESCE((v_council.meta->>'rules_failed')::int, 999);

  -- Bronze qualifier: badge + rules_failed authoritative; score floor 75 only.
  -- Do NOT use score>=85 as exclusion: badge='bronze' + rules_failed<=2 wins.
  IF v_badge IS DISTINCT FROM 'bronze'
     OR v_score IS NULL
     OR v_score < 75
     OR v_rules_failed > 2 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'NOT_BRONZE',
      'badge', v_badge, 'score', v_score, 'rules_failed', v_rules_failed, 'verdict', v_verdict);
  END IF;

  v_attempts := COALESCE((v_pkg.feature_flags->'bronze'->>'repair_attempts')::int, 0);
  IF (v_pkg.feature_flags->'bronze'->>'repair_active')::boolean = true THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'REPAIR_ALREADY_ACTIVE', 'attempts', v_attempts);
  END IF;
  IF v_attempts >= 1 THEN
    UPDATE course_packages
       SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
             COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
               'requires_review', true, 'final_state', 'requires_review',
               'final_state_at', now(), 'last_score', v_score), true)
     WHERE id = p_package_id;
    RETURN jsonb_build_object('terminal', true, 'attempts', v_attempts, 'score', v_score);
  END IF;

  v_failed_rules  := COALESCE(v_council.meta->'failed_rules', '[]'::jsonb);
  v_repair_vector := COALESCE(v_council.meta->'repair_vector', '{}'::jsonb);
  v_dispatch_kind := CASE
    WHEN v_repair_vector ? 'lf_coverage_gap' AND jsonb_array_length(COALESCE(v_repair_vector->'lf_coverage_gap','[]'::jsonb)) > 0 THEN 'targeted_competency_fill'
    WHEN v_repair_vector ? 'weak_competencies' AND jsonb_array_length(COALESCE(v_repair_vector->'weak_competencies','[]'::jsonb)) > 0 THEN 'targeted_blueprint_fill'
    ELSE 'elite_harden'
  END;

  v_idem := 'bronze_repair:' || p_package_id::text || ':' || (v_attempts + 1)::text;

  -- Insert job FIRST. Only on success do we flip repair_active.
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
    VALUES (
      'package_' || v_dispatch_kind, p_package_id, 'pending', 7,
      jsonb_build_object(
        'package_id', p_package_id,
        'curriculum_id', v_curriculum_id,
        'enqueue_source', 'bronze_targeted_repair',
        'failed_rules', v_failed_rules,
        'repair_vector', v_repair_vector,
        'bronze_attempt', v_attempts + 1,
        'origin_council_score', v_score,
        'origin_council_rules_failed', v_rules_failed
      ),
      jsonb_build_object('bronze_repair', true, 'attempt', v_attempts + 1,
        'enqueue_source', 'bronze_targeted_repair', 'bronze_lock_override', true),
      v_idem
    )
    RETURNING id INTO v_job_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_job_id FROM job_queue WHERE idempotency_key = v_idem LIMIT 1;
    RETURN jsonb_build_object('skipped', true, 'reason', 'JOB_ALREADY_ENQUEUED',
      'job_id', v_job_id, 'attempt', v_attempts + 1);
  END;

  -- Job insert succeeded → flip flags. requires_review stays true during repair;
  -- only successful repair (separate path) is allowed to clear it.
  UPDATE course_packages
     SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
           COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
             'repair_active', true, 'repair_attempts', v_attempts + 1,
             'repair_started_at', now(), 'repair_job_id', v_job_id,
             'repair_kind', v_dispatch_kind, 'requires_review', true,
             'final_state', NULL), true)
   WHERE id = p_package_id;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('admin_bronze_targeted_repair_dispatch','bronze_targeted_repair_dispatched',
          p_package_id::text,'package','success',
          format('Bronze repair attempt #%s dispatched: %s (score=%s rules_failed=%s)',
                 v_attempts + 1, v_dispatch_kind, v_score, v_rules_failed),
          jsonb_build_object('package_id', p_package_id, 'job_id', v_job_id,
            'kind', v_dispatch_kind, 'attempt', v_attempts + 1,
            'score', v_score, 'rules_failed', v_rules_failed));

  RETURN jsonb_build_object('dispatched', true, 'job_id', v_job_id,
    'kind', v_dispatch_kind, 'attempt', v_attempts + 1,
    'score', v_score, 'rules_failed', v_rules_failed);
END;
$function$;