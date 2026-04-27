CREATE OR REPLACE FUNCTION public.admin_resolve_promote_hotloop(
  p_dry_run boolean DEFAULT true,
  p_attempt_threshold integer DEFAULT 8,
  p_max_packages integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_targets uuid[];
  v_pkg uuid;
  v_per_pkg jsonb := '[]'::jsonb;
  v_total_jobs int := 0;
  v_total_pkgs int := 0;
BEGIN
  IF NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT array_agg(DISTINCT package_id)
  INTO v_targets
  FROM (
    SELECT package_id
    FROM job_queue
    WHERE job_type = 'package_promote_blueprint_variants'
      AND status IN ('pending','processing','failed')
      AND attempts >= p_attempt_threshold
      AND updated_at > now() - interval '7 days'
      AND package_id IS NOT NULL
    GROUP BY package_id
    LIMIT p_max_packages
  ) s;

  IF v_targets IS NULL OR array_length(v_targets,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'packages', 0, 'per_package', '[]'::jsonb);
  END IF;

  FOREACH v_pkg IN ARRAY v_targets LOOP
    DECLARE
      v_open_jobs int;
      v_variants int;
    BEGIN
      SELECT count(*) INTO v_open_jobs
      FROM job_queue
      WHERE job_type='package_promote_blueprint_variants'
        AND status IN ('pending','processing','failed','queued','running','enqueued','pending_enqueue','batch_pending')
        AND package_id = v_pkg;

      SELECT count(*) INTO v_variants
      FROM blueprint_variants bv
      JOIN question_blueprints qb ON qb.id = bv.blueprint_id
      WHERE qb.package_id = v_pkg;

      v_per_pkg := v_per_pkg || jsonb_build_object(
        'package_id', v_pkg,
        'open_promote_jobs', v_open_jobs,
        'variants_total', v_variants
      );
      v_total_jobs := v_total_jobs + v_open_jobs;
      v_total_pkgs := v_total_pkgs + 1;

      IF NOT p_dry_run THEN
        UPDATE job_queue
        SET status = 'cancelled',
            meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object(
              'hotloop_quarantine_v2', true,
              'quarantine_reason', 'PROMOTE_HOTLOOP_RESEED',
              'quarantined_at', now()
            )
        WHERE job_type='package_promote_blueprint_variants'
          AND status IN ('pending','processing','failed','queued','running','enqueued','pending_enqueue','batch_pending')
          AND package_id = v_pkg;

        UPDATE package_steps
        SET status = 'queued',
            attempts = 0,
            meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object(
              'hotloop_reseed_at', now()
            )
        WHERE package_id = v_pkg
          AND step_key IN ('package_promote_blueprint_variants','package_generate_blueprint_variants');

        -- Correct signature: (text, uuid, jsonb)
        PERFORM enqueue_job_if_absent(
          'package_generate_blueprint_variants'::text,
          v_pkg,
          jsonb_build_object('package_id', v_pkg)
        );
      END IF;
    END;
  END LOOP;

  IF NOT p_dry_run THEN
    INSERT INTO admin_actions(user_id, action, payload, scope, affected_ids)
    VALUES (
      v_caller,
      'admin_resolve_promote_hotloop',
      jsonb_build_object(
        'attempt_threshold', p_attempt_threshold,
        'packages_processed', v_total_pkgs,
        'jobs_quarantined', v_total_jobs
      ),
      'package',
      v_targets
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'packages', v_total_pkgs,
    'per_package', v_per_pkg
  );
END;
$$;