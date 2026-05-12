-- 1. Auto-Retry: zusätzliche Terminal-Klassen
CREATE OR REPLACE FUNCTION public.fn_auto_retry_failed_jobs(_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row record;
  _retried int := 0;
  _skipped_terminal int := 0;
  _skipped_duplicate int := 0;
  _skipped_obsolete int := 0;
  _skipped_admin_terminal int := 0;
  _skipped_no_package int := 0;
  _skipped_pkg_status int := 0;
  _skipped_max_retry int := 0;
  _row_errors int := 0;
  _error_class text;
  _cooldown int;
  _max_retry int;
  _has_package boolean;
  _pkg_status_ok boolean;
  _no_duplicate boolean;
  _no_newer_success boolean;
  _not_admin_terminal boolean;
  _pkg_status text;
  _is_pkg_bound boolean;
  _last_at timestamptz;
  _decision text;
  _active_set text[] := public.fn_job_active_statuses();
  _allowed_pkg_status text[] := ARRAY['building','queued','blocked','pending','draft'];
  _terminal_classes text[] := ARRAY[
    'HARD_FAIL_NO_CURRICULUM','HARD_FAIL_NO_BLUEPRINTS',
    'HARD_FAIL_REPAIR_EXHAUSTED','HARD_FAIL_BREAKER','REQUEUE_LOOP_KILLED',
    'QUALITY_THRESHOLD_NOT_MET','INTEGRITY_FAIL','NO_QUESTIONS',
    'GOVERNANCE_SCORE_BELOW_THRESHOLD','BRONZE_REVIEW_REQUIRED','NON_BUILDING_PACKAGE'
  ];
BEGIN
  PERFORM set_config('app.transition_source', 'auto_retry_policy', true);

  FOR _row IN
    SELECT *
    FROM public.job_queue
    WHERE status = 'failed'
      AND (run_after IS NULL OR run_after <= now())
    ORDER BY COALESCE(run_after, updated_at, created_at) ASC
    LIMIT _limit
  LOOP
    BEGIN
      -- Prefer explicit last_error_code, otherwise classify last_error/error
      _error_class := COALESCE(
        NULLIF(_row.last_error_code,''),
        public.fn_classify_job_error(COALESCE(_row.last_error, _row.error))
      );

      -- Admin-Terminal Marker
      _not_admin_terminal := COALESCE(_row.meta->>'admin_terminal','false') <> 'true';
      IF NOT _not_admin_terminal THEN
        _skipped_admin_terminal := _skipped_admin_terminal + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_admin_terminal', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('not_admin_terminal', false), 'admin marked terminal');
        CONTINUE;
      END IF;

      -- Terminal classes (extended): hard skip
      IF _error_class = ANY(_terminal_classes) THEN
        _skipped_terminal := _skipped_terminal + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_terminal', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('terminal_class', true), _error_class);
        CONTINUE;
      END IF;

      CASE _error_class
        WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN _cooldown := 300; _max_retry := 8;
        WHEN 'TIMEOUT'                   THEN _cooldown := 90;  _max_retry := 6;
        WHEN 'OPS_GUARD_NON_BUILDING'    THEN _cooldown := 180; _max_retry := 5;
        WHEN 'NETWORK_ERROR'             THEN _cooldown := 60;  _max_retry := 8;
        ELSE _cooldown := 120; _max_retry := 5;
      END CASE;

      IF COALESCE(_row.attempts,0) >= _max_retry THEN
        _skipped_max_retry := _skipped_max_retry + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_max_retry', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('attempts_le_max', false), format('attempts %s >= cap %s', _row.attempts, _max_retry));
        CONTINUE;
      END IF;

      _is_pkg_bound := _row.job_type LIKE 'package_%';
      _has_package := (_row.package_id IS NOT NULL);
      IF _is_pkg_bound AND NOT _has_package THEN
        _skipped_no_package := _skipped_no_package + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_no_package', _error_class, NULL, _row.attempts,
                jsonb_build_object('has_package', false), 'package-bound job missing package_id');
        CONTINUE;
      END IF;

      _pkg_status := NULL;
      _pkg_status_ok := true;
      IF _has_package THEN
        SELECT status INTO _pkg_status FROM public.course_packages WHERE id = _row.package_id;
        _pkg_status_ok := _pkg_status = ANY(_allowed_pkg_status);
        IF NOT _pkg_status_ok THEN
          _skipped_pkg_status := _skipped_pkg_status + 1;
          INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
          VALUES (_row.id, 'skip_pkg_status', _error_class, _row.package_id, _row.attempts,
                  jsonb_build_object('pkg_status_ok', false, 'pkg_status', _pkg_status),
                  format('pkg status %s not in allowed', _pkg_status));
          CONTINUE;
        END IF;
      END IF;

      -- Duplicate guard
      _no_duplicate := NOT EXISTS (
        SELECT 1 FROM public.job_queue d
        WHERE d.id <> _row.id
          AND d.job_type = _row.job_type
          AND COALESCE(d.package_id::text,'∅') = COALESCE(_row.package_id::text,'∅')
          AND d.status = ANY(_active_set)
      );
      IF NOT _no_duplicate THEN
        _skipped_duplicate := _skipped_duplicate + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_duplicate', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('no_duplicate', false), 'active duplicate exists');
        CONTINUE;
      END IF;

      -- Newer-success guard
      _no_newer_success := NOT EXISTS (
        SELECT 1 FROM public.job_queue n
        WHERE n.job_type = _row.job_type
          AND COALESCE(n.package_id::text,'∅') = COALESCE(_row.package_id::text,'∅')
          AND n.status = 'completed'
          AND COALESCE(n.completed_at, n.updated_at) > _row.updated_at
      );
      IF NOT _no_newer_success THEN
        _skipped_obsolete := _skipped_obsolete + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_obsolete', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('no_newer_success', false), 'newer completed exists');
        CONTINUE;
      END IF;

      -- Cooldown check
      _last_at := COALESCE(_row.run_after, _row.updated_at, _row.created_at);
      IF _last_at + make_interval(secs => _cooldown) > now() THEN
        UPDATE public.job_queue
           SET run_after = _last_at + make_interval(secs => _cooldown)
         WHERE id = _row.id AND run_after IS DISTINCT FROM _last_at + make_interval(secs => _cooldown);
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'cooldown', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('cooldown_s', _cooldown), 'within cooldown');
        CONTINUE;
      END IF;

      -- Retry
      UPDATE public.job_queue
         SET status = 'queued',
             attempts = COALESCE(attempts,0) + 1,
             updated_at = now(),
             run_after = now()
       WHERE id = _row.id;
      _retried := _retried + 1;
      INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
      VALUES (_row.id, 'retry', _error_class, _row.package_id, _row.attempts + 1,
              jsonb_build_object('all_guards_passed', true), 'requeued by auto_retry_policy');

    EXCEPTION WHEN OTHERS THEN
      _row_errors := _row_errors + 1;
      INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
      VALUES (_row.id, 'skip_row_error', _error_class, _row.package_id, _row.attempts,
              jsonb_build_object('exception', SQLERRM), 'isolated row exception');
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'retried', _retried,
    'skipped_terminal', _skipped_terminal,
    'skipped_admin_terminal', _skipped_admin_terminal,
    'skipped_duplicate', _skipped_duplicate,
    'skipped_obsolete', _skipped_obsolete,
    'skipped_no_package', _skipped_no_package,
    'skipped_pkg_status', _skipped_pkg_status,
    'skipped_max_retry', _skipped_max_retry,
    'row_errors', _row_errors
  );
