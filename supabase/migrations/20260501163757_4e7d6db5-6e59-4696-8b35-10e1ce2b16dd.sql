-- =============================================================================
-- Council-Deferred Heal v1 (corrected) — Status-Fix + Anti-Loop + Backfill + RPC
-- =============================================================================

-- 1. fn_auto_defer_stale_council umbauen: skipped -> failed
CREATE OR REPLACE FUNCTION public.fn_auto_defer_stale_council()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stale_codes text[] := ARRAY['STALE_PROCESSING_EXHAUSTED','STALE_PROCESSING_REAPED','MAX_ATTEMPTS_EXHAUSTED','JOB_LIVENESS_GUARD'];
  v_fail_count int;
  v_codes text[];
  v_curriculum_id uuid;
  v_already_deferred boolean;
BEGIN
  IF NEW.job_type <> 'package_quality_council' OR NEW.status <> 'failed' OR NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.last_error_code IS NULL OR NOT (NEW.last_error_code = ANY(v_stale_codes)) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.council_defer_log
    WHERE package_id = NEW.package_id AND cleared_at IS NULL
  ) INTO v_already_deferred;
  IF v_already_deferred THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*), array_agg(DISTINCT last_error_code) FILTER (WHERE last_error_code IS NOT NULL)
    INTO v_fail_count, v_codes
  FROM public.job_queue
  WHERE job_type = 'package_quality_council'
    AND package_id = NEW.package_id
    AND status = 'failed'
    AND last_error_code = ANY(v_stale_codes)
    AND COALESCE(completed_at, updated_at) > now() - interval '6 hours';

  IF v_fail_count < 3 THEN
    RETURN NEW;
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM public.course_packages WHERE id = NEW.package_id;

  INSERT INTO public.council_defer_log
    (package_id, curriculum_id, defer_reason, error_codes, fail_count, meta)
  VALUES (
    NEW.package_id, v_curriculum_id, 'STALE_WORKER_PATTERN_3X', v_codes, v_fail_count,
    jsonb_build_object('triggered_by_job_id', NEW.id, 'last_error_code', NEW.last_error_code)
  );

  UPDATE public.package_steps
     SET status = 'failed',
         last_error = format('council_deferred: %s after %s stale worker fails', 'STALE_WORKER_PATTERN_3X', v_fail_count),
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
           'auto_deferred', true, 'review_required', true,
           'defer_reason', 'STALE_WORKER_PATTERN_3X',
           'deferred_at', now(), 'error_codes', to_jsonb(v_codes)
         ),
         updated_at = now()
   WHERE package_id = NEW.package_id AND step_key = 'quality_council' AND status NOT IN ('done');

  UPDATE public.job_queue
     SET status = 'cancelled',
         last_error = 'cancelled_by_council_defer: auto_publish blocked while council_defer_log open',
         updated_at = now()
   WHERE package_id = NEW.package_id
     AND job_type = 'package_auto_publish'
     AND status IN ('pending','queued','processing');

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('council_deferred_v2', 'package', NEW.package_id::text, 'success',
    jsonb_build_object('fail_count', v_fail_count, 'error_codes', v_codes, 'triggered_by_job_id', NEW.id));

  RETURN NEW;
END;
$function$;

-- 2. Anti-Loop BEFORE INSERT Trigger
CREATE OR REPLACE FUNCTION public.fn_block_auto_publish_while_council_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.job_type <> 'package_auto_publish' OR NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('pending','queued') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.council_defer_log
    WHERE package_id = NEW.package_id AND cleared_at IS NULL
  ) THEN
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES ('auto_publish_blocked_council_deferred', 'package', NEW.package_id::text, 'skipped',
      jsonb_build_object('attempted_status', NEW.status));
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_auto_publish_while_council_deferred ON public.job_queue;
CREATE TRIGGER trg_block_auto_publish_while_council_deferred
BEFORE INSERT ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_block_auto_publish_while_council_deferred();

-- 3. Backfill steps skipped -> failed for currently deferred packages
UPDATE public.package_steps ps
   SET status = 'failed',
       last_error = COALESCE(ps.last_error, 'council_deferred backfill'),
       meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
         'auto_deferred', true, 'review_required', true,
         'defer_reason', 'STALE_WORKER_PATTERN_3X', 'backfilled_at', now()
       ),
       updated_at = now()
  FROM public.council_defer_log cdl
 WHERE cdl.cleared_at IS NULL
   AND ps.package_id = cdl.package_id
   AND ps.step_key = 'quality_council'
   AND ps.status = 'skipped';

UPDATE public.job_queue jq
   SET status = 'cancelled',
       last_error = 'cancelled_by_council_defer_backfill',
       updated_at = now()
  FROM public.council_defer_log cdl
 WHERE cdl.cleared_at IS NULL
   AND jq.package_id = cdl.package_id
   AND jq.job_type = 'package_auto_publish'
   AND jq.status IN ('pending','queued','processing');

-- 4. Permanent-Fix-Tasks (real schema: title, description, notes, created_by NOT NULL)
INSERT INTO public.heal_permanent_fix_tasks
  (pattern_key, cluster, package_id, priority, title, description, notes, status, created_by)
