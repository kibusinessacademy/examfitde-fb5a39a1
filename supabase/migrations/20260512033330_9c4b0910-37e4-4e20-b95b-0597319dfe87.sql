
-- =========================================================
-- 1) Bronze-Quarantine Auto-Release
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_auto_release_bronze_quarantine(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE(
  package_id uuid,
  released boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_quar_set_at timestamptz;
  v_completed bigint;
  v_active bigint;
  v_stale_since bigint;
  v_release boolean;
  v_reason text;
BEGIN
  FOR r IN
    SELECT cp.id,
           cp.feature_flags->'bronze_quarantine' AS bq
    FROM course_packages cp
    WHERE (cp.feature_flags->'bronze_quarantine'->>'active')::boolean = true
  LOOP
    v_quar_set_at := COALESCE(
      NULLIF(r.bq->>'since',''),
      NULLIF(r.bq->>'quarantine_set_at','')
    )::timestamptz;

    IF v_quar_set_at IS NULL THEN
      v_quar_set_at := now() - interval '24 hours';
    END IF;

    SELECT count(*) INTO v_stale_since
    FROM job_queue jq
    WHERE jq.package_id = r.id
      AND jq.status = 'failed'
      AND jq.last_error LIKE '%STALE_REAP_LOOP_TERMINAL%'
      AND jq.updated_at > v_quar_set_at;

    SELECT count(*) INTO v_completed
    FROM job_queue jq
    WHERE jq.package_id = r.id
      AND jq.status = 'completed'
      AND jq.completed_at > v_quar_set_at;

    SELECT count(*) INTO v_active
    FROM job_queue jq
    WHERE jq.package_id = r.id
      AND jq.status IN ('pending','processing');

    v_release := (v_stale_since = 0) AND (v_completed >= 1 OR v_active > 0);

    IF v_release THEN
      v_reason := format(
        'auto_release: completed=%s active=%s stale_since=0',
        v_completed, v_active
      );

      IF NOT p_dry_run THEN
        UPDATE course_packages
        SET feature_flags = jsonb_set(
          feature_flags,
          '{bronze_quarantine}',
          (COALESCE(feature_flags->'bronze_quarantine','{}'::jsonb)
            || jsonb_build_object(
              'active', false,
              'released_at', now(),
              'release_reason', v_reason,
              'release_mode', 'auto'
            ))
        )
        WHERE id = r.id;

        INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
        VALUES (
          'bronze_quarantine_auto_released',
          'package',
          r.id,
          'success',
          jsonb_build_object(
            'completed_jobs_since_quarantine', v_completed,
            'active_jobs_now', v_active,
            'stale_reap_since_quarantine', v_stale_since,
            'quarantine_set_at', v_quar_set_at,
            'previous_quarantine', r.bq
          )
        );
      END IF;
    ELSE
      v_reason := format(
        'kept: completed=%s active=%s stale_since=%s',
        v_completed, v_active, v_stale_since
      );
    END IF;

    package_id := r.id;
    released := v_release;
    reason := v_reason;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_release_bronze_quarantine(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_release_bronze_quarantine(boolean) TO service_role;

-- Admin wrapper for cockpit dry-run inspection
CREATE OR REPLACE FUNCTION public.admin_preview_bronze_quarantine_auto_release()
RETURNS TABLE(package_id uuid, released boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.fn_auto_release_bronze_quarantine(true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_preview_bronze_quarantine_auto_release() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_bronze_quarantine_auto_release() TO authenticated;

-- =========================================================
-- 2) Continuation-Failure Health (since last heal)
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_get_continuation_failure_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last_heal timestamptz;
  v_new_failures int;
  v_total_24h int;
  v_packages_new int;
  v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT max(created_at) INTO v_last_heal
  FROM auto_heal_log
  WHERE action_type = 'manual_bypass_continuation_enqueue_failed';

  IF v_last_heal IS NULL THEN
    v_last_heal := now() - interval '24 hours';
  END IF;

  SELECT
    count(*) FILTER (WHERE jq.completed_at > v_last_heal),
    count(*) FILTER (WHERE jq.completed_at > now() - interval '24 hours'),
    count(DISTINCT jq.package_id) FILTER (WHERE jq.completed_at > v_last_heal)
  INTO v_new_failures, v_total_24h, v_packages_new
  FROM job_queue jq
  WHERE jq.status = 'completed'
    AND ((jq.result -> 'continuation') ->> 'reason') = 'CONTINUATION_ENQUEUE_FAILED';

  v_status := CASE
    WHEN v_new_failures = 0 THEN 'green'
    WHEN v_new_failures < 5 THEN 'yellow'
    ELSE 'red'
  END;

  RETURN jsonb_build_object(
    'status', v_status,
    'last_manual_bypass_at', v_last_heal,
    'new_continuation_failures_since_last_heal', v_new_failures,
    'new_packages_since_last_heal', v_packages_new,
    'total_failures_24h', v_total_24h
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_continuation_failure_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_continuation_failure_health() TO authenticated;

-- =========================================================
-- 3) Combined 24h Heal-Report
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_get_heal_report_24h()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bypass_bronze int;
  v_bypass_cef int;
  v_auto_released int;
  v_quar_remaining int;
  v_quar_with_progress int;
  v_cef_health jsonb;
  v_new_stale int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO v_bypass_bronze
  FROM auto_heal_log
  WHERE action_type IN ('manual_bypass_stale_reap_heal','manual_bypass_bronze_loop')
    AND created_at > now() - interval '24 hours';

  SELECT count(*) INTO v_bypass_cef
  FROM auto_heal_log
  WHERE action_type = 'manual_bypass_continuation_enqueue_failed'
    AND created_at > now() - interval '24 hours';

  SELECT count(*) INTO v_auto_released
  FROM auto_heal_log
  WHERE action_type = 'bronze_quarantine_auto_released'
    AND created_at > now() - interval '24 hours';

  SELECT count(*) INTO v_quar_remaining
  FROM course_packages
  WHERE (feature_flags->'bronze_quarantine'->>'active')::boolean = true;

  SELECT count(*) INTO v_quar_with_progress
  FROM course_packages cp
  WHERE (cp.feature_flags->'bronze_quarantine'->>'active')::boolean = true
    AND EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.status IN ('pending','processing','completed')
        AND jq.updated_at > COALESCE(
          NULLIF(cp.feature_flags->'bronze_quarantine'->>'since','')::timestamptz,
          now() - interval '24 hours'
        )
    );

  SELECT count(*) INTO v_new_stale
  FROM job_queue
  WHERE status = 'failed'
    AND last_error LIKE '%STALE_REAP_LOOP_TERMINAL%'
    AND updated_at > now() - interval '24 hours';

  v_cef_health := public.admin_get_continuation_failure_health();

  RETURN jsonb_build_object(
    'generated_at', now(),
    'window', '24h',
    'bronze_quarantine', jsonb_build_object(
      'cause', 'STALE_REAP_LOOP_TERMINAL on tail jobs (council/auto_publish)',
      'manual_bypasses_24h', v_bypass_bronze,
      'auto_released_24h', v_auto_released,
      'remaining_active', v_quar_remaining,
      'remaining_with_progress', v_quar_with_progress,
      'new_stale_reap_failures_24h', v_new_stale,
      'safety_check', CASE WHEN v_new_stale = 0 THEN 'green: no new stale-reap loops' ELSE 'yellow: new stale-reap loops detected' END
    ),
    'continuation_failures', jsonb_build_object(
      'cause', 'UNIQUE-violation uq_job_queue_active_package_job on continuation enqueue',
      'manual_bypasses_24h', v_bypass_cef,
      'health', v_cef_health,
      'safety_check', CASE WHEN (v_cef_health->>'new_continuation_failures_since_last_heal')::int = 0
                            THEN 'green: no new failures since last heal'
                            ELSE 'yellow/red: new failures detected — see health' END
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_heal_report_24h() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_report_24h() TO authenticated;
