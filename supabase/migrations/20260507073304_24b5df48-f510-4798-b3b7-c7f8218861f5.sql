
-- ============================================================
-- Permanent Fix: Bronze-Loop Auto-Bypass + Heal-Skip Alerts
-- ============================================================

-- 1) Detection + Auto-Bypass für Bronze-Loop-Pattern
CREATE OR REPLACE FUNCTION public.fn_auto_bypass_bronze_loops(
  p_skip_threshold int DEFAULT 50,
  p_stale_hours    int DEFAULT 12,
  p_alert_threshold int DEFAULT 100
)
RETURNS TABLE(package_id uuid, reason text, skip_count int, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r record;
  _skips int;
BEGIN
  -- Pattern A: Bronze-locked Pakete mit vielen heal-skip-Events in 24h
  -- Pattern B: Bronze-locked Pakete >stale_hours in building/queued ohne Tail-Progress
  FOR _r IN
    SELECT cp.id, cp.title, cp.status, cp.feature_flags->'bronze' AS bronze
    FROM course_packages cp
    WHERE cp.status IN ('building','queued')
      AND cp.feature_flags ? 'bronze'
      AND COALESCE(cp.feature_flags->'bronze'->>'manual_bypass','false') <> 'true'
      AND (cp.feature_flags->'bronze'->>'locked'='true'
           OR cp.feature_flags->'bronze'->>'requires_review'='true')
  LOOP
    -- Count heal-skips in 24h
    SELECT COUNT(*) INTO _skips
    FROM auto_heal_log
    WHERE target_id = _r.id
      AND created_at > now() - interval '24 hours'
      AND (action_type ILIKE '%bronze_locked_enqueue_blocked%'
           OR action_type = 'pipeline_step_drift_v3_heal_skipped'
           OR (action_type LIKE 'pipeline_step_drift_v3_heal' AND result_status='skipped'));

    IF _skips >= p_skip_threshold OR EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = _r.id
        AND ps.step_key IN ('quality_council','run_integrity_check','validate_exam_pool','auto_publish')
        AND ps.status::text IN ('pending_enqueue','queued')
        AND ps.updated_at < now() - (p_stale_hours || ' hours')::interval
    ) THEN
      UPDATE course_packages
        SET feature_flags = jsonb_set(
              jsonb_set(
                COALESCE(feature_flags,'{}'::jsonb),
                '{bronze,manual_bypass}', 'true'::jsonb, true),
              '{bronze,manual_bypass_at}', to_jsonb(now()::text), true)
      WHERE id = _r.id;

      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, metadata)
      VALUES (
        'cron:auto-bypass-bronze-loops',
        'auto_bypass_bronze_loop',
        _r.id, 'package', 'success',
        jsonb_build_object(
          'skip_count', _skips,
          'reason', CASE WHEN _skips >= p_skip_threshold THEN 'skip_threshold_exceeded' ELSE 'stale_tail_step' END,
          'severity', CASE WHEN _skips >= p_alert_threshold THEN 'P0' ELSE 'P1' END
        )
      );

      RETURN QUERY SELECT _r.id,
        CASE WHEN _skips >= p_skip_threshold THEN 'skip_threshold_exceeded' ELSE 'stale_tail_step' END,
        _skips,
        'bypass_applied'::text;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_bypass_bronze_loops(int,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_bypass_bronze_loops(int,int,int) TO service_role;

-- 2) Heal-Skip Notifier: schreibt P0-Alert wenn Paket >alert_threshold skips/24h
CREATE OR REPLACE FUNCTION public.fn_alert_persistent_heal_skips(
  p_alert_threshold int DEFAULT 100
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _count int := 0; _r record;
BEGIN
  FOR _r IN
    SELECT target_id, COUNT(*) AS skips
    FROM auto_heal_log
    WHERE created_at > now() - interval '24 hours'
      AND (action_type = 'pipeline_step_drift_v3_heal_skipped'
           OR (action_type = 'pipeline_step_drift_v3_heal' AND result_status='skipped')
           OR action_type ILIKE '%bronze_locked_enqueue_blocked%')
      AND target_id IS NOT NULL
    GROUP BY target_id
    HAVING COUNT(*) >= p_alert_threshold
  LOOP
    -- Avoid duplicate alerts within 6h
    IF NOT EXISTS (
      SELECT 1 FROM auto_heal_log
      WHERE target_id = _r.target_id
        AND action_type = 'persistent_heal_skip_alert'
        AND created_at > now() - interval '6 hours'
    ) THEN
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, metadata)
      VALUES (
        'cron:heal-skip-alerter',
        'persistent_heal_skip_alert',
        _r.target_id, 'package', 'alert',
        jsonb_build_object(
          'severity','P0',
          'skip_count_24h', _r.skips,
          'message','Heal-Aktionen werden seit >24h kontinuierlich übersprungen — manuelle Untersuchung erforderlich'
        )
      );
      _count := _count + 1;
    END IF;
  END LOOP;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_alert_persistent_heal_skips(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alert_persistent_heal_skips(int) TO service_role;
