-- Recovery für Paket 861ddde2 (Maurer/-in)
-- Root-Cause: course_packages.status='queued' → OPS_GUARD:NON_BUILDING_PACKAGE blockt council
-- Fix: Status auf building, council-Step queued (ist es schon), failed council-Job recyclen oder neu, auto_publish neu enqueuen

DO $$
DECLARE
  v_pkg_id uuid := '861ddde2-7427-43ab-869a-0c9f98a2ea11';
  v_existing_council_id uuid;
  v_new_council_id uuid;
  v_new_pub_id uuid;
BEGIN
  -- 1) Paket auf building heben (Voraussetzung für OPS-Guard)
  UPDATE public.course_packages
  SET status = 'building',
      updated_at = now()
  WHERE id = v_pkg_id
    AND status = 'queued';

  -- 2) Step quality_council ist bereits queued — sicherheitshalber explizit
  UPDATE public.package_steps
  SET status = 'queued',
      updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'recovery_at', now(),
        'recovery_reason', 'maurer_pkg_status_drift_fix_2026_05_01',
        'allow_regression', true
      )
  WHERE package_id = v_pkg_id
    AND step_key IN ('quality_council','auto_publish');

  -- 3) Aktiven council-Job suchen oder neuen anlegen (dedupe-aware)
  SELECT id INTO v_existing_council_id
  FROM public.job_queue
  WHERE (payload->>'package_id') = v_pkg_id::text
    AND job_type = 'package_quality_council'
    AND status IN ('pending','queued','processing')
  LIMIT 1;

  IF v_existing_council_id IS NULL THEN
    INSERT INTO public.job_queue (
      job_type, status, attempts, max_attempts, payload, run_after, priority
    ) VALUES (
      'package_quality_council',
      'pending',
      0, 25,
      jsonb_build_object(
        'package_id', v_pkg_id,
        'manual_recovery', true,
        'recovery_reason', 'maurer_pkg_2026_05_01'
      ),
      now(),
      5
    ) RETURNING id INTO v_new_council_id;
  END IF;

  -- 4) auto_publish wird durch DAG nach council-done automatisch enqueued —
  --    NICHT manuell anlegen, sonst guard_no_phantom_steps_on_published Risiko.

  -- 5) Audit
  INSERT INTO public.auto_heal_log (
    trigger_source, action_type, target_id, target_type,
    result_status, result_detail, metadata
  ) VALUES (
    'manual_migration',
    'maurer_pkg_full_recovery',
    v_pkg_id, 'package',
    'success',
    'pkg→building, council-step queued, council-job ' ||
      COALESCE('reused=' || v_existing_council_id::text, 'inserted=' || v_new_council_id::text),
    jsonb_build_object(
      'package_id', v_pkg_id,
      'reused_council_job', v_existing_council_id,
      'new_council_job', v_new_council_id,
      'reason', 'NON_BUILDING_PACKAGE_status_drift'
    )
  );
END $$;