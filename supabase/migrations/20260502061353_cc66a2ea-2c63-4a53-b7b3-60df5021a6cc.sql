
-- =======================================================================
-- 1) Enrichment-Gate Watcher
-- =======================================================================
CREATE OR REPLACE FUNCTION public.fn_watch_enrichment_gates_and_kick_enrich(
  p_max_per_run integer DEFAULT 10,
  p_cooldown_minutes integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg RECORD;
  v_unenriched int;
  v_recent_kick timestamptz;
  v_results jsonb := '[]'::jsonb;
  v_action text;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.curriculum_id, cp.status, cp.blocked_reason
    FROM public.course_packages cp
    WHERE cp.archived = false
      AND cp.curriculum_id IS NOT NULL
      AND (cp.status = 'blocked' OR cp.status = 'queued')
      AND (
        coalesce(cp.blocked_reason,'') ILIKE 'ENRICHMENT_GATE%'
        OR coalesce(cp.blocked_reason,'') ILIKE '%competencies enriched%'
        OR coalesce(cp.blocked_reason,'') ILIKE '%competency_coverage%'
        OR coalesce(cp.blocked_reason,'') = 'content_gap'
      )
    ORDER BY cp.updated_at ASC
    LIMIT p_max_per_run
  LOOP
    BEGIN
      v_unenriched := public.count_unenriched_competencies_for_curriculum(v_pkg.curriculum_id);
    EXCEPTION WHEN OTHERS THEN
      v_unenriched := NULL;
    END;

    IF v_unenriched IS NULL OR v_unenriched <= 0 THEN
      v_action := 'gate_resolved_no_kick';
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.id, 'title', v_pkg.title,
        'unenriched', v_unenriched, 'action', v_action);

      INSERT INTO public.heal_audit_layers
        (package_id, trigger_source, action_type, result_status,
         symptom_before, symptom_after, gate_layer_before, gate_layer_after, notes)
      VALUES (v_pkg.id, 'enrichment_gate_watcher', 'gate_resolved', 'success',
              jsonb_build_object('blocked_reason', v_pkg.blocked_reason, 'status', v_pkg.status),
              jsonb_build_object('blocked_reason', v_pkg.blocked_reason, 'status', v_pkg.status),
              jsonb_build_object('unenriched', v_unenriched),
              jsonb_build_object('unenriched', v_unenriched, 'gate_open', true),
              'Enrichment gate cleared - no kick required');
      CONTINUE;
    END IF;

    -- Cooldown auf jüngsten enqueue-Versuch
    SELECT MAX(created_at) INTO v_recent_kick
    FROM public.job_queue
    WHERE (payload->>'package_id')::uuid = v_pkg.id
      AND job_type IN ('package_repair_exam_pool_competency_coverage','curriculum_enrich_competencies')
      AND created_at > now() - (p_cooldown_minutes || ' minutes')::interval;

    IF v_recent_kick IS NOT NULL THEN
      v_action := 'cooldown_active';
    ELSE
      -- delegieren an existierende Mass-Enrich-Pipeline
      BEGIN
        PERFORM public.fn_enqueue_competency_fill_for_gap_packages(1, p_cooldown_minutes);
        v_action := 'mass_enrich_kicked';
      EXCEPTION WHEN OTHERS THEN
        v_action := 'mass_enrich_failed:' || SQLERRM;
      END;
    END IF;

    INSERT INTO public.heal_audit_layers
      (package_id, trigger_source, action_type, result_status,
       symptom_before, gate_layer_before, gate_layer_after, notes)
    VALUES (v_pkg.id, 'enrichment_gate_watcher', v_action,
            CASE WHEN v_action LIKE 'mass_enrich_failed%' THEN 'failure'
                 WHEN v_action = 'cooldown_active' THEN 'skipped'
                 ELSE 'success' END,
            jsonb_build_object('blocked_reason', v_pkg.blocked_reason, 'status', v_pkg.status),
            jsonb_build_object('unenriched', v_unenriched),
            jsonb_build_object('unenriched', v_unenriched, 'kick_action', v_action),
            format('Enrichment gate watcher: %s unenriched competencies', v_unenriched));

    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg.id, 'title', v_pkg.title,
      'unenriched', v_unenriched, 'action', v_action);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', jsonb_array_length(v_results), 'results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_watch_enrichment_gates_and_kick_enrich(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_watch_enrichment_gates_and_kick_enrich(integer, integer) TO service_role;

-- Cron alle 10min
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='enrichment-gate-watcher-10min') THEN
    PERFORM cron.unschedule('enrichment-gate-watcher-10min');
  END IF;
  PERFORM cron.schedule('enrichment-gate-watcher-10min', '*/10 * * * *',
    $cron$ SELECT public.fn_watch_enrichment_gates_and_kick_enrich(10, 20); $cron$);
