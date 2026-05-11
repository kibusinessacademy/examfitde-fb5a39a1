-- =====================================================================
-- Phantom Producer Guard v1 + Cancel Hotspots RPC
-- =====================================================================

-- 1) Hardened atomic enqueue trigger
CREATE OR REPLACE FUNCTION public.fn_atomic_enqueue_on_step_queued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid;
  v_job_type text;
  v_existing_active int;
  v_recent_done int;
  v_is_applicable boolean;
  v_recent_audit boolean;
  v_recent_dup int;
  v_bronze_blocked_types text[] := ARRAY['package_quality_council','package_auto_publish'];
BEGIN
  IF NOT (NEW.status = 'queued'::step_status AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'queued'::step_status)) THEN
    RETURN NEW;
  END IF;

  IF NEW.meta ? 'last_atomic_enqueue_at'
     AND (NEW.meta->>'last_atomic_enqueue_at')::timestamptz > now() - interval '30 seconds' THEN
    RETURN NEW;
  END IF;

  -- ===== PHANTOM PRODUCER GUARD v1 (Fix #1) =====
  -- Guard A: Wenn der Step gerade erst final war (UPDATE), keinen Job erzeugen.
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('done'::step_status, 'skipped'::step_status, 'failed'::step_status)
     AND COALESCE(OLD.finished_at, OLD.updated_at) > now() - interval '60 seconds' THEN
    INSERT INTO public.auto_heal_log(
      action_type, trigger_source, target_type, target_id, result_status, metadata
    ) VALUES (
      'atomic_enqueue_skipped_recent_finalized_step',
      'trg_atomic_enqueue_on_step_queued',
      'package_step', NEW.id::text, 'skipped',
      jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'old_status', OLD.status::text,
        'old_finished_at', OLD.finished_at,
        'reason', 'recent_finalized_step_guard',
        'guard_window_seconds', 60
      )
    );
    RETURN NEW;
  END IF;

  v_job_type := 'package_'||NEW.step_key::text;

  -- Guard B: Wenn bereits ein frischer (≤60s) gleicher Job existiert (egal welcher Status), nicht erneut erzeugen.
  SELECT COUNT(*) INTO v_recent_dup
  FROM public.job_queue jq
  WHERE jq.package_id = NEW.package_id
    AND jq.job_type = v_job_type
    AND jq.created_at > now() - interval '60 seconds';
  IF v_recent_dup > 0 THEN
    INSERT INTO public.auto_heal_log(
      action_type, trigger_source, target_type, target_id, result_status, metadata
    ) VALUES (
      'atomic_enqueue_skipped_recent_duplicate',
      'trg_atomic_enqueue_on_step_queued',
      'package_step', NEW.id::text, 'skipped',
      jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'job_type', v_job_type,
        'recent_dup_count', v_recent_dup,
        'reason', 'recent_duplicate_job_guard',
        'guard_window_seconds', 60
      )
    );
    RETURN NEW;
  END IF;
  -- ===== /PHANTOM PRODUCER GUARD v1 =====

  -- Legacy guard (auto_heal_log-based, kept for compatibility)
  SELECT COUNT(*) INTO v_recent_done
  FROM auto_heal_log
  WHERE action_type IN ('step_finalized_done','step_finalized_skipped','step_finalized_failed')
    AND target_id = NEW.id::text
    AND created_at > now() - interval '5 minutes';
  IF v_recent_done > 0 THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id)
    VALUES ('pattern_x10_phantom_atomic_blocked','trg_atomic_enqueue_on_step_queued','blocked',
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key,
                               'reason','step recently finalized → phantom re-enqueue blocked')::text,
            'package_step', NEW.id::text);
    RETURN NEW;
  END IF;

  v_is_applicable := public.fn_is_step_applicable_for_package(NEW.package_id, NEW.step_key);
  IF v_is_applicable IS FALSE THEN
    NEW.status := 'skipped'::step_status;
    NEW.meta := COALESCE(NEW.meta,'{}'::jsonb) || jsonb_build_object(
      'skipped_reason','TRACK_NOT_APPLICABLE',
      'pattern_x7_auto_skip_at', now()
    );
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id)
    VALUES ('pattern_x7_auto_reskip','trg_atomic_enqueue_on_step_queued','done',
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key)::text,
            'package_step', NEW.id::text);
    RETURN NEW;
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id=NEW.package_id;

  -- Bronze-Pre-Filter (Council/AutoPublish): skip locked Pakete
  IF v_job_type = ANY(v_bronze_blocked_types)
     AND public.fn_is_bronze_locked(NEW.package_id) THEN
    SELECT EXISTS(
      SELECT 1 FROM auto_heal_log
      WHERE action_type='atomic_enqueue_skipped_bronze_locked'
        AND target_id = NEW.package_id::text
        AND metadata->>'job_type' = v_job_type
        AND created_at > now() - interval '1 hour'
    ) INTO v_recent_audit;
    IF NOT v_recent_audit THEN
      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('atomic_enqueue_skipped_bronze_locked','course_package',NEW.package_id::text,'skipped',
        jsonb_build_object(
          'enqueue_source','trg_atomic_enqueue',
          'job_type',v_job_type,
          'step_key',NEW.step_key,
          'reason','BRONZE_LOCKED_REQUIRES_REVIEW'));
    END IF;
    RETURN NEW;
  END IF;

  IF v_curriculum_id IS NULL THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id, metadata)
    VALUES ('atomic_enqueue_missing_curriculum','trg_atomic_enqueue_on_step_queued','rejected',
            'Cannot enqueue '||v_job_type||' — package missing curriculum_id',
            'package_step', NEW.id::text,
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key));
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_existing_active FROM job_queue
  WHERE package_id=NEW.package_id AND job_type=v_job_type
    AND status IN ('pending','queued','processing','running','batch_pending');
  IF v_existing_active > 0 THEN RETURN NEW; END IF;

  INSERT INTO job_queue(job_type,payload,status,max_attempts,priority,package_id,meta)
  VALUES(v_job_type,
    jsonb_build_object(
      'package_id', NEW.package_id,
      'curriculum_id', v_curriculum_id,
      'step_key', NEW.step_key::text,
      'enqueue_source','trg_atomic_enqueue'
    ),
    'pending',8,50,NEW.package_id,
    jsonb_build_object('source','atomic_step_enqueue','enqueue_source','trg_atomic_enqueue','enqueued_at',now())
  );

  NEW.meta := COALESCE(NEW.meta,'{}'::jsonb) || jsonb_build_object('last_atomic_enqueue_at',now());
  RETURN NEW;
