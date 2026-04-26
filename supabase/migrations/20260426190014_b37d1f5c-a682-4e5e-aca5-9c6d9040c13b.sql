-- ============================================================
-- 1) STALE-PROCESSING REAPER
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_reap_stale_processing_jobs(p_stale_minutes int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_requeued int := 0;
  v_failed int := 0;
  v_cutoff timestamptz;
BEGIN
  v_cutoff := now() - (p_stale_minutes || ' minutes')::interval;

  -- a) Versuchszahl noch unter max → requeue (pending, lock release)
  WITH stale AS (
    SELECT id, attempts, max_attempts
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE(attempts, 0) < COALESCE(max_attempts, 25)
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        last_heartbeat_at = NULL,
        liveness_status = 'suspect',
        last_error = 'STALE_PROCESSING_REAPED: heartbeat older than ' || p_stale_minutes || 'min — auto-requeued',
        last_error_code = 'STALE_PROCESSING_REAPED',
        run_after = now() + interval '60 seconds',
        updated_at = now()
    FROM stale s
    WHERE jq.id = s.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_requeued FROM upd;

  -- b) Versuchszahl bereits ≥ max → failed (kein endloses Recycling)
  WITH stale_exhausted AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE(attempts, 0) >= COALESCE(max_attempts, 25)
    FOR UPDATE SKIP LOCKED
  ),
  upd2 AS (
    UPDATE public.job_queue jq
    SET status = 'failed',
        completed_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        liveness_status = 'killed',
        last_error = 'STALE_PROCESSING_EXHAUSTED: heartbeat lost AND max_attempts reached',
        last_error_code = 'STALE_PROCESSING_EXHAUSTED',
        updated_at = now()
    FROM stale_exhausted s
    WHERE jq.id = s.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_failed FROM upd2;

  IF v_requeued > 0 OR v_failed > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, result_status, result_detail, metadata)
    VALUES ('reap_stale_processing','cron','applied',
            format('Reaped %s stale processing jobs (requeued=%s failed=%s)', v_requeued+v_failed, v_requeued, v_failed),
            jsonb_build_object('requeued',v_requeued,'failed',v_failed,'stale_minutes',p_stale_minutes));
  END IF;

  RETURN jsonb_build_object('ok',true,'requeued',v_requeued,'failed',v_failed,'stale_minutes',p_stale_minutes);
END;
$$;

-- Cron alle 5 Minuten
DO $$
BEGIN
  PERFORM cron.unschedule('reap-stale-processing-jobs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'reap-stale-processing-jobs',
  '*/5 * * * *',
  $$SELECT public.fn_reap_stale_processing_jobs(10);$$
);

