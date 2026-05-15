
-- ============================================================================
-- Section 1: Error-Code Normalizer
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_normalize_job_error_code(p_last_error text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_last_error IS NULL OR btrim(p_last_error) = '' THEN 'PRE_HEARTBEAT_KILL'
    WHEN p_last_error ILIKE '%TOO_FEW_CHUNKS%' THEN 'TOO_FEW_CHUNKS'
    WHEN p_last_error ILIKE '%MATERIALIZATION_GUARD%' THEN 'MATERIALIZATION_GUARD'
    WHEN p_last_error ILIKE '%QUALITY_THRESHOLD_NOT_MET%' THEN 'QUALITY_THRESHOLD_NOT_MET'
    WHEN p_last_error ILIKE '%MAX_ATTEMPTS_EXHAUSTED%' THEN 'MAX_ATTEMPTS_EXHAUSTED'
    WHEN p_last_error ILIKE '%REQUEUE_LOOP_KILLED%' THEN 'REQUEUE_LOOP_KILLED'
    WHEN p_last_error ILIKE '%REQUEUE_LOOP_COOLDOWN%' THEN 'REQUEUE_LOOP_COOLDOWN'
    WHEN p_last_error ILIKE '%PARKED_PREREQ%' OR p_last_error ILIKE '%PARKED_AWAITING_PRECONDITION%' THEN 'PARKED_PREREQ'
    WHEN p_last_error ILIKE '%STALE_AFTER_HEARTBEAT%' THEN 'STALE_AFTER_HEARTBEAT'
    WHEN p_last_error ILIKE '%BRONZE_LOCKED%' THEN 'BRONZE_LOCKED_REJECTED'
    WHEN p_last_error ILIKE '%PRODUCER_SOURCE_MISSING%' THEN 'PRODUCER_SOURCE_MISSING'
    WHEN p_last_error ILIKE '%total_ai_budget_exhausted%' THEN 'AI_BUDGET_EXHAUSTED'
    WHEN p_last_error ILIKE '%API_KEY%not configured%' THEN 'API_KEY_MISSING'
    WHEN p_last_error ILIKE '%openai error%' OR p_last_error ILIKE '%HTTP 4%' OR p_last_error ILIKE '%HTTP 5%' THEN 'UPSTREAM_HTTP_ERROR'
    WHEN p_last_error ILIKE '%REPAIR_BLUEPRINT%' THEN 'REPAIR_BLUEPRINT'
    WHEN p_last_error ILIKE '%Gate not PASS%' THEN 'GATE_NOT_PASS'
    WHEN p_last_error ILIKE '%child(ren) failed%' THEN 'CHILD_FAILED'
    ELSE 'OTHER'
  END;
$$;

COMMENT ON FUNCTION public.fn_normalize_job_error_code(text)
  IS 'SSOT-Normalisierung von job_queue.last_error → stabiler Fehlercode-Bucket. NULL/empty → PRE_HEARTBEAT_KILL.';

-- ============================================================================
-- Section 2: View v_failed_job_hotloops_24h (admin-internal)
-- ============================================================================
DROP VIEW IF EXISTS public.v_failed_job_hotloops_24h CASCADE;
CREATE VIEW public.v_failed_job_hotloops_24h AS
SELECT
  jq.package_id,
  jq.job_type,
  public.fn_normalize_job_error_code(jq.last_error) AS error_code,
  COUNT(*)::int AS fail_count,
  MAX(jq.updated_at) AS last_failed_at,
  MIN(jq.updated_at) AS first_failed_at,
  (ARRAY_AGG(jq.last_error ORDER BY jq.updated_at DESC))[1] AS last_error_text,
  EXISTS (
    SELECT 1 FROM public.package_job_quarantine pq
    WHERE pq.package_id = jq.package_id
      AND pq.job_type = jq.job_type
      AND pq.cleared_at IS NULL
      AND (pq.blocked_until IS NULL OR pq.blocked_until > now())
  ) AS quarantined
FROM public.job_queue jq
WHERE jq.status = 'failed'
  AND jq.updated_at > now() - interval '24 hours'
  AND jq.package_id IS NOT NULL
GROUP BY jq.package_id, jq.job_type, public.fn_normalize_job_error_code(jq.last_error)
HAVING COUNT(*) >= 5;

REVOKE ALL ON public.v_failed_job_hotloops_24h FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_failed_job_hotloops_24h TO service_role;

COMMENT ON VIEW public.v_failed_job_hotloops_24h
  IS 'Admin-internal. Zeigt (package_id, job_type, error_code) mit ≥5 Fehlern in 24h. Zugriff nur über admin_get_failed_job_hotloops_24h().';

-- ============================================================================
-- Section 3: Admin-Read RPC (gated)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_failed_job_hotloops_24h()
RETURNS TABLE (
  package_id uuid,
  package_title text,
  job_type text,
  error_code text,
  fail_count int,
  last_failed_at timestamptz,
  first_failed_at timestamptz,
  last_error_text text,
  quarantined boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;
  RETURN QUERY
    SELECT v.package_id,
           cp.title::text AS package_title,
           v.job_type,
           v.error_code,
           v.fail_count,
           v.last_failed_at,
           v.first_failed_at,
           v.last_error_text,
           v.quarantined
    FROM public.v_failed_job_hotloops_24h v
    LEFT JOIN public.course_packages cp ON cp.id = v.package_id
    ORDER BY v.fail_count DESC, v.last_failed_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_failed_job_hotloops_24h() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_failed_job_hotloops_24h() TO authenticated;

-- ============================================================================
-- Section 4: Quarantine-RPC für einzelnes (package, job_type)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_quarantine_job_hotloop(
  p_package_id uuid,
  p_job_type text,
  p_reason text DEFAULT 'admin_manual_quarantine'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cancelled int := 0;
  v_steps_skipped int := 0;
  v_quarantine_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;
  IF p_package_id IS NULL OR p_job_type IS NULL THEN
    RAISE EXCEPTION 'package_id and job_type required';
  END IF;

  PERFORM set_config('app.transition_source',
    'admin_ui:quarantine_hotloop:'||COALESCE(v_uid::text,'?'), true);

  -- 1. Quarantine-Eintrag (24h Default)
  INSERT INTO public.package_job_quarantine
    (package_id, job_type, failure_signature, identical_fail_count, reason, blocked_until, metadata)
  VALUES
    (p_package_id, p_job_type, 'admin:'||p_reason, 0, p_reason, now() + interval '24 hours',
     jsonb_build_object('source','admin_quarantine_job_hotloop','admin_uid', v_uid))
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_quarantine_id;

  -- 2. Cancel aktive Jobs
  WITH x AS (
    UPDATE public.job_queue jq
       SET status='cancelled',
           completed_at=COALESCE(jq.completed_at, now()),
           locked_at=NULL, locked_by=NULL,
           last_error=COALESCE(jq.last_error,'')||' | HOTLOOP_QUARANTINE:'||p_reason,
           updated_at=now()
     WHERE jq.package_id = p_package_id
       AND jq.job_type = p_job_type
       AND jq.status IN ('pending','queued','processing','running','batch_pending')
    RETURNING jq.id, jq.meta->>'step_key' AS step_key
  )
  SELECT count(*) INTO v_cancelled FROM x;

  -- 3. Steps skip
  WITH x AS (
    UPDATE public.package_steps ps
       SET status='skipped'::step_status,
           last_error='HOTLOOP_QUARANTINE_AUTODEFER',
           meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
             'auto_deferred', true,
             'defer_reason', 'HOTLOOP_QUARANTINE',
             'auto_deferred_at', now(),
             'auto_deferred_by', v_uid,
             'job_type', p_job_type,
             'reason', p_reason
           ),
           updated_at=now()
     WHERE ps.package_id = p_package_id
       AND ps.status NOT IN ('done','skipped')
       AND EXISTS (
         SELECT 1 FROM public.job_queue jq
         WHERE jq.package_id = p_package_id
           AND jq.job_type = p_job_type
           AND jq.meta->>'step_key' = ps.step_key
       )
    RETURNING ps.id
  )
  SELECT count(*) INTO v_steps_skipped FROM x;

  -- 4. Audit
  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES
    ('admin_quarantine_job_hotloop','hotloop_quarantine_set',
     p_package_id::text,'package','success',
     format('Quarantined %s for package (cancelled=%s, steps_skipped=%s)', p_job_type, v_cancelled, v_steps_skipped),
     jsonb_build_object(
       'package_id', p_package_id,
       'job_type', p_job_type,
       'reason', p_reason,
       'cancelled', v_cancelled,
       'steps_skipped', v_steps_skipped,
       'quarantine_id', v_quarantine_id
     ));

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'job_type', p_job_type,
    'cancelled', v_cancelled,
    'steps_skipped', v_steps_skipped,
    'quarantine_id', v_quarantine_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_quarantine_job_hotloop(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_quarantine_job_hotloop(uuid, text, text) TO authenticated;

-- ============================================================================
-- Section 5: Auto-Quarantine bei ≥20 Failures in 24h
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_auto_quarantine_failed_hotloops(
  p_threshold int DEFAULT 20,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_processed int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  r record;
  v_res jsonb;
BEGIN
  FOR r IN
    SELECT v.package_id, v.job_type, v.error_code, v.fail_count
    FROM public.v_failed_job_hotloops_24h v
    WHERE v.fail_count >= p_threshold
      AND v.quarantined = false
    ORDER BY v.fail_count DESC
    LIMIT 100
  LOOP
    IF p_dry_run THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id, 'job_type', r.job_type,
        'error_code', r.error_code, 'fail_count', r.fail_count, 'action','dry_run');
      CONTINUE;
    END IF;

    INSERT INTO public.package_job_quarantine
      (package_id, job_type, failure_signature, identical_fail_count, reason, blocked_until, metadata)
    VALUES
      (r.package_id, r.job_type, 'auto:'||r.error_code, r.fail_count,
       'AUTO_HOTLOOP_THRESHOLD_'||p_threshold, now() + interval '24 hours',
       jsonb_build_object('source','fn_auto_quarantine_failed_hotloops','error_code',r.error_code))
    ON CONFLICT DO NOTHING;

    -- Cancel aktive
    UPDATE public.job_queue jq
       SET status='cancelled',
           completed_at=COALESCE(jq.completed_at, now()),
           locked_at=NULL, locked_by=NULL,
           last_error=COALESCE(jq.last_error,'')||' | AUTO_HOTLOOP_QUARANTINE:'||r.error_code,
           updated_at=now()
     WHERE jq.package_id = r.package_id
       AND jq.job_type = r.job_type
       AND jq.status IN ('pending','queued','processing','running','batch_pending');

    INSERT INTO public.auto_heal_log
      (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES
      ('fn_auto_quarantine_failed_hotloops','hotloop_auto_quarantine',
       r.package_id::text,'package','success',
       format('Auto-quarantine %s (%s, %s fails)', r.job_type, r.error_code, r.fail_count),
       jsonb_build_object(
         'package_id', r.package_id, 'job_type', r.job_type,
         'error_code', r.error_code, 'fail_count', r.fail_count,
         'threshold', p_threshold));

    v_processed := v_processed + 1;
    v_results := v_results || jsonb_build_object(
      'package_id', r.package_id, 'job_type', r.job_type,
      'error_code', r.error_code, 'fail_count', r.fail_count, 'action','quarantined');
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed, 'skipped', v_skipped, 'results', v_results);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_auto_quarantine_failed_hotloops(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auto_quarantine_failed_hotloops(int, boolean) TO service_role;

-- ============================================================================
-- Section 6: Active-Job-Dedup für Tutor-Index
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_guard_active_job_dedup_tutor_index()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  IF NEW.job_type NOT IN ('package_validate_tutor_index','package_build_ai_tutor_index') THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('queued','pending','processing') THEN RETURN NEW; END IF;
  IF NEW.package_id IS NULL THEN RETURN NEW; END IF;

  -- Check tutor_index_quarantine flag
  IF EXISTS (
    SELECT 1 FROM public.course_packages cp
    WHERE cp.id = NEW.package_id
      AND COALESCE((cp.feature_flags->'tutor_index_quarantine'->>'active')::boolean, false) = true
      AND COALESCE((cp.feature_flags->'tutor_index_quarantine'->>'manual_bypass')::boolean, false) = false
  ) THEN
    INSERT INTO public.auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_active_job_dedup_tutor_index','tutor_index_quarantine_blocked',
            NEW.package_id::text,'package','skipped',
            format('Quarantined tutor-index — %s blocked', NEW.job_type),
            jsonb_build_object('package_id', NEW.package_id, 'job_type', NEW.job_type));
    IF TG_OP = 'INSERT' THEN RETURN NULL; ELSE NEW.status:='cancelled'; NEW.last_error:='TUTOR_INDEX_QUARANTINED'; RETURN NEW; END IF;
  END IF;

  -- Active dedup
  SELECT id INTO v_existing_id
  FROM public.job_queue
  WHERE package_id = NEW.package_id
    AND job_type = NEW.job_type
    AND status IN ('queued','pending','processing','running','batch_pending')
    AND (TG_OP='INSERT' OR id <> NEW.id)
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    INSERT INTO public.auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_active_job_dedup_tutor_index','tutor_index_active_dedup_blocked',
            NEW.package_id::text,'package','skipped',
            format('Duplicate %s blocked (existing=%s)', NEW.job_type, v_existing_id),
            jsonb_build_object('package_id', NEW.package_id,'job_type',NEW.job_type,'existing_job_id',v_existing_id));
    IF TG_OP = 'INSERT' THEN RETURN NULL; ELSE NEW.status:='cancelled'; NEW.last_error:='ACTIVE_JOB_DEDUP_TUTOR_INDEX'; RETURN NEW; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_active_job_dedup_tutor_index ON public.job_queue;
CREATE TRIGGER trg_guard_active_job_dedup_tutor_index
BEFORE INSERT OR UPDATE OF status, job_type ON public.job_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_active_job_dedup_tutor_index();

-- ============================================================================
-- Section 7: Bronze manual_bypass Auto-Expire nach erstem Fail oder 24h
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_bronze_manual_bypass_auto_expire()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bypass_at timestamptz;
BEGIN
  IF NEW.job_type <> 'package_run_integrity_check' THEN RETURN NEW; END IF;
  IF NEW.status <> 'failed' THEN RETURN NEW; END IF;
  IF OLD.status = 'failed' THEN RETURN NEW; END IF;
  IF NEW.package_id IS NULL THEN RETURN NEW; END IF;

  SELECT (cp.feature_flags->'bronze'->>'manual_bypass_at')::timestamptz INTO v_bypass_at
  FROM public.course_packages cp WHERE cp.id = NEW.package_id;

  IF v_bypass_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.created_at < v_bypass_at THEN RETURN NEW; END IF;

  -- erstes Fail nach manual_bypass: deaktiviere bypass → Bronze-Lock greift wieder
  UPDATE public.course_packages
     SET feature_flags = feature_flags
       || jsonb_build_object('bronze',
            (feature_flags->'bronze')
              - 'manual_bypass'
              || jsonb_build_object(
                   'manual_bypass_expired_at', now(),
                   'manual_bypass_expired_by', 'integrity_check_failed_after_bypass',
                   'last_post_bypass_fail_job', NEW.id
                 ))
   WHERE id = NEW.package_id;

  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES
    ('fn_bronze_manual_bypass_auto_expire','bronze_bypass_auto_expired',
     NEW.package_id::text,'package','success',
     'manual_bypass deactivated after first failed integrity_check post-bypass',
     jsonb_build_object('package_id', NEW.package_id,'job_id', NEW.id,'bypass_was_at', v_bypass_at));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bronze_manual_bypass_auto_expire ON public.job_queue;
CREATE TRIGGER trg_bronze_manual_bypass_auto_expire
AFTER UPDATE OF status ON public.job_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_bronze_manual_bypass_auto_expire();

-- ============================================================================
-- Section 8: Smoke
-- ============================================================================
DO $$
DECLARE
  v_view_count int;
  v_func_exists boolean;
BEGIN
  SELECT count(*) INTO v_view_count FROM public.v_failed_job_hotloops_24h;
  RAISE NOTICE 'v_failed_job_hotloops_24h rows: %', v_view_count;

  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='admin_quarantine_job_hotloop') INTO v_func_exists;
  IF NOT v_func_exists THEN RAISE EXCEPTION 'admin_quarantine_job_hotloop missing'; END IF;
END$$;