END $function$;

-- 2) Cancel hotspots RPC (per package_id × step × reason)
CREATE OR REPLACE FUNCTION public.admin_get_cancel_hotspots(
  p_hours int DEFAULT 24,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  job_type text,
  reason_code text,
  package_id uuid,
  package_title text,
  package_status text,
  cnt bigint,
  pct numeric,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.job_queue jq
  WHERE jq.status = 'cancelled'
    AND jq.updated_at > now() - make_interval(hours => p_hours);

  RETURN QUERY
  WITH cancels AS (
    SELECT
      jq.job_type,
      COALESCE(
        NULLIF(split_part(COALESCE(jq.last_error, jq.meta->>'cancel_reason', ''), ':', 1), ''),
        'UNCLASSIFIED'
      ) AS reason_code,
      jq.package_id,
      jq.updated_at
    FROM public.job_queue jq
    WHERE jq.status = 'cancelled'
      AND jq.updated_at > now() - make_interval(hours => p_hours)
      AND jq.package_id IS NOT NULL
  )
  SELECT
    c.job_type,
    c.reason_code,
    c.package_id,
    cp.title AS package_title,
    cp.status::text AS package_status,
    count(*) AS cnt,
    round(count(*)::numeric / NULLIF(v_total, 0)::numeric * 100.0, 1) AS pct,
    min(c.updated_at) AS first_seen,
    max(c.updated_at) AS last_seen
  FROM cancels c
  LEFT JOIN public.course_packages cp ON cp.id = c.package_id
  GROUP BY c.job_type, c.reason_code, c.package_id, cp.title, cp.status
  ORDER BY count(*) DESC, max(c.updated_at) DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_cancel_hotspots(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_cancel_hotspots(int, int) TO authenticated;

-- 3) Audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES (
  'phantom_producer_guard_v1_installed',
  'system',
  'unknown',
  jsonb_build_object(
    'guards', jsonb_build_array('atomic_enqueue_skipped_recent_finalized_step','atomic_enqueue_skipped_recent_duplicate'),
    'window_seconds', 60,
    'rpc', 'admin_get_cancel_hotspots',
    'installed_at', now()
  )
);