-- ============================================================
-- 2) MAX_ATTEMPTS ESKALATION (BEFORE-UPDATE Trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_guard_max_attempts_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Nur eingreifen, wenn attempts gerade > max_attempts gesetzt wird
  -- und der Job nicht in einem terminalen Status landet
  IF COALESCE(NEW.attempts, 0) > COALESCE(NEW.max_attempts, 25)
     AND NEW.status NOT IN ('completed','failed','cancelled') THEN

    NEW.status := 'failed';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.locked_at := NULL;
    NEW.locked_by := NULL;
    NEW.last_error_code := COALESCE(NEW.last_error_code, 'MAX_ATTEMPTS_EXHAUSTED');
    NEW.last_error := COALESCE(NEW.last_error, '') ||
      format(' | MAX_ATTEMPTS_EXHAUSTED: attempts=%s max=%s — auto-escalated to failed',
             NEW.attempts, NEW.max_attempts);
    NEW.liveness_status := 'cooldown_exhausted';
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_max_attempts_escalation ON public.job_queue;
CREATE TRIGGER trg_guard_max_attempts_escalation
  BEFORE UPDATE ON public.job_queue
  FOR EACH ROW
  WHEN (NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts OR NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.fn_guard_max_attempts_escalation();

-- Backfill: bestehende Drift-Jobs eskalieren
UPDATE public.job_queue
SET status = 'failed',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error_code = 'MAX_ATTEMPTS_EXHAUSTED',
    last_error = COALESCE(last_error,'') || ' | BACKFILL: attempts > max_attempts at trigger install',
    liveness_status = 'cooldown_exhausted',
    updated_at = now()
WHERE status IN ('pending','processing','queued','enqueued','batch_pending')
  AND COALESCE(attempts,0) > COALESCE(max_attempts,25);

-- ============================================================
-- 3) STEP_ALREADY_DONE_PHANTOM PRE-ENQUEUE GUARD
-- ============================================================
-- Helper: ist der Ziel-Step schon done/skipped?
CREATE OR REPLACE FUNCTION public.fn_step_already_terminal(p_job_type text, p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_package_id IS NULL OR p_job_type NOT LIKE 'package_%' THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.package_steps ps
      WHERE ps.package_id = p_package_id
        AND ps.step_key = replace(p_job_type, 'package_', '')
        AND ps.status IN ('done','skipped')
    )
  END;
$$;

-- Overload A: enqueue_job_if_absent(job_type, package_id, priority, max_attempts, run_after, payload)
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid DEFAULT NULL::uuid,
  p_priority integer DEFAULT 0,
  p_max_attempts integer DEFAULT 25,
  p_run_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(id uuid, created boolean, duplicate boolean, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_step_key text; v_existing record; v_new_id uuid;
  v_recent_completed_count int; v_step_status text; v_mapped_step text;
  v_active_count int; v_is_incremental_dispatcher boolean;
  v_fanout_cap int; v_zero_progress_threshold int;
  v_pkg_status text;
begin
  v_step_key := coalesce(p_payload->>'step_key', p_payload->>'step', p_payload->>'target_step', '');
  v_is_incremental_dispatcher := p_job_type IN (
    'package_generate_learning_content','package_finalize_learning_content',
    'package_generate_handbook','package_generate_lesson_minichecks',
    'package_enqueue_handbook_expand','package_fanout_learning_content'
  );
  v_fanout_cap := CASE WHEN v_is_incremental_dispatcher THEN 5 ELSE 3 END;
  v_zero_progress_threshold := CASE WHEN v_is_incremental_dispatcher THEN 8 ELSE 3 END;

  -- ── NEU: Phantom Pre-Enqueue Guard ──
  IF public.fn_step_already_terminal(p_job_type, p_package_id) THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_phantom_blocked','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Step already done/skipped for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',replace(p_job_type,'package_','')));
    return query select NULL::uuid, false, false, 'phantom_blocked'::text; return;
  END IF;

  -- ── P0a Guard: building-only jobtypes require pkg_status='building' ──
  if p_package_id is not null and public.fn_job_type_requires_building(p_job_type) then
    select cp.status into v_pkg_status from public.course_packages cp where cp.id = p_package_id;
    if v_pkg_status is null or v_pkg_status <> 'building' then
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_non_building_block','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Package not in building status for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'pkg_status',v_pkg_status));
      return query select NULL::uuid, false, false, 'non_building_blocked'::text; return;
    end if;
  end if;

  select jq.id, jq.status into v_existing from public.job_queue jq
  where jq.job_type = p_job_type
    and coalesce(jq.package_id::text,'') = coalesce(p_package_id::text,'')
    and coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    and jq.status in ('pending','queued','processing','running','batch_pending')
  order by jq.created_at desc limit 1;
  if found then
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_dedupe','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Duplicate active job for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',v_step_key,'existing_id',v_existing.id,'existing_status',v_existing.status));
    return query select v_existing.id, false, true, 'duplicate_active'::text; return;
  end if;

  if p_package_id is not null then
    select count(*) into v_active_count from public.job_queue jq
    where jq.job_type = p_job_type and jq.package_id = p_package_id
      and jq.status in ('pending','queued','processing','running','batch_pending');
    if v_active_count >= v_fanout_cap then
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_fanout_cap','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Fanout cap reached for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'active_count',v_active_count,'cap',v_fanout_cap));
      return query select NULL::uuid, false, false, 'fanout_capped'::text; return;
    end if;
  end if;

  if p_package_id is not null then
    select count(*) into v_recent_completed_count from public.job_queue jq
    where jq.job_type = p_job_type and jq.package_id = p_package_id
      and jq.status='completed' and jq.updated_at > now() - interval '2 hours';
    if v_recent_completed_count >= v_zero_progress_threshold then
      v_mapped_step := regexp_replace(p_job_type, '^package_', '');
      select ps.status::text into v_step_status from public.package_steps ps
      where ps.package_id = p_package_id and ps.step_key = v_mapped_step limit 1;
      if v_step_status is not null and v_step_status not in ('done','skipped') then
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('enqueue_zero_progress','enqueue_job_if_absent','job',p_package_id::text,'rejected',
                'Zero-progress block for '||p_job_type,
                jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'completed_2h',v_recent_completed_count,'threshold',v_zero_progress_threshold,'step_status',v_step_status));
        return query select NULL::uuid, false, false, 'zero_progress_blocked'::text; return;
      end if;
    end if;
  end if;

  insert into public.job_queue (job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at)
  values (p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after, p_payload, p_payload, now(), now())
  returning job_queue.id into v_new_id;
  return query select v_new_id, true, false, 'pending'::text;
