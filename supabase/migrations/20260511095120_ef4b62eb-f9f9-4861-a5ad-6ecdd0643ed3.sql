DROP FUNCTION IF EXISTS public.complete_job(uuid, jsonb);
DROP FUNCTION IF EXISTS public.complete_job(uuid, json, integer, numeric);

CREATE FUNCTION public.complete_job(p_job_id uuid, p_result jsonb DEFAULT NULL::jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_updated int; v_status text;
BEGIN
  UPDATE public.job_queue
  SET status='completed', result=p_result, completed_at=now(),
      locked_at=NULL, locked_by=NULL, updated_at=now()
  WHERE id=p_job_id AND status='processing';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT status INTO v_status FROM public.job_queue WHERE id = p_job_id;
    INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, metadata)
    VALUES ('complete_job_cas_conflict', p_job_id, 'job_queue', 'noop',
            jsonb_build_object(
              'reason','job no longer in status=processing — reaper or duplicate completion won the CAS',
              'observed_status', v_status,
              'completion_attempt_at', now()));
    RETURN false;
  END IF;
  RETURN true;
END;
$function$;

CREATE FUNCTION public.complete_job(
  p_job_id uuid, p_result json DEFAULT NULL::json,
  p_tokens_used integer DEFAULT 0, p_cost_eur numeric DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_job_type text; v_updated int; v_status text;
BEGIN
  SELECT job_type INTO v_job_type FROM public.job_queue WHERE id = p_job_id;

  UPDATE public.job_queue
  SET status='completed', completed_at=now(), result=p_result,
      locked_at=NULL, locked_by=NULL, updated_at=now()
  WHERE id=p_job_id AND status='processing';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT status INTO v_status FROM public.job_queue WHERE id = p_job_id;
    INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, metadata)
    VALUES ('complete_job_cas_conflict', p_job_id, 'job_queue', 'noop',
            jsonb_build_object(
              'reason','job no longer in status=processing — reaper or duplicate completion won the CAS',
              'observed_status', v_status,
              'job_type', v_job_type,
              'completion_attempt_at', now()));
    RETURN false;
  END IF;

  IF v_job_type IS NOT NULL THEN
    PERFORM public.record_worker_usage(v_job_type, p_tokens_used, p_cost_eur, false);
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE VIEW public.v_complete_job_cas_conflicts AS
SELECT date_trunc('hour', created_at) AS hour,
       COALESCE(metadata->>'job_type','unknown')        AS job_type,
       COALESCE(metadata->>'observed_status','unknown') AS observed_status,
       count(*) AS conflicts
FROM public.auto_heal_log
WHERE action_type = 'complete_job_cas_conflict'
  AND created_at > now() - interval '24 hours'
GROUP BY 1,2,3 ORDER BY 1 DESC, conflicts DESC;

REVOKE ALL ON public.v_complete_job_cas_conflicts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_complete_job_cas_conflicts TO service_role;

CREATE OR REPLACE FUNCTION public.fn_smoke_complete_job_cas(p_initial_status text DEFAULT 'processing')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_ok boolean; v_status_after text;
BEGIN
  v_id := gen_random_uuid();
  -- pipeline_tick is SSOT-exempt in guard_job_payload — safe for synthetic smoke
  INSERT INTO public.job_queue(id, job_type, status, payload, attempts, max_attempts, locked_at, locked_by)
  VALUES (v_id, 'pipeline_tick', p_initial_status, '{"_smoke":true}'::jsonb, 1, 25,
          CASE WHEN p_initial_status='processing' THEN now() ELSE NULL END, 'smoke');

  SELECT public.complete_job(v_id, '{"smoke":true}'::jsonb) INTO v_ok;
  SELECT status INTO v_status_after FROM public.job_queue WHERE id = v_id;
  DELETE FROM public.job_queue WHERE id = v_id;

  RETURN jsonb_build_object('initial_status', p_initial_status,
                            'cas_succeeded', v_ok,
                            'status_after', v_status_after);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_smoke_complete_job_cas(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_smoke_complete_job_cas(text) TO service_role;

DO $$
DECLARE r1 jsonb; r2 jsonb;
BEGIN
  SELECT public.fn_smoke_complete_job_cas('processing') INTO r1;
  IF (r1->>'cas_succeeded')<>'true' OR (r1->>'status_after')<>'completed' THEN
    RAISE EXCEPTION 'CAS positive case failed: %', r1;
  END IF;
  SELECT public.fn_smoke_complete_job_cas('pending') INTO r2;
  IF (r2->>'cas_succeeded')<>'false' OR (r2->>'status_after')<>'pending' THEN
    RAISE EXCEPTION 'CAS negative case failed: %', r2;
  END IF;
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('complete_job_cas_smoke','system','ok',
          jsonb_build_object('positive', r1, 'negative', r2, 'at', now()));
END $$;