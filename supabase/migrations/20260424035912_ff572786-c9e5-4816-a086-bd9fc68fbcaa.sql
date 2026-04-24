-- Migration v1.2: 3 harte Checks vor Merge
--
-- 1) admin_mark_requeue_loop_terminal: Step-Mapping nur für package_run_integrity_check.
--    Andere Jobtypen werden abgelehnt (kein Pseudo-Mapping per REPLACE).
-- 2) admin_safe_requeue_integrity_check: 'pending' in active-jobs Check aufnehmen.
-- 3) admin_safe_requeue_integrity_check: Admin-Role-Check (auth.uid() + has_role) wieder rein.
--
-- Plus: Backend-Validation-RPC für Targeted Heal (re-check eligibility per job_id),
--       liefert strukturierte per-job Ergebnisse.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) admin_mark_requeue_loop_terminal — auf integrity-check begrenzen
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_requeue_loop_terminal(
  _job_id uuid,
  _reason text DEFAULT 'requeue_loop_manual_review'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job          public.job_queue%ROWTYPE;
  _step_key     text;
  _step_updated integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_admin_only');
  END IF;

  SELECT * INTO _job FROM public.job_queue WHERE id = _job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;

  -- Strikt: nur integrity-check unterstützt aktuelles deterministisches Step-Mapping.
  IF _job.job_type <> 'package_run_integrity_check' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unsupported_job_type',
      'detail', 'admin_mark_requeue_loop_terminal currently only supports package_run_integrity_check'
    );
  END IF;

  _step_key := 'run_integrity_check';

  UPDATE public.job_queue
     SET status = 'cancelled',
         locked_by = NULL,
         locked_at = NULL,
         completed_at = now(),
         last_error = COALESCE(last_error, '') ||
           E'\n[REQUEUE_LOOP_KILLED ' || now()::text || '] reason=' || _reason,
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
           'requeue_loop_terminal', true,
           'requeue_loop_reason',   _reason,
           'manual_review_required', true
         )
   WHERE id = _job_id;

  IF _job.package_id IS NOT NULL THEN
    UPDATE public.package_steps
       SET status = 'manual_review_required',
           updated_at = now(),
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
             'manual_review_reason', _reason,
             'last_terminal_job_id', _job_id
           )
     WHERE package_id = _job.package_id
       AND step_key   = _step_key;
    GET DIAGNOSTICS _step_updated = ROW_COUNT;
  END IF;

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids, reason)
  VALUES (
    'mark_requeue_loop_terminal',
    jsonb_build_object('job_id', _job_id, 'job_type', _job.job_type, 'step_key', _step_key, 'step_updated', _step_updated),
    'job_queue',
    ARRAY[_job_id::text],
    _reason
  );

  RETURN jsonb_build_object('ok', true, 'job_id', _job_id, 'step_updated', _step_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_requeue_loop_terminal(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_requeue_loop_terminal(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) + 3) admin_safe_requeue_integrity_check — pending einschließen + Admin-Check
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_safe_requeue_integrity_check(
  _package_id uuid,
  _reason text DEFAULT 'manual_admin_requeue'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _step             public.package_steps%ROWTYPE;
  _ric_step_order   integer;
  _active_count     integer := 0;
  _upstream_pending integer := 0;
  _new_job_id       uuid;
BEGIN
  -- Admin-Role-Check (RPC ist SECDEF + EXECUTE für authenticated → unbedingt nötig)
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_admin_only');
  END IF;

  SELECT * INTO _step
    FROM public.package_steps
   WHERE package_id = _package_id
     AND step_key   = 'run_integrity_check';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_missing');
  END IF;

  IF _step.status NOT IN ('queued', 'failed', 'manual_review_required') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_not_eligible', 'current_status', _step.status);
  END IF;

  _ric_step_order := COALESCE(_step.step_order, 0);

  -- Aktive Jobs blockieren neuen Requeue (pending hinzugenommen)
  SELECT count(*) INTO _active_count
    FROM public.job_queue
   WHERE package_id = _package_id
     AND job_type   = 'package_run_integrity_check'
     AND status IN ('pending', 'queued', 'processing', 'running');

  IF _active_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_job_exists', 'active', _active_count);
  END IF;

  -- Nur echte Vorgänger-Steps prüfen (lower step_order, exkl. RIC selbst)
  SELECT count(*) INTO _upstream_pending
    FROM public.package_steps
   WHERE package_id = _package_id
     AND step_key   <> 'run_integrity_check'
     AND step_order < _ric_step_order
     AND status NOT IN ('done', 'skipped');

  IF _upstream_pending > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'upstream_steps_pending', 'pending', _upstream_pending);
  END IF;

  -- Step zurücksetzen
  UPDATE public.package_steps
     SET status = 'queued', updated_at = now(),
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('safe_requeue_reason', _reason)
   WHERE id = _step.id;

  -- Neuen Job einplanen
  _new_job_id := gen_random_uuid();
  INSERT INTO public.job_queue (id, job_type, package_id, status, payload, attempts, created_at, updated_at, meta)
  VALUES (
    _new_job_id,
    'package_run_integrity_check',
    _package_id,
    'queued',
    jsonb_build_object('package_id', _package_id),
    0,
    now(), now(),
    jsonb_build_object('safe_requeue', true, 'safe_requeue_reason', _reason)
  );

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids, reason)
  VALUES (
    'safe_requeue_integrity_check',
    jsonb_build_object('package_id', _package_id, 'new_job_id', _new_job_id),
    'job_queue',
    ARRAY[_new_job_id::text],
    _reason
  );

  RETURN jsonb_build_object('ok', true, 'job_id', _new_job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_safe_requeue_integrity_check(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_safe_requeue_integrity_check(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Backend-Validation für Targeted Heal: pro job_id Eligibility re-checken
--    und strukturierten per-job Failure-Code zurückgeben.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_heal_jobs_targeted(
  _job_ids uuid[],
  _reason text DEFAULT 'targeted_heal_batch'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _jid          uuid;
  _job          public.job_queue%ROWTYPE;
  _result       jsonb;
  _results      jsonb := '[]'::jsonb;
  _ok_count     integer := 0;
  _fail_count   integer := 0;
  _heal_res     jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_admin_only');
  END IF;

  IF _job_ids IS NULL OR array_length(_job_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_job_ids');
  END IF;

  FOREACH _jid IN ARRAY _job_ids LOOP
    SELECT * INTO _job FROM public.job_queue WHERE id = _jid;
    IF NOT FOUND THEN
      _result := jsonb_build_object(
        'job_id', _jid, 'ok', false,
        'failure_code', 'job_not_found'
      );
      _fail_count := _fail_count + 1;
    ELSIF _job.status NOT IN ('processing', 'running') THEN
      _result := jsonb_build_object(
        'job_id', _jid, 'ok', false,
        'failure_code', 'not_eligible_status',
        'current_status', _job.status
      );
      _fail_count := _fail_count + 1;
    ELSIF _job.locked_at IS NULL OR _job.locked_at > now() - interval '15 min' THEN
      _result := jsonb_build_object(
        'job_id', _jid, 'ok', false,
        'failure_code', 'lock_too_fresh',
        'locked_at', _job.locked_at
      );
      _fail_count := _fail_count + 1;
    ELSE
      -- delegieren an die bestehende geguardete RPC
      SELECT public.admin_heal_zombie_locked_job(_jid, _reason) INTO _heal_res;
      IF (_heal_res->>'ok')::boolean THEN
        _ok_count := _ok_count + 1;
        _result := jsonb_build_object(
          'job_id', _jid, 'ok', true,
          'step_reset', _heal_res->'step_reset',
          'step_reset_count', _heal_res->'step_reset_count'
        );
      ELSE
        _fail_count := _fail_count + 1;
        _result := jsonb_build_object(
          'job_id', _jid, 'ok', false,
          'failure_code', COALESCE(_heal_res->>'error', 'heal_rpc_failed'),
          'detail', _heal_res
        );
      END IF;
    END IF;

    _results := _results || _result;
  END LOOP;

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids, reason)
  VALUES (
    'heal_jobs_targeted',
    jsonb_build_object('total', array_length(_job_ids, 1), 'ok', _ok_count, 'fail', _fail_count, 'results', _results),
    'job_queue',
    (SELECT array_agg(j::text) FROM unnest(_job_ids) j),
    _reason
  );

  RETURN jsonb_build_object(
    'ok', _fail_count = 0,
    'total', array_length(_job_ids, 1),
    'ok_count', _ok_count,
    'fail_count', _fail_count,
    'results', _results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_jobs_targeted(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_heal_jobs_targeted(uuid[], text) TO authenticated;