end;
$function$;

-- Overload B: enqueue_job_if_absent(job_type, package_id, payload, priority, max_attempts, run_after)
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid DEFAULT NULL::uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_priority integer DEFAULT 100,
  p_max_attempts integer DEFAULT 5,
  p_run_after timestamp with time zone DEFAULT now()
)
RETURNS TABLE(job_id uuid, created boolean, deduped boolean, existing_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_step_key text;
  v_existing record;
  v_new_id uuid;
  v_recent_completed_count int;
  v_step_status text;
  v_mapped_step text;
  v_pkg_status text;
begin
  v_step_key := coalesce(p_payload->>'step_key', p_payload->>'step', p_payload->>'target_step', '');

  -- ── NEU: Phantom Pre-Enqueue Guard ──
  IF public.fn_step_already_terminal(p_job_type, p_package_id) THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_phantom_blocked','enqueue_job_if_absent_v2','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Step already done/skipped for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id));
    return query select gen_random_uuid(), false, true, 'phantom_blocked'::text;
    return;
  END IF;

  -- ── P0a Guard ──
  if p_package_id is not null and public.fn_job_type_requires_building(p_job_type) then
    select cp.status into v_pkg_status from public.course_packages cp where cp.id = p_package_id;
    if v_pkg_status is null or v_pkg_status <> 'building' then
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_non_building_block','enqueue_job_if_absent_v2','job',p_package_id::text,'rejected',
              'Package not in building status for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'pkg_status',v_pkg_status));
      return query select gen_random_uuid(), false, true, 'non_building_blocked'::text;
      return;
    end if;
  end if;

  select jq.id, jq.status into v_existing from public.job_queue jq
  where jq.job_type = p_job_type
    and coalesce(jq.package_id::text, '') = coalesce(p_package_id::text, '')
    and coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    and jq.status in ('pending', 'queued', 'processing', 'running', 'batch_pending')
  order by jq.created_at desc limit 1;
  if found then
    return query select v_existing.id, false, true, v_existing.status;
    return;
  end if;

  if p_package_id is not null then
    select count(*) into v_recent_completed_count from public.job_queue jq
    where jq.job_type = p_job_type and jq.package_id = p_package_id
      and jq.status = 'completed' and jq.updated_at > now() - interval '2 hours';
    if v_recent_completed_count >= 3 then
      v_mapped_step := regexp_replace(p_job_type, '^package_', '');
      select ps.status into v_step_status from public.package_steps ps
      where ps.package_id = p_package_id and ps.step_key = v_mapped_step limit 1;
      if v_step_status is not null and v_step_status not in ('done', 'skipped') then
        return query select gen_random_uuid(), false, true, 'zero_progress_blocked'::text;
        return;
      end if;
    end if;
  end if;

  insert into public.job_queue (job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at)
  values (p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after, p_payload, p_payload, now(), now())
  returning id into v_new_id;
  return query select v_new_id, true, false, 'pending'::text;
end;
$function$;