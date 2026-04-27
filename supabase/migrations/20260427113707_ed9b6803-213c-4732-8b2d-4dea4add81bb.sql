-- ============================================================================
-- Targeted Heal v1: Promote-Hotloop + Hollow-Published nachhaltig beheben
-- ============================================================================

-- 1) Bulk-Depublish & Rebuild für Hollow-Published Pakete
CREATE OR REPLACE FUNCTION public.admin_bulk_depublish_hollow(
  p_dry_run boolean DEFAULT true,
  p_max_packages integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_targets uuid[];
  v_pkg uuid;
  v_done int := 0;
  v_failed int := 0;
  v_results jsonb := '[]'::jsonb;
  v_err text;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- Targets: published Pakete mit 0 approved variants, sortiert nach Größe (kleinste zuerst → schneller heilen)
  SELECT array_agg(cp.id ORDER BY (
    SELECT COUNT(*) FROM exam_question_variants v 
    WHERE v.curriculum_id = cp.curriculum_id AND v.status='approved'
  ) ASC, cp.title ASC)
  INTO v_targets
  FROM course_packages cp
  WHERE cp.status = 'published'
    AND (
      cp.integrity_report::text ILIKE '%hollow%'
      OR cp.id IN (SELECT package_id FROM package_steps WHERE blocked_reason ILIKE '%HOLLOW%')
    )
    AND (
      SELECT COUNT(*) FROM exam_question_variants v 
      WHERE v.curriculum_id = cp.curriculum_id AND v.status='approved'
    ) = 0
  LIMIT p_max_packages;

  IF v_targets IS NULL OR array_length(v_targets,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'targets', 0, 'message', 'no hollow-published packages with 0 approved variants');
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'targets', array_length(v_targets,1),
      'package_ids', v_targets
    );
  END IF;

  -- Execute mit per-row exception isolation
  FOREACH v_pkg IN ARRAY v_targets LOOP
    BEGIN
      PERFORM set_config('app.transition_source', 'admin_bulk_depublish_hollow', true);
      PERFORM public.admin_force_depublish_and_rebuild(v_pkg);
      v_done := v_done + 1;
      v_results := v_results || jsonb_build_object('package_id', v_pkg, 'ok', true);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('package_id', v_pkg, 'ok', false, 'error', v_err);
    END;
  END LOOP;

  -- Audit
  INSERT INTO admin_actions(performed_by, action, reason, payload, affected_ids)
  VALUES (
    v_uid,
    'bulk_depublish_hollow',
    'Hollow-Published Pakete: bulk depublish + rebuild',
    jsonb_build_object('dry_run', false, 'done', v_done, 'failed', v_failed),
    v_targets
  );

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'targets', array_length(v_targets,1),
    'done', v_done,
    'failed', v_failed,
    'results', v_results
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bulk_depublish_hollow(boolean, integer) TO authenticated;


