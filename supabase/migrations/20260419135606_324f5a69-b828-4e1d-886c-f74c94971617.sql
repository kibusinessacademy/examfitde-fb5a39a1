
DROP FUNCTION IF EXISTS public.admin_heal_step_job_coupling(text[]);

CREATE OR REPLACE FUNCTION public.admin_heal_step_job_coupling(
  _step_keys text[] DEFAULT ARRAY[
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'auto_seed_exam_blueprints','validate_blueprints','generate_blueprint_variants',
    'validate_blueprint_variants','promote_blueprint_variants','generate_exam_pool',
    'validate_exam_pool','repair_exam_pool_quality','build_ai_tutor_index',
    'validate_tutor_index','generate_oral_exam','validate_oral_exam',
    'generate_lesson_minichecks','validate_lesson_minichecks','generate_handbook',
    'validate_handbook','enqueue_handbook_expand','expand_handbook',
    'validate_handbook_depth','elite_harden','run_integrity_check',
    'quality_council','auto_publish'
  ]
)
RETURNS TABLE(
  package_id uuid,
  step_key text,
  action text,
  job_id uuid,
  err text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  new_job_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT
      ps.package_id AS pkg_id,
      ps.step_key::text AS step_key_t,
      cp.curriculum_id AS curr_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND ps.step_key::text = ANY(_step_keys)
      AND cp.status = 'building'
      AND cp.curriculum_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = 'package_' || ps.step_key::text
          AND jq.status IN ('pending','queued','processing','running','batch_pending')
      )
  LOOP
    BEGIN
      INSERT INTO job_queue(job_type, payload, status, max_attempts, priority, package_id, meta)
      VALUES (
        'package_' || r.step_key_t,
        jsonb_build_object('package_id', r.pkg_id, 'curriculum_id', r.curr_id),
        'pending', 8, 50, r.pkg_id,
        jsonb_build_object(
          'source','admin_heal_step_job_coupling_v3',
          'reason','systemwide_coupling_gap_recovery',
          'healed_at', now()
        )
      )
      RETURNING id INTO new_job_id;

      package_id := r.pkg_id;
      step_key := r.step_key_t;
      action := 're_enqueued';
      job_id := new_job_id;
      err := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      package_id := r.pkg_id;
      step_key := r.step_key_t;
      action := 'skipped_trigger_block';
      job_id := NULL;
      err := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE VIEW public.v_ops_step_job_coupling_gaps AS
SELECT
  ps.step_key::text AS step_key,
  cp.status AS package_status,
  COUNT(*) AS gaps,
  COUNT(DISTINCT ps.package_id) AS distinct_packages,
  ROUND(AVG(EXTRACT(EPOCH FROM (now() - ps.updated_at))/60)::numeric, 1) AS avg_age_min,
  ROUND(MAX(EXTRACT(EPOCH FROM (now() - ps.updated_at))/60)::numeric, 1) AS max_age_min
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.status = 'queued'
  AND cp.status = 'building'
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.package_id = ps.package_id
      AND jq.job_type = 'package_' || ps.step_key::text
      AND jq.status IN ('pending','queued','processing','running','batch_pending')
  )
GROUP BY ps.step_key::text, cp.status;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('coupling_heal_15min');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'coupling_heal_15min',
      '*/15 * * * *',
      $sql$SELECT public.admin_heal_step_job_coupling()$sql$
    );
  END IF;
END
$cron$;

SELECT action, step_key, COUNT(*) AS cnt, MIN(err) AS sample_err
FROM public.admin_heal_step_job_coupling()
GROUP BY action, step_key
ORDER BY action, cnt DESC;
