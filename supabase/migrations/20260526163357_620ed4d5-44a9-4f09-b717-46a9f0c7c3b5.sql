
ALTER TABLE public.exam_blueprints
  ADD COLUMN IF NOT EXISTS reconstruction_source text,
  ADD COLUMN IF NOT EXISTS reconstructed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reconstructed_by      text;

COMMENT ON COLUMN public.exam_blueprints.reconstruction_source IS
  'P74c: Herkunft falls deterministisch backfilled (z.B. question_blueprints_inventory). NULL = originär.';

COMMENT ON TABLE public.blueprint_variants IS
  'DEPRECATED P74c (2026-05-26): Echte Runtime-SSOT ist blueprint_variant_inventory. Keine neuen Writes — CI-Guard folgt.';

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('exam_blueprint_backfilled',
   ARRAY['package_id','curriculum_id','approved_qbp_count','variant_inventory_count','source'],
   'p74c_backfill'),
  ('exam_blueprint_backfill_skipped',
   ARRAY['package_id','reason'],
   'p74c_backfill')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_backfill_missing_exam_blueprint(
  p_package_id uuid,
  p_dry_run    boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg             record;
  v_existing_id     uuid;
  v_approved_qbp    integer := 0;
  v_inventory_cnt   integer := 0;
  v_approved_eq     integer := 0;
  v_active_jobs     integer := 0;
  v_active_job_types text[];
  v_diff_easy       numeric := 0.3;
  v_diff_medium     numeric := 0.5;
  v_diff_hard       numeric := 0.2;
  v_diff_total      integer := 0;
  v_est_pool_size   integer := 0;
  v_new_id          uuid;
  v_title           text;
  v_bronze_locked   boolean;
  v_result          jsonb;
  v_active_set      text[] := ARRAY[
    'validate_exam_pool','generate_oral_exam','elite_harden',
    'package_quality_council','package_run_integrity_check','package_auto_publish'
  ];
BEGIN
  SELECT cp.id, cp.package_key, cp.title, cp.curriculum_id, cp.status,
         public.fn_is_bronze_locked(cp.id) AS bronze_locked
  INTO v_pkg
  FROM public.course_packages cp WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('would_insert',false,'reason','package_not_found',
      'package_id',p_package_id,'dry_run',p_dry_run);
  END IF;

  v_bronze_locked := v_pkg.bronze_locked;

  IF v_pkg.curriculum_id IS NULL THEN
    v_result := jsonb_build_object('would_insert',false,'reason','no_curriculum',
      'package_id',p_package_id,'package_key',v_pkg.package_key,
      'bronze_locked',v_bronze_locked,'dry_run',p_dry_run);
    IF NOT p_dry_run THEN
      PERFORM public.fn_emit_audit('exam_blueprint_backfill_skipped',
        p_target_type:='course_package', p_target_id:=p_package_id,
        p_result_status:='skipped',
        p_metadata:=jsonb_build_object('package_id',p_package_id,'reason','no_curriculum'));
    END IF;
    RETURN v_result;
  END IF;

  SELECT eb.id INTO v_existing_id
  FROM public.exam_blueprints eb
  WHERE eb.curriculum_id = v_pkg.curriculum_id OR eb.package_id = p_package_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    v_result := jsonb_build_object('would_insert',false,'reason','already_exists',
      'existing_blueprint_id',v_existing_id,
      'package_id',p_package_id,'package_key',v_pkg.package_key,
      'bronze_locked',v_bronze_locked,'dry_run',p_dry_run);
    IF NOT p_dry_run THEN
      PERFORM public.fn_emit_audit('exam_blueprint_backfill_skipped',
        p_target_type:='course_package', p_target_id:=p_package_id,
        p_result_status:='skipped',
        p_metadata:=jsonb_build_object('package_id',p_package_id,'reason','already_exists',
                                       'existing_blueprint_id',v_existing_id));
    END IF;
    RETURN v_result;
  END IF;

  SELECT COUNT(*), COALESCE(ARRAY_AGG(DISTINCT jq.job_type), ARRAY[]::text[])
  INTO v_active_jobs, v_active_job_types
  FROM public.job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type = ANY(v_active_set)
    AND jq.status IN ('pending','processing');

  SELECT COUNT(*) INTO v_approved_qbp
  FROM public.question_blueprints qb
  WHERE qb.curriculum_id = v_pkg.curriculum_id
    AND (qb.package_id = p_package_id OR qb.package_id IS NULL)
    AND qb.approved_at IS NOT NULL;

  SELECT COUNT(*) INTO v_inventory_cnt
  FROM public.blueprint_variant_inventory bvi
  WHERE bvi.package_id = p_package_id OR bvi.curriculum_id = v_pkg.curriculum_id;

  SELECT COUNT(*) INTO v_approved_eq
  FROM public.exam_questions eq
  WHERE eq.package_id = p_package_id AND eq.status = 'approved';

  v_est_pool_size := GREATEST(v_approved_qbp, v_inventory_cnt, v_approved_eq);

  IF v_approved_qbp < 30 THEN
    v_result := jsonb_build_object('would_insert',false,'reason','insufficient_approved_qbp',
      'package_id',p_package_id,'package_key',v_pkg.package_key,
      'approved_qbp_count',v_approved_qbp,'inventory_count',v_inventory_cnt,
      'approved_questions',v_approved_eq,'estimated_pool_size',v_est_pool_size,
      'active_jobs_detected',v_active_jobs,'active_job_types',to_jsonb(v_active_job_types),
      'bronze_locked',v_bronze_locked,'dry_run',p_dry_run);
    IF NOT p_dry_run THEN
      PERFORM public.fn_emit_audit('exam_blueprint_backfill_skipped',
        p_target_type:='course_package', p_target_id:=p_package_id,
        p_result_status:='skipped',
        p_metadata:=jsonb_build_object('package_id',p_package_id,'reason','insufficient_approved_qbp',
                                       'approved_qbp_count',v_approved_qbp));
    END IF;
    RETURN v_result;
  END IF;

  IF v_active_jobs > 0 THEN
    v_result := jsonb_build_object('would_insert',false,'reason','active_jobs',
      'package_id',p_package_id,'package_key',v_pkg.package_key,
      'approved_qbp_count',v_approved_qbp,'inventory_count',v_inventory_cnt,
      'approved_questions',v_approved_eq,'estimated_pool_size',v_est_pool_size,
      'active_jobs_detected',v_active_jobs,'active_job_types',to_jsonb(v_active_job_types),
      'bronze_locked',v_bronze_locked,'dry_run',p_dry_run);
    IF NOT p_dry_run THEN
      PERFORM public.fn_emit_audit('exam_blueprint_backfill_skipped',
        p_target_type:='course_package', p_target_id:=p_package_id,
        p_result_status:='skipped_active_jobs',
        p_metadata:=jsonb_build_object('package_id',p_package_id,'reason','active_jobs',
                                       'active_jobs_detected',v_active_jobs,
                                       'active_job_types',to_jsonb(v_active_job_types)));
    END IF;
    RETURN v_result;
  END IF;

  IF v_approved_eq >= 10 THEN
    SELECT
      COALESCE(COUNT(*) FILTER (WHERE eq.difficulty = 'easy')::numeric   / NULLIF(COUNT(*)::numeric,0), 0.3),
      COALESCE(COUNT(*) FILTER (WHERE eq.difficulty = 'medium')::numeric / NULLIF(COUNT(*)::numeric,0), 0.5),
      COALESCE(COUNT(*) FILTER (WHERE eq.difficulty = 'hard')::numeric   / NULLIF(COUNT(*)::numeric,0), 0.2),
      COUNT(*)::int
    INTO v_diff_easy, v_diff_medium, v_diff_hard, v_diff_total
    FROM public.exam_questions eq
    WHERE eq.package_id = p_package_id AND eq.status = 'approved' AND eq.difficulty IS NOT NULL;

    IF (v_diff_easy + v_diff_medium + v_diff_hard) < 0.01 THEN
      v_diff_easy := 0.3; v_diff_medium := 0.5; v_diff_hard := 0.2;
    ELSE
      v_diff_easy := ROUND(v_diff_easy,2);
      v_diff_medium := ROUND(v_diff_medium,2);
      v_diff_hard := ROUND(v_diff_hard,2);
    END IF;
  END IF;

  v_title := 'Rahmenlehrplan ' || COALESCE(v_pkg.title, v_pkg.package_key) || ' – Standard-Prüfung';

  IF p_dry_run THEN
    RETURN jsonb_build_object('would_insert',true,'reason','ready',
      'package_id',p_package_id,'package_key',v_pkg.package_key,
      'curriculum_id',v_pkg.curriculum_id,'planned_title',v_title,
      'approved_qbp_count',v_approved_qbp,'inventory_count',v_inventory_cnt,
      'approved_questions',v_approved_eq,'estimated_pool_size',v_est_pool_size,
      'active_jobs_detected',v_active_jobs,'bronze_locked',v_bronze_locked,
      'difficulty_distribution',jsonb_build_object('easy',v_diff_easy,'medium',v_diff_medium,'hard',v_diff_hard,'derived_from_sample',v_diff_total),
      'dry_run',true);
  END IF;

  INSERT INTO public.exam_blueprints (
    curriculum_id, package_id, title, description,
    total_questions, time_limit_minutes, pass_threshold,
    difficulty_distribution, section_weights, question_types, frozen,
    reconstruction_source, reconstructed_at, reconstructed_by
  ) VALUES (
    v_pkg.curriculum_id, p_package_id, v_title,
    'Deterministisch rekonstruiert (P74c) aus question_blueprints + blueprint_variant_inventory. Keine AI-Generation.',
    60, 90, 0.50,
    jsonb_build_object('easy',v_diff_easy,'medium',v_diff_medium,'hard',v_diff_hard),
    '[]'::jsonb,
    '["single_choice","multiple_choice"]'::jsonb,
    false,
    'question_blueprints_inventory', now(), 'p74c_backfill'
  ) RETURNING id INTO v_new_id;

  PERFORM public.fn_emit_audit('exam_blueprint_backfilled',
    p_target_type:='course_package', p_target_id:=p_package_id,
    p_result_status:='success',
    p_metadata:=jsonb_build_object(
      'package_id',p_package_id,'curriculum_id',v_pkg.curriculum_id,
      'approved_qbp_count',v_approved_qbp,'variant_inventory_count',v_inventory_cnt,
      'approved_questions',v_approved_eq,'source','question_blueprints_inventory',
      'new_blueprint_id',v_new_id,
      'difficulty_distribution',jsonb_build_object('easy',v_diff_easy,'medium',v_diff_medium,'hard',v_diff_hard,'derived_from_sample',v_diff_total)
    ));

  RETURN jsonb_build_object('would_insert',true,'reason','inserted',
    'package_id',p_package_id,'package_key',v_pkg.package_key,
    'curriculum_id',v_pkg.curriculum_id,'new_blueprint_id',v_new_id,
    'approved_qbp_count',v_approved_qbp,'inventory_count',v_inventory_cnt,
    'approved_questions',v_approved_eq,'estimated_pool_size',v_est_pool_size,
    'bronze_locked',v_bronze_locked,
    'difficulty_distribution',jsonb_build_object('easy',v_diff_easy,'medium',v_diff_medium,'hard',v_diff_hard,'derived_from_sample',v_diff_total),
    'dry_run',false);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_backfill_missing_exam_blueprint(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_exam_blueprint(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_backfill_missing_exam_blueprint_dry_run(
  p_limit integer DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_pkg  record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR v_pkg IN
    SELECT package_id, package_key
    FROM public.v_missing_exam_blueprint_packages
    WHERE recoverability_class = 'READY'
    ORDER BY approved_qbp_count DESC
    LIMIT GREATEST(p_limit, 1)
  LOOP
    v_rows := v_rows || public.fn_backfill_missing_exam_blueprint(v_pkg.package_id, true);
  END LOOP;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'limit', p_limit,
    'results', v_rows,
    'summary', jsonb_build_object(
      'would_insert',  (SELECT COUNT(*) FROM jsonb_array_elements(v_rows) e WHERE (e->>'would_insert')::boolean),
      'active_jobs',   (SELECT COUNT(*) FROM jsonb_array_elements(v_rows) e WHERE e->>'reason' = 'active_jobs'),
      'insufficient',  (SELECT COUNT(*) FROM jsonb_array_elements(v_rows) e WHERE e->>'reason' = 'insufficient_approved_qbp'),
      'already_exists',(SELECT COUNT(*) FROM jsonb_array_elements(v_rows) e WHERE e->>'reason' = 'already_exists')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_missing_exam_blueprint_dry_run(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backfill_missing_exam_blueprint_dry_run(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_backfill_missing_exam_blueprint_execute(
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN public.fn_backfill_missing_exam_blueprint(p_package_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_missing_exam_blueprint_execute(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backfill_missing_exam_blueprint_execute(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_backfill_missing_exam_blueprint(uuid, boolean) IS
  'P74c Phase 2 SSOT: idempotenter deterministischer Master-Blueprint-Backfill. Keine AI, kein Status-Flip, kein Bronze-Touch.';