-- 2) Promote-Hotloop nachhaltig: Quarantäne + Variant-Reseed pro Paket
-- Setzt zugehörige Promote-Jobs auf cancelled (mit hotloop_quarantine_v2 marker)
-- und enqueued einen frischen blueprint_variants Re-Generation Job
CREATE OR REPLACE FUNCTION public.admin_resolve_promote_hotloop(
  p_dry_run boolean DEFAULT true,
  p_attempt_threshold integer DEFAULT 8,
  p_max_packages integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pkgs uuid[];
  v_pkg uuid;
  v_jobs_cancelled int := 0;
  v_reseeds_enqueued int := 0;
  v_per_pkg jsonb := '[]'::jsonb;
  v_pkg_data jsonb;
  v_variants_total int;
  v_jobs_in_pkg int;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- Pakete mit Hotloop in promote_blueprint_variants
  SELECT array_agg(DISTINCT package_id)
  INTO v_pkgs
  FROM job_queue
  WHERE job_type = 'package_promote_blueprint_variants'
    AND status IN ('pending','processing','failed')
    AND attempts >= p_attempt_threshold
    AND package_id IS NOT NULL
    AND updated_at > now() - interval '7 days'
  LIMIT p_max_packages;

  IF v_pkgs IS NULL OR array_length(v_pkgs,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'packages', 0, 'message', 'no promote-hotloop packages');
  END IF;

  -- Build per-package report
  FOREACH v_pkg IN ARRAY v_pkgs LOOP
    SELECT COUNT(*) INTO v_variants_total
    FROM exam_question_variants v
    JOIN course_packages cp ON cp.curriculum_id = v.curriculum_id
    WHERE cp.id = v_pkg;

    SELECT COUNT(*) INTO v_jobs_in_pkg
    FROM job_queue
    WHERE package_id = v_pkg
      AND job_type = 'package_promote_blueprint_variants'
      AND status IN ('pending','processing','failed');

    v_per_pkg := v_per_pkg || jsonb_build_object(
      'package_id', v_pkg,
      'variants_total', v_variants_total,
      'open_promote_jobs', v_jobs_in_pkg
    );
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'packages', array_length(v_pkgs,1),
      'per_package', v_per_pkg
    );
  END IF;

  -- Execute
  PERFORM set_config('app.transition_source', 'admin_resolve_promote_hotloop', true);

  -- 2a) Alle offenen Promote-Jobs der Hotloop-Pakete cancellen
  WITH cancelled AS (
    UPDATE job_queue
    SET status = 'cancelled',
        last_error = 'HOTLOOP_QUARANTINE_V2: cancelled by admin_resolve_promote_hotloop, awaiting reseed',
        updated_at = now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'hotloop_quarantine_v2', true,
          'quarantined_at', now(),
          'quarantined_by', v_uid
        )
    WHERE package_id = ANY(v_pkgs)
      AND job_type = 'package_promote_blueprint_variants'
      AND status IN ('pending','processing','failed')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_jobs_cancelled FROM cancelled;

  -- 2b) Reset zugehörige package_steps auf 'pending' damit Pipeline neu durchlaufen kann
  UPDATE package_steps
  SET status = 'pending',
      last_error = NULL,
      updated_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'hotloop_reseed_requested', true,
        'reseed_at', now()
      )
  WHERE package_id = ANY(v_pkgs)
    AND step_key IN ('promote_blueprint_variants', 'generate_blueprint_variants')
    AND status IN ('queued','processing','failed','blocked');

  -- 2c) Frische generate_blueprint_variants Jobs enqueuen (priorisiert)
  FOREACH v_pkg IN ARRAY v_pkgs LOOP
    BEGIN
      INSERT INTO job_queue(job_type, package_id, status, priority, payload, created_at, updated_at)
      VALUES (
        'package_generate_blueprint_variants',
        v_pkg,
        'pending',
        10,
        jsonb_build_object('source', 'hotloop_reseed_v2', 'package_id', v_pkg),
        now(), now()
      );
      v_reseeds_enqueued := v_reseeds_enqueued + 1;
    EXCEPTION WHEN OTHERS THEN
      -- ignore duplicates / guards
      NULL;
    END;
  END LOOP;

  -- Audit
  INSERT INTO admin_actions(performed_by, action, reason, payload, affected_ids)
  VALUES (
    v_uid,
    'resolve_promote_hotloop',
    'Promote-Hotloop: cancelled hot jobs, reset steps, enqueued fresh variants',
    jsonb_build_object(
      'jobs_cancelled', v_jobs_cancelled,
      'reseeds_enqueued', v_reseeds_enqueued,
      'attempt_threshold', p_attempt_threshold
    ),
    v_pkgs
  );

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'packages', array_length(v_pkgs,1),
    'jobs_cancelled', v_jobs_cancelled,
    'reseeds_enqueued', v_reseeds_enqueued,
    'per_package', v_per_pkg
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_resolve_promote_hotloop(boolean, integer, integer) TO authenticated;


-- 3) Diagnose-View für UI: aggregiert Hotloop + Hollow + Stale-Reaped
CREATE OR REPLACE VIEW public.v_admin_targeted_heal_diagnosis AS
WITH promote_hot AS (
  SELECT 
    'PROMOTE_HOTLOOP'::text as kind,
    COUNT(DISTINCT package_id)::int as packages,
    COUNT(*)::int as jobs,
    MAX(attempts)::int as max_attempts
  FROM job_queue
  WHERE job_type = 'package_promote_blueprint_variants'
    AND status IN ('pending','processing','failed')
    AND attempts >= 8
    AND updated_at > now() - interval '7 days'
),
hollow AS (
  SELECT 
    'HOLLOW_PUBLISHED'::text as kind,
    COUNT(*)::int as packages,
    0::int as jobs,
    0::int as max_attempts
  FROM course_packages cp
  WHERE cp.status = 'published'
    AND (
      cp.integrity_report::text ILIKE '%hollow%'
      OR cp.id IN (SELECT package_id FROM package_steps WHERE blocked_reason ILIKE '%HOLLOW%')
    )
    AND (
      SELECT COUNT(*) FROM exam_question_variants v 
      WHERE v.curriculum_id = cp.curriculum_id AND v.status='approved'
    ) = 0
),
stale_reaped AS (
  SELECT 
    'STALE_REAPED_RESIDUE'::text as kind,
    COUNT(DISTINCT package_id)::int as packages,
    COUNT(*)::int as jobs,
    MAX(attempts)::int as max_attempts
  FROM job_queue
  WHERE status = 'failed'
    AND last_error_code IN ('STALE_PROCESSING_REAPED', 'STALE_PROCESSING_EXHAUSTED')
    AND updated_at > now() - interval '24 hours'
)
SELECT * FROM promote_hot
UNION ALL SELECT * FROM hollow
UNION ALL SELECT * FROM stale_reaped;

GRANT SELECT ON public.v_admin_targeted_heal_diagnosis TO authenticated;