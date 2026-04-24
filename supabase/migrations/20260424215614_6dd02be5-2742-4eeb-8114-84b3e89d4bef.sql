-- ── 1. Validator v2 ──
CREATE OR REPLACE FUNCTION public.admin_validate_repair_job_type(_job_type text, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text := _payload->>'mode';
  v_is_repair bool := COALESCE((_payload->>'is_repair')::bool, false);
  v_valid bool := true;
  v_warning text := NULL;
  v_severity text := 'info';
BEGIN
  IF _job_type = 'package_exam_rebalance' AND v_mode IN (
    'targeted_competency_fill','targeted_blueprint_fill','targeted_lf_fill','targeted_difficulty_fill'
  ) THEN
    v_valid := false; v_severity := 'high';
    v_warning := format('Rebalance darf keine Coverage-Lücken reparieren (mode=%s). Erwartet: package_repair_exam_pool_*', v_mode);
    RETURN jsonb_build_object('valid',v_valid,'warning',v_warning,'severity',v_severity,'job_type',_job_type,'mode',v_mode);
  END IF;

  IF v_mode = 'targeted_blueprint_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_lf_coverage' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('Blueprint-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_lf_coverage', v_mode, _job_type);
    END IF;
  ELSIF v_mode = 'targeted_competency_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_competency_coverage' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('Competency-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_competency_coverage', v_mode, _job_type);
    END IF;
  ELSIF v_mode = 'targeted_lf_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_lf_coverage' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('LF-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_lf_coverage', v_mode, _job_type);
    END IF;
  ELSIF v_mode = 'targeted_difficulty_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_quality' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('Difficulty-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_quality', v_mode, _job_type);
    END IF;
  ELSIF v_is_repair AND v_mode IS NULL THEN
    v_valid := false; v_severity := 'medium';
    v_warning := format('Repair-Job %s ohne mode-Flag im Payload', _job_type);
  END IF;

  RETURN jsonb_build_object('valid',v_valid,'warning',v_warning,'severity',v_severity,'job_type',_job_type,'mode',v_mode);
END;
$function$;

-- ── 2. Resolver v2 ──
CREATE OR REPLACE FUNCTION public.admin_resolve_repair_strategy_for_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg record;
  v_curriculum_id uuid;
  v_competencies_missing_questions uuid[];
  v_lf_missing uuid[];
  v_total_blueprints int;
  v_total_competencies int;
  v_total_lf int;
  v_active_repair_count int;
  v_recent_no_effect_count int;
  v_approved_total int;
  v_hardish_count int;
  v_hardish_pct numeric;
  v_target_hardish_pct numeric := 35;
  v_strategy text;
  v_job_type text;
  v_payload jsonb;
  v_reason text;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('strategy','forbidden','reason','admin_only');
  END IF;

  SELECT id, curriculum_id, status, track INTO v_pkg
  FROM public.course_packages WHERE id = _package_id;

  IF NOT FOUND OR v_pkg.curriculum_id IS NULL THEN
    RETURN jsonb_build_object('strategy','manual_review_required','reason','no_package_or_curriculum');
  END IF;

  v_curriculum_id := v_pkg.curriculum_id;

  IF v_pkg.track = 'EXAM_FIRST_PLUS' THEN v_target_hardish_pct := 45;
  ELSIF v_pkg.track = 'EXAM_FIRST' THEN v_target_hardish_pct := 35;
  END IF;

  SELECT count(*) INTO v_active_repair_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND status = ANY(public.fn_job_active_statuses())
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage',
      'package_repair_exam_pool_quality'
    );

  IF v_active_repair_count > 0 THEN
    RETURN jsonb_build_object('strategy','no_action_active_job_exists',
      'reason', format('%s active repair job(s) exist', v_active_repair_count));
  END IF;

  SELECT count(*) INTO v_recent_no_effect_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage',
      'package_repair_exam_pool_quality'
    )
    AND status IN ('failed','cancelled')
    AND COALESCE(updated_at, created_at) > now() - interval '24 hours'
    AND (
      COALESCE(meta->>'progress_delta','0')::int = 0
      OR COALESCE(last_error,'') ILIKE '%NO_EFFECT%'
      OR COALESCE(last_error,'') ILIKE '%NO_PROGRESS%'
    );

  IF v_recent_no_effect_count >= 3 THEN
    RETURN jsonb_build_object('strategy','manual_review_required',
      'reason','recent_no_effect_or_no_progress_history');
  END IF;

  SELECT count(*) INTO v_total_lf
  FROM public.learning_fields lf WHERE lf.curriculum_id = v_curriculum_id;

  SELECT count(*) INTO v_total_competencies
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  IF v_total_competencies = 0 OR v_total_lf = 0 THEN
    RETURN jsonb_build_object('strategy','manual_review_required','reason','no_curriculum_structure');
  END IF;

  SELECT COALESCE(array_agg(lf.id), ARRAY[]::uuid[]) INTO v_lf_missing
  FROM public.learning_fields lf
  LEFT JOIN public.exam_questions eq ON eq.learning_field_id = lf.id
    AND (eq.status = 'approved' OR eq.qc_status = 'approved')
  WHERE lf.curriculum_id = v_curriculum_id
  GROUP BY lf.id
  HAVING COUNT(eq.id) = 0;

  SELECT COALESCE(array_agg(x.id), ARRAY[]::uuid[]) INTO v_competencies_missing_questions
  FROM (
    SELECT c.id
    FROM public.competencies c
    JOIN public.learning_fields lf ON lf.id = c.learning_field_id
    LEFT JOIN public.exam_questions eq
      ON eq.competency_id = c.id
     AND eq.curriculum_id = v_curriculum_id
     AND (eq.status = 'approved' OR eq.qc_status = 'approved')
    WHERE lf.curriculum_id = v_curriculum_id
    GROUP BY c.id
    HAVING COUNT(eq.id) < 3
  ) x;

  SELECT count(*) INTO v_approved_total
  FROM public.exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND (eq.status='approved' OR eq.qc_status='approved');

  SELECT count(*) INTO v_hardish_count
  FROM public.exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND (eq.status='approved' OR eq.qc_status='approved')
    AND eq.difficulty = 'hard'
    AND eq.cognitive_level IN ('apply','analyze','evaluate','create');

  v_hardish_pct := CASE WHEN v_approved_total > 0
    THEN (v_hardish_count::numeric * 100 / v_approved_total) ELSE 0 END;

  SELECT count(*) INTO v_total_blueprints
  FROM public.question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  IF array_length(v_lf_missing, 1) > 0 THEN
    v_strategy := 'package_repair_exam_pool_lf_coverage';
    v_job_type := 'package_repair_exam_pool_lf_coverage';
    v_payload  := jsonb_build_object(
      'package_id', _package_id, 'curriculum_id', v_curriculum_id,
      'is_repair', true, 'mode', 'targeted_lf_fill',
      'target_lf_ids', to_jsonb(v_lf_missing),
      'continuation_of_targeted_fill', false, 'continuation_depth', 0,
      'source_cluster', 'REPAIR_LF_COVERAGE'
    );
    v_reason := format('lf_coverage_gap_%s_of_%s', array_length(v_lf_missing,1), v_total_lf);

  ELSIF array_length(v_competencies_missing_questions, 1) > 0 THEN
    IF v_total_blueprints = 0 THEN
      v_strategy := 'package_repair_exam_pool_lf_coverage';
      v_job_type := 'package_repair_exam_pool_lf_coverage';
      v_payload  := jsonb_build_object(
        'package_id', _package_id, 'curriculum_id', v_curriculum_id,
        'is_repair', true, 'mode', 'targeted_blueprint_fill',
        'target_competency_ids', to_jsonb(v_competencies_missing_questions),
        'continuation_of_targeted_fill', false, 'continuation_depth', 0,
        'source_cluster', 'REPAIR_COMPETENCY_COVERAGE'
      );
      v_reason := 'no_approved_question_blueprints';
    ELSE
      v_strategy := 'package_repair_exam_pool_competency_coverage';
      v_job_type := 'package_repair_exam_pool_competency_coverage';
      v_payload  := jsonb_build_object(
        'package_id', _package_id, 'curriculum_id', v_curriculum_id,
        'is_repair', true, 'mode', 'targeted_competency_fill',
        'target_competency_ids', to_jsonb(v_competencies_missing_questions),
        'continuation_of_targeted_fill', false, 'continuation_depth', 0,
        'source_cluster', 'REPAIR_COMPETENCY_COVERAGE'
      );
      v_reason := format('missing_min_questions_for_%s_competencies', array_length(v_competencies_missing_questions,1));
    END IF;

  ELSIF v_approved_total >= 50 AND v_hardish_pct < v_target_hardish_pct THEN
    v_strategy := 'package_repair_exam_pool_quality';
    v_job_type := 'package_repair_exam_pool_quality';
    v_payload  := jsonb_build_object(
      'package_id', _package_id, 'curriculum_id', v_curriculum_id,
      'is_repair', true, 'mode', 'targeted_difficulty_fill',
      'target_distribution', jsonb_build_object(
        'hardish_pct', v_target_hardish_pct,
        'current_hardish_pct', v_hardish_pct
      ),
      'continuation_of_targeted_fill', false, 'continuation_depth', 0,
      'source_cluster', 'REPAIR_HARDISH_TOO_LOW'
    );
    v_reason := format('hardish_too_low_%s_pct_target_%s_pct', round(v_hardish_pct,1), round(v_target_hardish_pct,0));

  ELSE
    v_strategy := 'no_action_no_deficit';
    v_job_type := NULL;
    v_payload  := '{}'::jsonb;
    v_reason   := format('all_gates_ok_approved=%s_lf=%s_comp=%s_hardish=%s',
      v_approved_total, v_total_lf, v_total_competencies, round(v_hardish_pct,1));
  END IF;

  RETURN jsonb_build_object(
    'strategy', v_strategy, 'job_type', v_job_type,
    'payload',  v_payload, 'reason',   v_reason,
    'target_competency_ids', to_jsonb(COALESCE(v_competencies_missing_questions,'{}'::uuid[])),
    'target_lf_ids',         to_jsonb(COALESCE(v_lf_missing,'{}'::uuid[])),
    'total_competencies',    v_total_competencies,
    'total_lf',              v_total_lf,
    'total_blueprints',      v_total_blueprints,
    'approved_questions',    v_approved_total,
    'hardish_pct',           v_hardish_pct,
    'target_hardish_pct',    v_target_hardish_pct
  );