END$$;

-- =======================================================================
-- 2) Status-Reverter (Pattern X6) - Detection + Alerting
-- =======================================================================
CREATE OR REPLACE FUNCTION public.fn_detect_status_reverter()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_recent_building timestamptz;
  v_window interval := interval '15 minutes';
BEGIN
  -- building -> queued/blocked innerhalb kurzer Zeit
  IF OLD.status = 'building' AND NEW.status IN ('queued','blocked') THEN
    INSERT INTO public.heal_audit_layers
      (package_id, trigger_source, action_type, result_status,
       symptom_before, symptom_after, gate_layer_after, notes)
    VALUES (NEW.id,
            COALESCE(current_setting('app.transition_source', true), 'unknown_trigger'),
            'PATTERN_X6_STATUS_REVERTER', 'warning',
            jsonb_build_object('status', OLD.status, 'blocked_reason', OLD.blocked_reason),
            jsonb_build_object('status', NEW.status, 'blocked_reason', NEW.blocked_reason),
            jsonb_build_object(
              'reverted_at', now(),
              'transition_source', COALESCE(current_setting('app.transition_source', true), 'unknown_trigger'),
              'active_triggers', (
                SELECT jsonb_agg(t.tgname ORDER BY t.tgname)
                FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                WHERE c.relname='course_packages' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
              )
            ),
            format('Pattern X6: %s -> %s | reason=%s', OLD.status, NEW.status, COALESCE(NEW.blocked_reason,'?')));

    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
    VALUES ('PATTERN_X6_STATUS_REVERTER', 'package', NEW.id::text,
            COALESCE(current_setting('app.transition_source', true), 'unknown_trigger'),
            'warning',
            format('Reverter %s -> %s reason=%s', OLD.status, NEW.status, COALESCE(NEW.blocked_reason,'?')),
            jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status,
                               'blocked_reason', NEW.blocked_reason));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detect_status_reverter ON public.course_packages;
CREATE TRIGGER trg_detect_status_reverter
AFTER UPDATE OF status ON public.course_packages
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.fn_detect_status_reverter();

-- View: jüngste Reverter
CREATE OR REPLACE VIEW public.v_status_reverter_recent AS
SELECT hal.id, hal.created_at, hal.package_id, cp.title,
       hal.symptom_before, hal.symptom_after, hal.gate_layer_after, hal.notes,
       hal.trigger_source
FROM public.heal_audit_layers hal
LEFT JOIN public.course_packages cp ON cp.id = hal.package_id
WHERE hal.action_type = 'PATTERN_X6_STATUS_REVERTER'
  AND hal.created_at > now() - interval '7 days'
ORDER BY hal.created_at DESC;

