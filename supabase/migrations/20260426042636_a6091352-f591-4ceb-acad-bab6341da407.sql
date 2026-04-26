
-- 1) Härten: guard_published_package_immutable schreibt jetzt einen Audit-Eintrag bei JEDEM Verstoß
CREATE OR REPLACE FUNCTION public.guard_published_package_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller text := COALESCE(current_setting('app.actor', true), session_user);
  v_via_rpc boolean := COALESCE(current_setting('app.via_force_depublish_rpc', true) = 'true', false);
BEGIN
  -- Allow status change TO 'archived' (retirement of old packages)
  IF NEW.status = 'archived' AND OLD.status IN ('published', 'quality_gate_failed', 'done', 'council_review') THEN
    RETURN NEW;
  END IF;

  -- Allow status change TO 'quality_gate_failed' (governance-driven downgrade)
  IF NEW.status = 'quality_gate_failed' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- Cosmetic metadata maintenance on published packages
  IF OLD.published_at IS NOT NULL AND OLD.status = 'published' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('archived', 'quality_gate_failed') THEN

      -- Audit-Eintrag VOR Blockade
      BEGIN
        INSERT INTO admin_actions (action, scope, payload, affected_ids, user_id)
        VALUES (
          'guard_block_published_to_other_status',
          'pipeline.publish.immutable_violation',
          jsonb_build_object(
            'package_id', OLD.id,
            'package_title', OLD.title,
            'old_status', OLD.status,
            'attempted_status', NEW.status,
            'caller', v_caller,
            'via_force_depublish_rpc', v_via_rpc,
            'hint', 'Use public.admin_force_depublish_and_rebuild(package_id) for legitimate rebuilds.'
          ),
          ARRAY[OLD.id],
          NULLIF(current_setting('app.actor_uuid', true), '')::uuid
        );
      EXCEPTION WHEN OTHERS THEN
        -- Audit darf den Guard nicht aushebeln
        NULL;
      END;

      RAISE EXCEPTION 'IMMUTABLE_PACKAGE: Cannot change status of published package % from % to %. Use admin_force_depublish_and_rebuild(uuid).',
        OLD.id, OLD.status, NEW.status
        USING HINT = 'Only archived/quality_gate_failed allowed; rebuilds must go through SSOT RPC.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) admin_force_depublish_and_rebuild bekommt Audit-Pflicht und Session-Marker
CREATE OR REPLACE FUNCTION public.admin_force_depublish_and_rebuild(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old record;
  v_actor uuid := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
BEGIN
  -- Snapshot vor der Operation
  SELECT id, title, status, published_at, integrity_passed, council_approved
  INTO v_old
  FROM course_packages
  WHERE id = p_package_id;

  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id;
  END IF;

  -- Session-Marker setzen, damit guard_published_package_immutable den RPC-Pfad erkennt
  PERFORM set_config('app.via_force_depublish_rpc', 'true', true);

  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_build_progress_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_passed_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_blocked_requires_reason;
  ALTER TABLE course_packages DISABLE TRIGGER trg_enforce_wip_cap;
  ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_done_regression;
  ALTER TABLE package_steps DISABLE TRIGGER trg_clear_stale_package_flags;

  BEGIN
    UPDATE course_packages
    SET status = 'building',
        is_published = false,
        published_at = NULL,
        integrity_passed = false,
        council_approved = false,
        council_approved_at = NULL,
        is_rebuild = true,
        stuck_reason = NULL,
        blocked_reason = NULL,
        updated_at = now()
    WHERE id = p_package_id;

    UPDATE package_steps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        attempts = 0,
        meta = jsonb_set(
          COALESCE(meta, '{}'::jsonb),
          '{reset_reason}',
          '"admin_force_depublish_rebuild"'
        )
    WHERE package_id = p_package_id
      AND status = 'done'
      AND step_key IN (
        'build_ai_tutor_index', 'validate_tutor_index',
        'generate_oral_exam', 'validate_oral_exam',
        'run_integrity_check', 'quality_council', 'auto_publish'
      );

  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_build_progress_drift;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved_drift;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_blocked_requires_reason;
    ALTER TABLE course_packages ENABLE TRIGGER trg_enforce_wip_cap;
    ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_done_regression;
    ALTER TABLE package_steps ENABLE TRIGGER trg_clear_stale_package_flags;
    PERFORM set_config('app.via_force_depublish_rpc', 'false', true);
    RAISE;
  END;

  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_build_progress_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_blocked_requires_reason;
  ALTER TABLE course_packages ENABLE TRIGGER trg_enforce_wip_cap;
  ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_done_regression;
  ALTER TABLE package_steps ENABLE TRIGGER trg_clear_stale_package_flags;

  -- Pflicht-Audit (auch bei Erfolg) – revisionssicher
  INSERT INTO admin_actions (action, scope, payload, affected_ids, user_id)
  VALUES (
    'admin_force_depublish_and_rebuild',
    'pipeline.publish.force_rebuild_ssot',
    jsonb_build_object(
      'package_id', p_package_id,
      'package_title', v_old.title,
      'before', jsonb_build_object(
        'status', v_old.status,
        'published_at', v_old.published_at,
        'integrity_passed', v_old.integrity_passed,
        'council_approved', v_old.council_approved
      ),
      'after', jsonb_build_object('status', 'building'),
      'caller', COALESCE(current_setting('app.actor', true), session_user)
    ),
    ARRAY[p_package_id],
    v_actor
  );

  PERFORM set_config('app.via_force_depublish_rpc', 'false', true);
END;
$function$;
