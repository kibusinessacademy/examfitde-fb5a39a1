-- 1) Policy: Seed-Jobs überleben Status-Transitions
INSERT INTO public.job_type_policies (job_type, is_repair, can_run_when_not_building, exempt_from_auto_cancel, worker_pool, notes)
VALUES ('package_seed_oral_blueprints', true, true, true, 'default',
        'EXAM_FIRST oral coverage backfill: must survive package status transitions (queued/building/done).')
ON CONFLICT (job_type) DO UPDATE
  SET is_repair = true,
      can_run_when_not_building = true,
      exempt_from_auto_cancel = true,
      notes = EXCLUDED.notes,
      updated_at = now();

-- 2) Heal-RPC
CREATE OR REPLACE FUNCTION public.admin_heal_exam_first_oral_coverage(
  p_dry_run boolean DEFAULT false,
  p_max int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_targets jsonb := '[]'::jsonb;
  v_enqueued int := 0;
  v_bronze_overrides int := 0;
  v_skipped_pending int := 0;
  v_total_targets int := 0;
  v_run_id uuid := gen_random_uuid();
  rec RECORD;
  v_bronze boolean;
  v_payload jsonb;
BEGIN
  -- Auth-Gate: admin only (cron läuft als SECURITY DEFINER → bypass via session_user check)
  IF NOT (
    session_user IN ('postgres','supabase_admin','service_role','authenticator')
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR rec IN
    SELECT cp.id AS package_id, cp.curriculum_id, cp.title, cp.status::text AS status,
           cp.feature_flags,
           COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean, false) AS bronze_locked
    FROM course_packages cp
    WHERE cp.track::text IN ('EXAM_FIRST','EXAM_FIRST_PLUS')
      AND cp.status::text IN ('queued','building','done','planning')
      AND cp.id::text NOT LIKE 'd2000000-%'
      AND cp.curriculum_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM oral_exam_blueprints oeb
        WHERE oeb.curriculum_id = cp.curriculum_id
          AND oeb.status = 'approved'
      )
    ORDER BY (cp.status::text='building') DESC, cp.created_at ASC
    LIMIT p_max
  LOOP
    v_total_targets := v_total_targets + 1;

    -- Idempotenz: skip wenn schon pending/processing seed job offen
    IF EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = 'package_seed_oral_blueprints'
        AND jq.status IN ('pending','processing','batch_pending','queued')
    ) THEN
      v_skipped_pending := v_skipped_pending + 1;
      v_targets := v_targets || jsonb_build_object(
        'package_id', rec.package_id, 'title', rec.title,
        'action', 'skipped_pending_job_exists');
      CONTINUE;
    END IF;

    v_bronze := rec.bronze_locked;
    v_payload := jsonb_build_object(
      'package_id', rec.package_id,
      'curriculum_id', rec.curriculum_id,
      '_origin', 'exam_first_oral_coverage_heal',
      'reason', 'exam_first_zero_approved_oral_blueprints',
      'run_id', v_run_id,
      'nightly_backfill', true
    );
    IF v_bronze THEN
      v_payload := v_payload || jsonb_build_object('bronze_lock_override', true);
      v_bronze_overrides := v_bronze_overrides + 1;
    END IF;

    IF NOT p_dry_run THEN
      INSERT INTO job_queue (job_type, package_id, status, payload, run_after, attempts, max_attempts)
      VALUES ('package_seed_oral_blueprints', rec.package_id, 'pending', v_payload, now(), 0, 3);

      INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('exam_first_oral_coverage_heal',
              'admin_heal_exam_first_oral_coverage',
              'course_package', rec.package_id::text,
              'enqueued',
              format('Enqueued package_seed_oral_blueprints (bronze_override=%s)', v_bronze),
              jsonb_build_object('package_id', rec.package_id, 'title', rec.title,
                                 'bronze_lock_override', v_bronze, 'run_id', v_run_id));
    END IF;

    v_enqueued := v_enqueued + 1;
    v_targets := v_targets || jsonb_build_object(
      'package_id', rec.package_id, 'title', rec.title,
      'status', rec.status, 'bronze_override', v_bronze,
      'action', CASE WHEN p_dry_run THEN 'dry_run_would_enqueue' ELSE 'enqueued' END);
  END LOOP;

  IF NOT p_dry_run THEN
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('exam_first_oral_coverage_heal_summary',
            'admin_heal_exam_first_oral_coverage',
            'system', 'exam_first_oral_coverage',
            CASE WHEN v_enqueued > 0 THEN 'enqueued' ELSE 'noop' END,
            format('Run %s: %s enqueued, %s bronze-override, %s skipped (pending), %s targets',
                   v_run_id, v_enqueued, v_bronze_overrides, v_skipped_pending, v_total_targets),
            jsonb_build_object('run_id', v_run_id,
                               'enqueued', v_enqueued,
                               'bronze_overrides', v_bronze_overrides,
                               'skipped_pending', v_skipped_pending,
                               'total_targets', v_total_targets));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'dry_run', p_dry_run,
    'total_targets', v_total_targets,
    'enqueued', v_enqueued,
    'bronze_overrides', v_bronze_overrides,
    'skipped_pending', v_skipped_pending,
    'targets', v_targets
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_exam_first_oral_coverage(boolean,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_exam_first_oral_coverage(boolean,int) TO service_role, postgres;

-- 3) Nightly Cron 03:35 UTC
DO $$
BEGIN
  PERFORM cron.unschedule('exam-first-oral-coverage-heal-nightly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='exam-first-oral-coverage-heal-nightly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'exam-first-oral-coverage-heal-nightly',
  '35 3 * * *',
  $cron$ SELECT public.admin_heal_exam_first_oral_coverage(false, 200); $cron$
);