REVOKE ALL ON public.v_status_reverter_recent FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_status_reverter_recent TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_status_reverter_recent(p_limit integer DEFAULT 50)
RETURNS SETOF public.v_status_reverter_recent
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_status_reverter_recent LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_status_reverter_recent(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_status_reverter_recent(integer) TO authenticated, service_role;

-- =======================================================================
-- 3) Funktions-Audit der Heal-/Enqueue-Producer
-- =======================================================================
CREATE OR REPLACE VIEW public.v_heal_function_audit AS
SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS args,
  CASE WHEN pg_get_functiondef(p.oid) ILIKE '%enqueue_source%' THEN true ELSE false END AS uses_enqueue_source_tag,
  CASE WHEN pg_get_functiondef(p.oid) ILIKE '%fn_cron_enqueue_drift_guard%' THEN true ELSE false END AS uses_drift_guard,
  CASE WHEN pg_get_functiondef(p.oid) ILIKE '%enqueue_job_if_absent%' THEN true ELSE false END AS calls_enqueue,
  CASE WHEN pg_get_functiondef(p.oid) ILIKE '%has_role%' THEN true ELSE false END AS has_role_gate,
  p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname ILIKE 'fn_%heal%' OR p.proname ILIKE 'admin_%heal%'
       OR p.proname ILIKE 'fn_%enqueue%' OR p.proname ILIKE 'fn_detect_%drift%'
       OR p.proname ILIKE 'fn_watch_%' OR p.proname ILIKE 'admin_%nudge%'
       OR p.proname ILIKE 'fn_auto_%' OR p.proname ILIKE 'admin_skip_%')
ORDER BY p.proname;

REVOKE ALL ON public.v_heal_function_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_heal_function_audit TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_heal_function_audit()
RETURNS SETOF public.v_heal_function_audit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_heal_function_audit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_heal_function_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_function_audit() TO authenticated, service_role;

