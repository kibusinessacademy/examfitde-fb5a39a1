DO $$
DECLARE
  v_pkg uuid := 'd2000001-0009-4000-8000-000000000001';
  v_cur uuid := 'c2000000-0014-4000-8000-000000000001';
  v_jid uuid;
BEGIN
  -- Reaktiviere existierenden generate-Job (egal welcher Status)
  UPDATE public.job_queue
     SET status='pending',
         priority=900,
         locked_at=NULL, locked_by=NULL, started_at=NULL, run_after=NULL,
         last_error='HEAL: reactivated by manual_heal_bwl_steuern',
         payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object(
           'package_id', v_pkg, 'curriculum_id', v_cur,
           'source','manual_heal_bwl_steuern'),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'manual_heal_at', now(),
           'manual_heal_reason','hollow_minicheck_artifacts',
           'admin_force_run_at', now()),
         updated_at=now()
   WHERE package_id=v_pkg
     AND job_type='package_generate_lesson_minichecks'
     AND status NOT IN ('completed','cancelled')
   RETURNING id INTO v_jid;

  INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
  VALUES (
    'Manual heal: BWL-Steuern Bachelor — minicheck job reactivated',
    format('Reactivated existing package_generate_lesson_minichecks job (id=%s, priority=900). Steps generate_lesson_minichecks + validate_lesson_minichecks already reset to queued. 0 minicheck_questions for 300 lessons.',
           COALESCE(v_jid::text,'NONE')),
    'ops','info','course_package', v_pkg,
    jsonb_build_object('package_id', v_pkg, 'curriculum_id', v_cur,
      'reactivated_job_id', v_jid, 'lessons_total', 300, 'minicheck_questions_before', 0)
  );
END$$;