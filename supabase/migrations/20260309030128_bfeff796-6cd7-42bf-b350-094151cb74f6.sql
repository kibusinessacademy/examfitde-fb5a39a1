
-- 4. Step Funnel / Blocked Steps View
CREATE OR REPLACE VIEW public.v_pipeline_step_funnel AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.priority,
  ps.step_key,
  ps.status,
  ps.updated_at AS step_updated_at,
  ps.last_error
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id
WHERE cp.status = 'building'
  AND ps.status IN ('failed', 'running', 'queued', 'blocked')
ORDER BY cp.priority ASC, ps.updated_at ASC;

-- Pipeline Health Score Function (0-100)
CREATE OR REPLACE FUNCTION public.pipeline_health_score()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_score int := 25;
  v_stuck_score int := 25;
  v_content_score int := 20;
  v_step_score int := 15;
  v_error_score int := 15;
  v_total int;
  v_p90_max numeric;
  v_stuck_count int;
  v_top_real_pct numeric;
  v_blocked_steps int;
  v_permanent_errors int;
  v_transient_errors int;
  v_total_errors int;
BEGIN
  SELECT coalesce(max(p90_wait_seconds), 0) INTO v_p90_max
  FROM v_pipeline_queue_latency;
  IF v_p90_max > 600 THEN v_queue_score := 5;
  ELSIF v_p90_max > 300 THEN v_queue_score := 12;
  ELSIF v_p90_max > 120 THEN v_queue_score := 18;
  ELSIF v_p90_max > 60 THEN v_queue_score := 22;
  END IF;

  SELECT coalesce(sum(stuck_jobs), 0) INTO v_stuck_count
  FROM v_pipeline_stuck_processing;
  IF v_stuck_count > 5 THEN v_stuck_score := 0;
  ELSIF v_stuck_count > 2 THEN v_stuck_score := 10;
  ELSIF v_stuck_count > 0 THEN v_stuck_score := 18;
  END IF;

  SELECT coalesce(avg(real_pct), 100) INTO v_top_real_pct
  FROM v_pipeline_content_integrity
  WHERE priority <= 4 AND status = 'building';
  v_content_score := least(20, round(v_top_real_pct * 0.2)::int);

  SELECT count(*) INTO v_blocked_steps
  FROM v_pipeline_step_funnel
  WHERE status = 'failed';
  IF v_blocked_steps > 10 THEN v_step_score := 3;
  ELSIF v_blocked_steps > 5 THEN v_step_score := 8;
  ELSIF v_blocked_steps > 0 THEN v_step_score := 12;
  END IF;

  SELECT
    coalesce(sum(failed_cnt) FILTER (WHERE error_class IN ('permission', 'schema', 'data_shape')), 0),
    coalesce(sum(failed_cnt) FILTER (WHERE error_class NOT IN ('permission', 'schema', 'data_shape')), 0),
    coalesce(sum(failed_cnt), 0)
  INTO v_permanent_errors, v_transient_errors, v_total_errors
  FROM v_pipeline_error_class;
  IF v_permanent_errors > 5 THEN v_error_score := 2;
  ELSIF v_permanent_errors > 2 THEN v_error_score := 7;
  ELSIF v_permanent_errors > 0 THEN v_error_score := 11;
  END IF;

  v_total := v_queue_score + v_stuck_score + v_content_score + v_step_score + v_error_score;

  RETURN jsonb_build_object(
    'total_score', v_total,
    'traffic_light', CASE
      WHEN v_total >= 85 THEN 'green'
      WHEN v_total >= 60 THEN 'yellow'
      ELSE 'red'
    END,
    'breakdown', jsonb_build_object(
      'queue_latency', jsonb_build_object('score', v_queue_score, 'max', 25, 'p90_max_seconds', v_p90_max),
      'stuck_processing', jsonb_build_object('score', v_stuck_score, 'max', 25, 'stuck_count', v_stuck_count),
      'content_integrity', jsonb_build_object('score', v_content_score, 'max', 20, 'top_real_pct', v_top_real_pct),
      'step_progression', jsonb_build_object('score', v_step_score, 'max', 15, 'failed_steps', v_blocked_steps),
      'error_mix', jsonb_build_object('score', v_error_score, 'max', 15, 'permanent', v_permanent_errors, 'transient', v_transient_errors)
    ),
    'computed_at', now()
  );
END;
$$;