-- =======================================================================
-- 4) Suggestion-Flow für queued + done_steps>0 + 0 active jobs
-- =======================================================================
CREATE OR REPLACE FUNCTION public.admin_suggest_heal_for_queued_stall(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg RECORD;
  v_active int;
  v_done int;
  v_open int;
  v_phantom int;
  v_unenriched int;
  v_suggestion text;
  v_safe boolean := true;
  v_reason text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  SELECT id, title, status, blocked_reason, curriculum_id, archived
  INTO v_pkg FROM public.course_packages WHERE id = p_package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;

  SELECT count(*) INTO v_active FROM public.job_queue
   WHERE package_id=p_package_id AND status IN ('processing','running','pending','queued','retry_scheduled','batch_pending');

  SELECT count(*) FILTER (WHERE status::text='done'),
         count(*) FILTER (WHERE status::text IN ('queued','pending_enqueue','failed','blocked','timeout'))
    INTO v_done, v_open
  FROM public.package_steps WHERE package_id = p_package_id;

  SELECT count(*) INTO v_phantom FROM public.package_steps
   WHERE package_id = p_package_id
     AND coalesce(last_error,'') ILIKE '%track-drift detected%'
     AND status::text NOT IN ('done','skipped');

  v_unenriched := NULL;
  IF v_pkg.curriculum_id IS NOT NULL THEN
    BEGIN v_unenriched := public.count_unenriched_competencies_for_curriculum(v_pkg.curriculum_id);
    EXCEPTION WHEN OTHERS THEN v_unenriched := NULL; END;
  END IF;

  -- Decision tree
  IF v_pkg.archived THEN
    v_suggestion := 'NONE'; v_safe := false; v_reason := 'package_archived';
  ELSIF v_active > 0 THEN
    v_suggestion := 'WAIT'; v_safe := false; v_reason := 'active_jobs_running';
  ELSIF coalesce(v_pkg.blocked_reason,'') ILIKE 'ENRICHMENT_GATE%'
     OR coalesce(v_pkg.blocked_reason,'') ILIKE '%competencies enriched%'
     OR coalesce(v_unenriched,0) > 0 THEN
    v_suggestion := 'WAIT_GATE'; v_safe := true;
    v_reason := format('Enrichment gate active: %s unenriched competencies', coalesce(v_unenriched,-1));
  ELSIF v_phantom > 0 THEN
    v_suggestion := 'SKIP_TRACK_DRIFT'; v_safe := true;
    v_reason := format('%s phantom track-drift step(s) detected', v_phantom);
  ELSIF v_pkg.status = 'queued' AND v_done > 0 AND v_open > 0 THEN
    v_suggestion := 'AUTO_PROMOTE'; v_safe := true;
    v_reason := format('Pattern X5: %s done / %s open steps, no active jobs', v_done, v_open);
  ELSE
    v_suggestion := 'NONE'; v_safe := false;
    v_reason := 'no_actionable_pattern';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'title', v_pkg.title,
    'status', v_pkg.status,
    'blocked_reason', v_pkg.blocked_reason,
    'active_jobs', v_active,
    'done_steps', v_done,
    'open_steps', v_open,
    'phantom_steps', v_phantom,
    'unenriched_competencies', v_unenriched,
    'suggestion', v_suggestion,
    'safe_to_apply', v_safe,
    'reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suggest_heal_for_queued_stall(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_suggest_heal_for_queued_stall(uuid) TO authenticated, service_role;

-- Apply suggestion safely
CREATE OR REPLACE FUNCTION public.admin_apply_suggested_heal(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sugg jsonb;
  v_action text;
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  v_sugg := public.admin_suggest_heal_for_queued_stall(p_package_id);

  IF NOT (v_sugg->>'safe_to_apply')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_safe_to_apply', 'suggestion', v_sugg);
  END IF;

  v_action := v_sugg->>'suggestion';

  IF v_action = 'AUTO_PROMOTE' THEN
    v_result := public.admin_heal_pending_enqueue_drift(ARRAY[p_package_id], 'cockpit_suggestion_auto_promote', false);
  ELSIF v_action = 'SKIP_TRACK_DRIFT' THEN
    v_result := public.admin_skip_track_drift_steps(p_package_id);
    -- nach skip: promote
    PERFORM public.admin_heal_pending_enqueue_drift(ARRAY[p_package_id], 'cockpit_suggestion_skip_then_promote', false);
  ELSIF v_action = 'WAIT_GATE' THEN
    -- nur Watcher antriggern
    v_result := public.fn_watch_enrichment_gates_and_kick_enrich(1, 0);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'no_action_for_suggestion', 'suggestion', v_sugg);
  END IF;

  INSERT INTO public.heal_audit_layers
    (package_id, trigger_source, action_type, result_status, symptom_before, symptom_after, notes)
  VALUES (p_package_id, 'cockpit_apply_suggested_heal', v_action, 'success',
          v_sugg, v_result, format('Applied suggestion: %s', v_action));

  RETURN jsonb_build_object('ok', true, 'applied', v_action, 'suggestion', v_sugg, 'result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_suggested_heal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_apply_suggested_heal(uuid) TO authenticated, service_role;

-- View: queued-stall Kandidaten fürs Cockpit
CREATE OR REPLACE VIEW public.v_queued_stall_candidates AS
WITH steps AS (
  SELECT package_id,
         COUNT(*) FILTER (WHERE status::text='done') AS done_steps,
         COUNT(*) FILTER (WHERE status::text IN ('queued','pending_enqueue','failed','blocked','timeout')) AS open_steps,
         COUNT(*) FILTER (WHERE coalesce(last_error,'') ILIKE '%track-drift detected%' AND status::text NOT IN ('done','skipped')) AS phantom_steps
  FROM public.package_steps GROUP BY package_id
),
jobs AS (
  SELECT package_id, COUNT(*) AS active
  FROM public.job_queue
  WHERE status IN ('processing','running','pending','queued','retry_scheduled','batch_pending')
  GROUP BY package_id
)
SELECT cp.id AS package_id, cp.title, cp.track, cp.status, cp.blocked_reason,
       cp.updated_at,
       COALESCE(s.done_steps,0) AS done_steps,
       COALESCE(s.open_steps,0) AS open_steps,
       COALESCE(s.phantom_steps,0) AS phantom_steps,
       COALESCE(j.active,0) AS active_jobs
FROM public.course_packages cp
LEFT JOIN steps s ON s.package_id=cp.id
LEFT JOIN jobs j ON j.package_id=cp.id
WHERE cp.archived = false
  AND cp.status = 'queued'
  AND COALESCE(s.done_steps,0) > 0
  AND COALESCE(j.active,0) = 0;

REVOKE ALL ON public.v_queued_stall_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_queued_stall_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_queued_stall_candidates(p_limit integer DEFAULT 50)
RETURNS SETOF public.v_queued_stall_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_queued_stall_candidates ORDER BY updated_at ASC LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_queued_stall_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_queued_stall_candidates(integer) TO authenticated, service_role;