END;
$function$;

-- 2. Backsync trigger: error_class aus transitions zurück auf job_queue.last_error_code
CREATE OR REPLACE FUNCTION public.fn_backsync_error_class_to_job_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.new_status = 'failed' AND COALESCE(NEW.error_class,'') <> '' THEN
    UPDATE public.job_queue jq
       SET last_error_code = COALESCE(NULLIF(jq.last_error_code,''), NEW.error_class),
           last_error = COALESCE(NULLIF(jq.last_error,''), NEW.last_error::text, NEW.error_class),
           updated_at = now()
     WHERE jq.id = NEW.job_id
       AND (jq.last_error_code IS NULL OR jq.last_error_code = '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_backsync_error_class_to_job_queue ON public.job_status_transitions;
CREATE TRIGGER trg_backsync_error_class_to_job_queue
AFTER INSERT ON public.job_status_transitions
FOR EACH ROW
EXECUTE FUNCTION public.fn_backsync_error_class_to_job_queue();

-- 3. One-shot Heal-RPC: backfill + terminalize + bronze auto_publish cancel
CREATE OR REPLACE FUNCTION public.admin_terminalize_quality_failures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_run_id uuid := gen_random_uuid();
  v_backfilled int := 0;
  v_terminalized int := 0;
  v_bronze_cancelled int := 0;
  v_pending_before int := 0;
  v_pending_after int := 0;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;

  SELECT COUNT(*) INTO v_pending_before
  FROM public.job_queue
  WHERE status IN ('pending','queued')
    AND derive_job_lane(job_type) = 'control';

  -- Step 1: Backfill last_error_code from transitions (last 24h)
  WITH src AS (
    SELECT DISTINCT ON (jst.job_id)
      jst.job_id, jst.error_class, jst.last_error
    FROM public.job_status_transitions jst
    WHERE jst.new_status = 'failed'
      AND jst.error_class IS NOT NULL
      AND jst.created_at > now() - interval '24 hours'
    ORDER BY jst.job_id, jst.created_at DESC
  ),
  upd AS (
    UPDATE public.job_queue jq
       SET last_error_code = src.error_class,
           last_error = COALESCE(NULLIF(jq.last_error,''), src.last_error::text, src.error_class),
           updated_at = now()
     FROM src
     WHERE jq.id = src.job_id
       AND jq.status = 'failed'
       AND (jq.last_error_code IS NULL OR jq.last_error_code = '')
     RETURNING jq.id
  )
  SELECT COUNT(*) INTO v_backfilled FROM upd;

  -- Step 2: Terminalize QUALITY_THRESHOLD_NOT_MET failures
  WITH upd AS (
    UPDATE public.job_queue
       SET max_attempts = GREATEST(attempts, COALESCE(max_attempts,3)),
           meta = COALESCE(meta,'{}'::jsonb)
                  || jsonb_build_object(
                       'admin_terminal', true,
                       'terminal_reason', last_error_code,
                       'auto_retry_disabled_at', now(),
                       'terminalized_run_id', v_run_id
                     ),
           updated_at = now()
     WHERE status = 'failed'
       AND last_error_code IN ('QUALITY_THRESHOLD_NOT_MET','INTEGRITY_FAIL','GOVERNANCE_SCORE_BELOW_THRESHOLD','BRONZE_REVIEW_REQUIRED')
       AND COALESCE(meta->>'admin_terminal','false') <> 'true'
       AND updated_at > now() - interval '24 hours'
     RETURNING id
  )
  SELECT COUNT(*) INTO v_terminalized FROM upd;

  -- Step 3: Cancel bronze-locked pending/queued package_auto_publish
  WITH upd AS (
    UPDATE public.job_queue jq
       SET status = 'cancelled',
           last_error_code = 'BRONZE_LOCK_TERMINAL',
           last_error = 'Cancelled by admin_terminalize_quality_failures: bronze-locked package',
           updated_at = now()
     FROM public.course_packages cp
     WHERE jq.package_id = cp.id
       AND jq.status IN ('pending','queued')
       AND jq.job_type = 'package_auto_publish'
       AND COALESCE(cp.feature_flags->'bronze'->>'locked','false') = 'true'
     RETURNING jq.id
  )
  SELECT COUNT(*) INTO v_bronze_cancelled FROM upd;

  SELECT COUNT(*) INTO v_pending_after
  FROM public.job_queue
  WHERE status IN ('pending','queued')
    AND derive_job_lane(job_type) = 'control';

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'admin_terminalize_quality_failures',
    'system',
    CASE WHEN v_terminalized + v_backfilled + v_bronze_cancelled > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'run_id', v_run_id,
      'caller_id', v_caller,
      'backfilled_error_codes', v_backfilled,
      'terminalized_jobs', v_terminalized,
      'bronze_auto_publish_cancelled', v_bronze_cancelled,
      'control_pending_before', v_pending_before,
      'control_pending_after', v_pending_after,
      'control_pending_delta', v_pending_after - v_pending_before
    )
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'backfilled_error_codes', v_backfilled,
    'terminalized_jobs', v_terminalized,
    'bronze_auto_publish_cancelled', v_bronze_cancelled,
    'control_pending_before', v_pending_before,
    'control_pending_after', v_pending_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_terminalize_quality_failures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_terminalize_quality_failures() TO authenticated, service_role;