END;
$function$;

-- ── 3. fn_auto_heal_cluster: erweitere um neue Cluster-Keys ──
CREATE OR REPLACE FUNCTION public.fn_auto_heal_cluster(_cluster text, _max_jobs integer DEFAULT 25, _dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_processed int := 0;
  v_skipped int := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_resolver jsonb;
  v_validation jsonb;
  v_job_type text;
  v_payload jsonb;
  v_strategy text;
  v_dup_exists bool;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  FOR v_job IN
    SELECT q.*, c.cluster, c.subcluster, c.error_class AS effective_error_class
    FROM public.job_queue q
    JOIN public.v_admin_queue_job_classification c ON c.id = q.id
    WHERE c.cluster = _cluster AND q.status IN ('failed','cancelled','processing')
    ORDER BY q.updated_at DESC NULLS LAST LIMIT _max_jobs
  LOOP
    BEGIN
      IF _dry_run THEN
        v_processed := v_processed + 1; CONTINUE;
      END IF;

      IF _cluster = 'STALE_LOCK_LOOP_HARD_KILL' THEN
        UPDATE public.job_queue SET status='pending',
          attempts=GREATEST(0,COALESCE(attempts,0)-1),
          locked_at=NULL, locked_by=NULL,
          run_after=now()+interval '15 seconds', updated_at=now()
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster IN (
        'HARD_FAIL_REPAIR_EXHAUSTED','REPAIR_COMPETENCY_COVERAGE',
        'REPAIR_LF_COVERAGE','REPAIR_HARDISH_TOO_LOW','REPAIR_INSUFFICIENT_QUESTIONS'
      ) THEN
        v_resolver := public.admin_resolve_repair_strategy_for_package(v_job.package_id);
        v_strategy := v_resolver->>'strategy';
        v_job_type := v_resolver->>'job_type';
        v_payload := v_resolver->'payload';

        IF v_strategy IN ('no_action_active_job_exists','no_action_no_deficit','manual_review_required','forbidden')
           OR v_job_type IS NULL THEN
          v_skipped := v_skipped + 1; CONTINUE;
        END IF;

        v_validation := public.admin_validate_repair_job_type(v_job_type, v_payload);

        IF NOT COALESCE((v_validation->>'valid')::boolean, false) THEN
          v_warnings := v_warnings || jsonb_build_object('job_id',v_job.id,'package_id',v_job.package_id,
            'warning',v_validation->>'warning','severity',v_validation->>'severity');
          IF COALESCE(v_validation->>'severity','') = 'high' THEN
            INSERT INTO public.admin_notifications(title,body,severity,category,entity_type,entity_id,metadata)
            VALUES ('Repair Job-Type Mismatch', v_validation->>'warning','high','queue_validation',
              'course_package', v_job.package_id,
              jsonb_build_object('job_type',v_job_type,'mode',v_validation->>'mode',
                'source_job',v_job.id,'source_cluster',_cluster));
            v_skipped := v_skipped + 1; CONTINUE;
          END IF;
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM public.job_queue j
          WHERE j.package_id = v_job.package_id AND j.job_type = v_job_type
            AND j.status = ANY(public.fn_job_active_statuses())
            AND COALESCE(j.payload->>'mode','') = COALESCE(v_payload->>'mode','')
        ) INTO v_dup_exists;

        IF v_dup_exists THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

        UPDATE public.job_queue SET status='cancelled',
          completed_at = COALESCE(completed_at, now()), updated_at = now(),
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'superseded_by_auto_heal', true, 'superseded_at', now(),
            'superseded_by_cluster', _cluster, 'resolved_strategy', v_strategy,
            'resolved_job_type', v_job_type)
        WHERE id = v_job.id;

        INSERT INTO public.job_queue(job_type, package_id, payload, status, run_after, priority, max_attempts, meta)
        VALUES (v_job_type, v_job.package_id, v_payload, 'pending',
          now() + interval '15 seconds', 100, 3,
          jsonb_build_object('auto_heal_origin',_cluster,'source_job_id',v_job.id,
            'resolver_reason',v_resolver->>'reason','job_type_validation',v_validation,
            'source_cluster',_cluster,
            'root_job_id', COALESCE(v_job.meta->>'root_job_id', v_job.id::text)));
        v_processed := v_processed + 1;

      ELSIF _cluster = 'REQUEUE_LOOP_KILLED' THEN
        IF NOT public.admin_has_recent_terminal_notification(v_job.package_id, v_job.job_type) THEN
          INSERT INTO public.admin_notifications(title,body,severity,category,entity_type,entity_id,metadata)
          VALUES ('Requeue-Loop terminal',
            format('Job %s (%s) terminal markiert', v_job.id, v_job.job_type),
            'high','queue_terminal','course_package',v_job.package_id,
            jsonb_build_object('source_job_id',v_job.id,'job_type',v_job.job_type));
        END IF;
        UPDATE public.job_queue SET status='cancelled',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'retry_path_terminal', true, 'terminal_scope', 'job_type_for_package',
            'terminal_reason', 'requeue_loop_killed')
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster = 'UNCLASSIFIED_EMPTY' THEN
        UPDATE public.job_queue SET status='pending',
          attempts = GREATEST(0, COALESCE(attempts,0) - 1),
          run_after = now() + interval '15 seconds',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'effective_error_class', COALESCE(meta->>'error_class', meta->>'error_code'),
            'reclassified_from_meta', true, 'reclassified_at', now())
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSE
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('job_id', v_job.id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('cluster',_cluster,'dry_run',_dry_run,
    'processed',v_processed,'skipped',v_skipped,
    'warnings',v_warnings,'errors',v_errors,'completed_at',now());
END;
$function$;

-- ── 4. Suggest-Repair-Action für UI ──
CREATE OR REPLACE FUNCTION public.admin_suggest_repair_action(_package_id uuid, _dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_resolver jsonb;
  v_strategy text;
  v_job_type text;
  v_payload jsonb;
  v_validation jsonb;
  v_dup_exists bool;
  v_new_job_id uuid;
  v_risk text;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  v_resolver := public.admin_resolve_repair_strategy_for_package(_package_id);
  v_strategy := v_resolver->>'strategy';
  v_job_type := v_resolver->>'job_type';
  v_payload := v_resolver->'payload';

  v_risk := CASE
    WHEN v_strategy LIKE 'no_action%' THEN 'none'
    WHEN v_strategy = 'manual_review_required' THEN 'high'
    WHEN v_strategy = 'forbidden' THEN 'high'
    WHEN v_payload->>'mode' = 'targeted_competency_fill' THEN 'low'
    WHEN v_payload->>'mode' = 'targeted_lf_fill' THEN 'medium'
    WHEN v_payload->>'mode' = 'targeted_difficulty_fill' THEN 'low'
    WHEN v_payload->>'mode' = 'targeted_blueprint_fill' THEN 'medium'
    ELSE 'medium'
  END;

  IF v_job_type IS NULL THEN
    RETURN jsonb_build_object('suggestion',v_resolver,'risk',v_risk,
      'applied',false,'dry_run',_dry_run,
      'message',COALESCE(v_resolver->>'reason','no_action_required'));
  END IF;

  v_validation := public.admin_validate_repair_job_type(v_job_type, v_payload);

  SELECT EXISTS (
    SELECT 1 FROM public.job_queue j
    WHERE j.package_id = _package_id AND j.job_type = v_job_type
      AND j.status = ANY(public.fn_job_active_statuses())
      AND COALESCE(j.payload->>'mode','') = COALESCE(v_payload->>'mode','')
  ) INTO v_dup_exists;

  IF _dry_run OR v_dup_exists OR NOT COALESCE((v_validation->>'valid')::boolean, false) THEN
    RETURN jsonb_build_object('suggestion',v_resolver,'validation',v_validation,
      'risk',v_risk,'duplicate_exists',v_dup_exists,'applied',false,'dry_run',_dry_run);
  END IF;

  INSERT INTO public.job_queue(job_type, package_id, payload, status, run_after, priority, max_attempts, meta)
  VALUES (v_job_type, _package_id, v_payload, 'pending',
    now() + interval '5 seconds', 100, 3,
    jsonb_build_object('auto_heal_origin','manual_suggest_apply',
      'resolver_reason',v_resolver->>'reason',
      'job_type_validation',v_validation,'applied_by',auth.uid()))
  RETURNING id INTO v_new_job_id;

  RETURN jsonb_build_object('suggestion',v_resolver,'validation',v_validation,
    'risk',v_risk,'applied',true,'dry_run',false,'new_job_id',v_new_job_id);
END;
$function$;