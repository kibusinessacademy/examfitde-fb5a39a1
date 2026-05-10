CREATE OR REPLACE FUNCTION public.admin_repair_hollow_exam_first(
  p_dry_run boolean DEFAULT true,
  p_limit   int     DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin       boolean;
  v_run_id         uuid := gen_random_uuid();
  v_repaired       int  := 0;
  v_jobs_enqueued  int  := 0;
  v_skipped        int  := 0;
  v_planned        jsonb := '[]'::jsonb;
  v_skip           jsonb := '[]'::jsonb;
  r                record;
  v_active_handbook boolean;
  v_active_minich   boolean;
  v_per_pkg_jobs    jsonb;
BEGIN
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  IF NOT v_is_admin AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required'
      USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT *
      FROM public.v_hollow_published_exam_first
     WHERE classification IN ('REPAIR_BOTH','REPAIR_HANDBOOK_ONLY','REPAIR_MINICHECKS_ONLY')
     ORDER BY package_title
     LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  LOOP
    SELECT
      EXISTS (SELECT 1 FROM public.job_queue jq
               WHERE jq.package_id = r.package_id
                 AND jq.job_type = 'package_generate_handbook'
                 AND jq.status IN ('pending','processing','queued')),
      EXISTS (SELECT 1 FROM public.job_queue jq
               WHERE jq.package_id = r.package_id
                 AND jq.job_type = 'package_generate_lesson_minichecks'
                 AND jq.status IN ('pending','processing','queued'))
    INTO v_active_handbook, v_active_minich;

    v_per_pkg_jobs := '[]'::jsonb;

    IF r.needs_handbook THEN
      IF v_active_handbook THEN
        v_skip := v_skip || jsonb_build_object('package_id',r.package_id,'job_type','package_generate_handbook','reason','ACTIVE_JOB_EXISTS');
        v_skipped := v_skipped + 1;
      ELSE
        v_per_pkg_jobs := v_per_pkg_jobs || jsonb_build_object('job_type','package_generate_handbook','reason','HANDBOOK_TOTAL_ZERO');
        IF NOT p_dry_run THEN
          INSERT INTO public.job_queue (job_type,status,payload,package_id,worker_pool,lane,meta,job_name)
          VALUES (
            'package_generate_handbook','pending',
            jsonb_build_object(
              'package_id', r.package_id,
              'curriculum_id', r.curriculum_id,
              'mode','wave6_hollow_exam_first_repair',
              'enqueue_source','wave6_hollow_exam_first_repair',
              '_origin','wave6_hollow_exam_first_repair'
            ),
            r.package_id,'content',
            public.derive_job_lane('package_generate_handbook'),
            jsonb_build_object('wave','wave6','run_id',v_run_id),
            'wave6.handbook'
          );
          v_jobs_enqueued := v_jobs_enqueued + 1;
        END IF;
      END IF;
    END IF;

    IF r.needs_minichecks THEN
      IF v_active_minich THEN
        v_skip := v_skip || jsonb_build_object('package_id',r.package_id,'job_type','package_generate_lesson_minichecks','reason','ACTIVE_JOB_EXISTS');
        v_skipped := v_skipped + 1;
      ELSE
        v_per_pkg_jobs := v_per_pkg_jobs || jsonb_build_object('job_type','package_generate_lesson_minichecks','reason','MINICHECKS_APPROVED_ZERO');
        IF NOT p_dry_run THEN
          INSERT INTO public.job_queue (job_type,status,payload,package_id,worker_pool,lane,meta,job_name)
          VALUES (
            'package_generate_lesson_minichecks','pending',
            jsonb_build_object(
              'package_id', r.package_id,
              'curriculum_id', r.curriculum_id,
              'mode','wave6_hollow_exam_first_repair',
              'enqueue_source','wave6_hollow_exam_first_repair',
              '_origin','wave6_hollow_exam_first_repair'
            ),
            r.package_id,'content',
            public.derive_job_lane('package_generate_lesson_minichecks'),
            jsonb_build_object('wave','wave6','run_id',v_run_id),
            'wave6.minichecks'
          );
          v_jobs_enqueued := v_jobs_enqueued + 1;
        END IF;
      END IF;
    END IF;

    IF jsonb_array_length(v_per_pkg_jobs) > 0 THEN
      v_repaired := v_repaired + 1;
      v_planned := v_planned || jsonb_build_object(
        'package_id', r.package_id,
        'package_title', r.package_title,
        'classification', r.classification,
        'jobs', v_per_pkg_jobs
      );
    END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'wave6_hollow_exam_first_repair','system',NULL,
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'applied' END,
    jsonb_build_object(
      'run_id',v_run_id,'dry_run',p_dry_run,'limit',p_limit,
      'repaired_packages',v_repaired,'jobs_enqueued',v_jobs_enqueued,'skipped',v_skipped,
      'planned',v_planned,'skip_details',v_skip
    )
  );

  RETURN jsonb_build_object(
    'ok',true,'run_id',v_run_id,'dry_run',p_dry_run,
    'repaired_packages',v_repaired,'jobs_enqueued',v_jobs_enqueued,'skipped',v_skipped,
    'remaining_hollow_after',(
      SELECT COUNT(*) FROM public.v_hollow_published_exam_first
       WHERE classification IN ('REPAIR_BOTH','REPAIR_HANDBOOK_ONLY','REPAIR_MINICHECKS_ONLY')
    ),
    'planned',v_planned,'skip_details',v_skip
  );
END;
$$;