SELECT
  'COUNCIL_DEFERRED_STALE_WORKER_3X',
  'quality_council',
  cdl.package_id,
  'high',
  format('Council-Deferred: %s', COALESCE(cp.title, cdl.package_id::text)),
  format('Quality-Council failed %s× mit %s. Manuelle Review erforderlich.',
    cdl.fail_count, array_to_string(cdl.error_codes, ', ')),
  'admin_resolve_council_deferred(p_package_id, p_action, p_reason) -- actions: retry_council | force_pass | mark_content_gap',
  'open',
  '00000000-0000-0000-0000-000000000000'::uuid  -- system creator
FROM public.council_defer_log cdl
JOIN public.course_packages cp ON cp.id = cdl.package_id
WHERE cdl.cleared_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.heal_permanent_fix_tasks t
    WHERE t.pattern_key = 'COUNCIL_DEFERRED_STALE_WORKER_3X'
      AND t.package_id = cdl.package_id
      AND t.status IN ('open','in_progress')
  );

-- 5. Resolution-RPC
CREATE OR REPLACE FUNCTION public.admin_resolve_council_deferred(
  p_package_id uuid, p_action text, p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_defer_id uuid;
  v_admin uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_action NOT IN ('retry_council','force_pass','mark_content_gap') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_action');
  END IF;

  SELECT id INTO v_defer_id
  FROM public.council_defer_log
  WHERE package_id = p_package_id AND cleared_at IS NULL
  ORDER BY deferred_at DESC LIMIT 1;

  IF v_defer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_defer_for_package');
  END IF;

  IF p_action = 'retry_council' THEN
    UPDATE public.council_defer_log SET cleared_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cleared_by', v_admin, 'cleared_action', 'retry_council', 'reason', p_reason)
     WHERE id = v_defer_id;

    UPDATE public.package_steps
       SET status = 'queued', attempts = 0, last_error = NULL,
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('council_retry_at', now(), 'council_retry_by', v_admin),
           updated_at = now()
     WHERE package_id = p_package_id AND step_key = 'quality_council' AND status IN ('failed','skipped');

    INSERT INTO public.job_queue (package_id, job_type, status, payload, created_at, updated_at)
    VALUES (p_package_id, 'package_quality_council', 'queued',
            jsonb_build_object('source','admin_resolve_council_deferred','admin_id', v_admin),
            now(), now());

    v_result := jsonb_build_object('ok', true, 'action', 'retry_council', 'package_id', p_package_id);

  ELSIF p_action = 'force_pass' THEN
    UPDATE public.package_steps
       SET status = 'done', last_error = NULL,
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('force_pass', true, 'force_pass_at', now(), 'force_pass_by', v_admin, 'reason', p_reason),
           updated_at = now()
     WHERE package_id = p_package_id AND step_key = 'quality_council';

    UPDATE public.council_defer_log SET cleared_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cleared_by', v_admin, 'cleared_action', 'force_pass', 'reason', p_reason)
     WHERE id = v_defer_id;

    UPDATE public.heal_permanent_fix_tasks SET status = 'done', completed_at = now(), completed_by = v_admin, updated_at = now()
     WHERE pattern_key = 'COUNCIL_DEFERRED_STALE_WORKER_3X' AND package_id = p_package_id AND status IN ('open','in_progress');

    v_result := jsonb_build_object('ok', true, 'action', 'force_pass', 'package_id', p_package_id);

  ELSE  -- mark_content_gap
    UPDATE public.course_packages
       SET status = 'archived',
           blocked_reason = COALESCE(blocked_reason, 'COUNCIL_DEFERRED_MANUAL_REVIEW'),
           updated_at = now()
     WHERE id = p_package_id;

    UPDATE public.council_defer_log SET cleared_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cleared_by', v_admin, 'cleared_action', 'mark_content_gap', 'reason', p_reason)
     WHERE id = v_defer_id;

    UPDATE public.heal_permanent_fix_tasks SET status = 'done', completed_at = now(), completed_by = v_admin, updated_at = now()
     WHERE pattern_key = 'COUNCIL_DEFERRED_STALE_WORKER_3X' AND package_id = p_package_id AND status IN ('open','in_progress');

    v_result := jsonb_build_object('ok', true, 'action', 'mark_content_gap', 'package_id', p_package_id);
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('admin_resolve_council_deferred', 'package', p_package_id::text, 'success',
    jsonb_build_object('action', p_action, 'reason', p_reason, 'admin_id', v_admin));

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_council_deferred(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_council_deferred(uuid, text, text) TO service_role;

-- 6. Overview-RPC
CREATE OR REPLACE FUNCTION public.admin_get_council_deferred_overview()
RETURNS TABLE (
  package_id uuid, package_title text, defer_reason text, error_codes text[],
  fail_count int, deferred_at timestamptz, age_seconds int,
  step_status text, exam_questions_total bigint, exam_questions_approved bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT cdl.package_id, cp.title, cdl.defer_reason, cdl.error_codes, cdl.fail_count,
    cdl.deferred_at, EXTRACT(EPOCH FROM (now() - cdl.deferred_at))::int,
    ps.status, COALESCE(eq.total, 0), COALESCE(eq.approved, 0)
  FROM public.council_defer_log cdl
  JOIN public.course_packages cp ON cp.id = cdl.package_id
  LEFT JOIN public.package_steps ps ON ps.package_id = cdl.package_id AND ps.step_key = 'quality_council'
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='approved') AS approved
    FROM public.exam_questions WHERE package_id = cdl.package_id
  ) eq ON true
  WHERE cdl.cleared_at IS NULL
  ORDER BY cdl.deferred_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_council_deferred_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_council_deferred_overview() TO service_role;