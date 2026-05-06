-- =========================================================
-- Phase-2 Hard-Block matrix-aware (Effective Gates)
-- =========================================================

CREATE OR REPLACE FUNCTION public.fn_guard_publish_lxi_no_lessons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
  v_violations text[] := ARRAY[]::text[];
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'published'
     AND NEW.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- Read all effective gates from track-aware audit view
  SELECT
    COALESCE(a.gate_no_lessons, false) AS g_lessons,
    COALESCE(b.gate_no_minichecks_effective, false) AS g_minichecks,
    COALESCE(b.gate_no_oral_effective, false) AS g_oral,
    COALESCE(b.gate_no_tutor_context_effective, false) AS g_tutor,
    COALESCE(b.track, 'UNKNOWN') AS track
  INTO v_row
  FROM public.course_packages cp
  LEFT JOIN public.v_learning_integrity_audit a ON a.package_id = cp.id
  LEFT JOIN public.v_learning_gate_track_aware b ON b.package_id = cp.id
  WHERE cp.id = NEW.id;

  IF v_row.g_lessons        THEN v_violations := array_append(v_violations, 'gate_no_lessons'); END IF;
  IF v_row.g_minichecks     THEN v_violations := array_append(v_violations, 'gate_no_minichecks_effective'); END IF;
  IF v_row.g_oral           THEN v_violations := array_append(v_violations, 'gate_no_oral_effective'); END IF;
  IF v_row.g_tutor          THEN v_violations := array_append(v_violations, 'gate_no_tutor_context_effective'); END IF;

  IF array_length(v_violations, 1) > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'lxi_publish_blocked_effective',
      'package',
      NEW.id,
      'blocked',
      jsonb_build_object(
        'track', v_row.track,
        'violations', to_jsonb(v_violations),
        'attempted_status', NEW.status,
        'previous_status', COALESCE(OLD.status, NULL)
      )
    );
    RAISE EXCEPTION 'LXI_PUBLISH_BLOCKED: track=% violations=%', v_row.track, v_violations
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- =========================================================
-- Monitoring View + RPCs
-- =========================================================

CREATE OR REPLACE VIEW public.v_lxi_publish_block_monitor AS
SELECT
  date_trunc('hour', created_at) AS hour_bucket,
  COALESCE(metadata->>'track','UNKNOWN') AS track,
  jsonb_array_elements_text(COALESCE(metadata->'violations','[]'::jsonb)) AS gate,
  count(*) AS block_count
FROM public.auto_heal_log
WHERE action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
  AND created_at >= now() - interval '7 days'
GROUP BY 1,2,3;

REVOKE ALL ON public.v_lxi_publish_block_monitor FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_lxi_publish_block_monitor TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_lxi_publish_block_summary(p_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total int;
  v_by_track jsonb;
  v_by_gate jsonb;
  v_top_cluster jsonb;
  v_trend jsonb;
  v_since timestamptz := now() - make_interval(hours => p_hours);
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.auto_heal_log
  WHERE action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
    AND created_at >= v_since;

  SELECT COALESCE(jsonb_object_agg(track, n), '{}'::jsonb) INTO v_by_track
  FROM (
    SELECT COALESCE(metadata->>'track','UNKNOWN') AS track, count(*) AS n
    FROM public.auto_heal_log
    WHERE action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
      AND created_at >= v_since
    GROUP BY 1
  ) s;

  SELECT COALESCE(jsonb_object_agg(gate, n), '{}'::jsonb) INTO v_by_gate
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(metadata->'violations','[]'::jsonb)) AS gate, count(*) AS n
    FROM public.auto_heal_log
    WHERE action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
      AND created_at >= v_since
    GROUP BY 1
  ) s;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_cluster
  FROM (
    SELECT target_id AS package_id,
           COALESCE(metadata->>'track','UNKNOWN') AS track,
           count(*) AS attempts,
           max(created_at) AS last_attempt
    FROM public.auto_heal_log
    WHERE action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
      AND created_at >= v_since
    GROUP BY 1,2
    ORDER BY attempts DESC, last_attempt DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY hour_bucket), '[]'::jsonb) INTO v_trend
  FROM (
    SELECT date_trunc('hour', created_at) AS hour_bucket, count(*) AS blocks
    FROM public.auto_heal_log
    WHERE action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
      AND created_at >= v_since
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'window_hours', p_hours,
    'total_blocks', v_total,
    'by_track', v_by_track,
    'by_gate', v_by_gate,
    'top_clusters', v_top_cluster,
    'trend_hourly', v_trend,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lxi_publish_block_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lxi_publish_block_summary(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_lxi_publish_block_events(p_hours int DEFAULT 24, p_limit int DEFAULT 200)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  package_id uuid,
  track text,
  violations jsonb,
  attempted_status text,
  previous_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.id,
         l.created_at,
         l.target_id AS package_id,
         COALESCE(l.metadata->>'track','UNKNOWN') AS track,
         COALESCE(l.metadata->'violations','[]'::jsonb) AS violations,
         l.metadata->>'attempted_status' AS attempted_status,
         l.metadata->>'previous_status' AS previous_status
  FROM public.auto_heal_log l
  WHERE l.action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
    AND l.created_at >= now() - make_interval(hours => p_hours)
  ORDER BY l.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lxi_publish_block_events(int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lxi_publish_block_events(int,int) TO authenticated;

-- Audit
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'lxi_phase2_effective_hard_block_enabled',
  'system',
  'success',
  jsonb_build_object(
    'gates', jsonb_build_array('gate_no_lessons','gate_no_minichecks_effective','gate_no_oral_effective','gate_no_tutor_context_effective'),
    'safety_check', jsonb_build_object(
      'published_minicheck_violations', 0,
      'published_oral_violations', 0,
      'published_tutor_context_violations', 0
    ),
    'enabled_at', now()
  )
);