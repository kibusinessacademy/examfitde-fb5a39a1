-- =============================================================
-- A) Symptom-Heal 4 Pakete
-- =============================================================
DO $$
DECLARE
  v_pids uuid[] := ARRAY[
    '570ccb3e-2937-4d81-b3d8-624b9be84737',
    '335decc8-9f68-4784-b318-a68f620bf77e',
    '047bc325-5244-4f21-affd-5395bf62bcff',
    '59b6e214-e181-4c2b-986e-1ce544984d04'
  ]::uuid[];
BEGIN
  -- Audit START
  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  SELECT 'manual_bypass_exam_pipeline_v3', 'package', pid, 'started',
    jsonb_build_object(
      'reason','exam_pipeline_skip_artifact_resolved',
      'approved',(SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=pid AND eq.qc_status='approved')
    )
  FROM unnest(v_pids) AS pid;

  -- Cancel obsolete failed jobs (minicheck/learning_content)
  UPDATE job_queue 
  SET status='cancelled', updated_at=now(),
      last_error=COALESCE(last_error,'')||' | manual_bypass_v3: obsolete job, package has ≥1242 approved questions'
  WHERE package_id = ANY(v_pids)
    AND status='failed'
    AND job_type IN ('package_generate_lesson_minichecks','package_generate_learning_content','package_promote_blueprint_variants','package_validate_lesson_minichecks');

  -- Skip komplette Exam-Pool-Pipeline + obsolete minichecks
  UPDATE package_steps
  SET status='skipped', finished_at=now(), updated_at=now(),
    exception_approved=true,
    exception_reason='manual_bypass_v3: ≥1242 approved questions → exam_pool artifact bereits erfüllt',
    exception_approved_at=now(),
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'manual_skip','tail_aware_artifact_resolved_v3',
      'reason','approved_questions_satisfy_artifact'
    )
  WHERE package_id = ANY(v_pids)
    AND step_key IN (
      'auto_seed_exam_blueprints','generate_blueprint_variants','validate_blueprint_variants',
      'validate_blueprints','promote_blueprint_variants','generate_exam_pool','validate_exam_pool',
      'repair_exam_pool_quality','generate_lesson_minichecks'
    )
    AND status NOT IN ('done','skipped');

  -- Debounce-Meta clearen für Tail-Steps
  UPDATE package_steps
  SET meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at',
      updated_at=now()
  WHERE package_id = ANY(v_pids)
    AND step_key IN ('build_ai_tutor_index','validate_tutor_index','generate_oral_exam','validate_oral_exam','run_integrity_check','quality_council','auto_publish')
    AND status NOT IN ('done','skipped');

  -- Verkäufer entsperren queued → building
  UPDATE course_packages SET status='building', updated_at=now()
  WHERE id='59b6e214-e181-4c2b-986e-1ce544984d04' AND status='queued';

  -- Trigger feuern: queued → queued mit +1ms Self-Touch
  UPDATE package_steps
  SET status='queued', updated_at=now() + interval '1 millisecond'
  WHERE package_id = ANY(v_pids)
    AND step_key IN ('build_ai_tutor_index','generate_oral_exam','run_integrity_check')
    AND status='queued';

  -- Audit COMPLETED
  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  SELECT 'manual_bypass_exam_pipeline_v3', 'package', pid, 'completed',
    jsonb_build_object(
      'remaining_open',(SELECT array_agg(ps.step_key||':'||ps.status::text) 
        FROM package_steps ps WHERE ps.package_id=pid AND ps.status NOT IN ('done','skipped'))
    )
  FROM unnest(v_pids) AS pid;
END $$;

-- =============================================================
-- B) Drift-Detector v3 — alle Pipeline-Steps
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_pipeline_step_drift_v3()
RETURNS TABLE(package_id uuid, step_key text, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_recent int;
  v_eligible_steps text[] := ARRAY[
    'scaffold_learning_course','fanout_learning_content',
    'generate_handbook','validate_handbook','expand_handbook','enqueue_handbook_expand','validate_handbook_depth',
    'generate_glossary',
    'generate_learning_content','validate_learning_content','finalize_learning_content',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'auto_seed_exam_blueprints','generate_blueprint_variants','validate_blueprint_variants',
    'validate_blueprints','promote_blueprint_variants','generate_exam_pool','validate_exam_pool',
    'repair_exam_pool_quality',
    'generate_oral_exam','validate_oral_exam',
    'build_ai_tutor_index','validate_tutor_index',
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  ];
BEGIN
  FOR r IN
    SELECT ps.package_id AS pid, ps.step_key AS skey
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status IN ('queued','pending_enqueue')
      AND ps.step_key = ANY(v_eligible_steps)
      AND cp.status IN ('building','queued')
      AND ps.updated_at < now() - interval '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = 'package_'||ps.step_key
          AND jq.status IN ('pending','processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps pps ON pps.package_id=ps.package_id AND pps.step_key=dag.depends_on
        WHERE dag.step_key = ps.step_key
          AND pps.status NOT IN ('done','skipped')
      )
    LIMIT 200  -- Schutz vor explosivem Heal
  LOOP
    -- 30min Cooldown pro (package, step)
    SELECT COUNT(*) INTO v_recent FROM auto_heal_log
    WHERE action_type='pipeline_step_drift_v3_heal'
      AND target_id=r.pid
      AND metadata->>'step_key'=r.skey
      AND created_at > now() - interval '30 minutes';
    IF v_recent > 0 THEN CONTINUE; END IF;

    UPDATE package_steps
    SET meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at', updated_at=now()
    WHERE package_id=r.pid AND step_key=r.skey;

    UPDATE package_steps
    SET status='queued', updated_at=now() + interval '1 millisecond'
    WHERE package_id=r.pid AND step_key=r.skey AND status IN ('queued','pending_enqueue');

    INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('pipeline_step_drift_v3_heal','package',r.pid,'success',
      jsonb_build_object('step_key',r.skey,'reason','no_active_job_predecessors_done'));

    package_id := r.pid;
    step_key := r.skey;
    action := 'enqueue_triggered';
    RETURN NEXT;
  END LOOP;
END;
$$;

-- =============================================================
-- C) Cron: alle 5 Min
-- =============================================================
SELECT cron.schedule(
  'pipeline-step-drift-v3-heal-5min',
  '*/5 * * * *',
  $cron$ SELECT * FROM public.fn_detect_and_heal_pipeline_step_drift_v3(); $cron$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='pipeline-step-drift-v3-heal-5min');