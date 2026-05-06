-- =========================================================
-- 1) Config-Tabelle
-- =========================================================
CREATE TABLE IF NOT EXISTS public.lxi_block_thresholds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track           text NOT NULL DEFAULT '*',
  gate            text NOT NULL DEFAULT '*',
  window_hours    int  NOT NULL DEFAULT 24 CHECK (window_hours > 0),
  warning_count   int  NOT NULL DEFAULT 1 CHECK (warning_count >= 0),
  critical_count  int  NOT NULL DEFAULT 20 CHECK (critical_count >= warning_count),
  active          boolean NOT NULL DEFAULT true,
  notes           text,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track, gate)
);

ALTER TABLE public.lxi_block_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lxi_block_thresholds_admin_select ON public.lxi_block_thresholds;
CREATE POLICY lxi_block_thresholds_admin_select ON public.lxi_block_thresholds
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS lxi_block_thresholds_admin_write ON public.lxi_block_thresholds;
CREATE POLICY lxi_block_thresholds_admin_write ON public.lxi_block_thresholds
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.fn_lxi_block_thresholds_set_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lxi_block_thresholds_updated ON public.lxi_block_thresholds;
CREATE TRIGGER trg_lxi_block_thresholds_updated
  BEFORE UPDATE ON public.lxi_block_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.fn_lxi_block_thresholds_set_updated();

-- Seed
INSERT INTO public.lxi_block_thresholds (track, gate, window_hours, warning_count, critical_count, notes) VALUES
  ('*','*', 24, 1, 20, 'Global default'),
  ('*','gate_no_lessons', 24, 1, 10, 'Strenger: Lessons-Lücken sind hochkritisch'),
  ('*','gate_no_minichecks_effective', 24, 3, 25, NULL),
  ('*','gate_no_oral_effective', 24, 1, 15, 'Nur AUSBILDUNG_VOLL betroffen'),
  ('*','gate_no_tutor_context_effective', 24, 5, 40, NULL)
ON CONFLICT (track, gate) DO NOTHING;

-- =========================================================
-- 2) Helper: severity lookup
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_lxi_severity(p_track text, p_gate text, p_count int)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_warn int;
  v_crit int;
BEGIN
  -- Most specific match wins: (track,gate) > (*,gate) > (track,*) > (*,*)
  SELECT warning_count, critical_count INTO v_warn, v_crit
  FROM public.lxi_block_thresholds
  WHERE active = true
    AND ((track = p_track AND gate = p_gate)
      OR (track = '*'     AND gate = p_gate)
      OR (track = p_track AND gate = '*')
      OR (track = '*'     AND gate = '*'))
  ORDER BY CASE
    WHEN track = p_track AND gate = p_gate THEN 1
    WHEN track = '*'     AND gate = p_gate THEN 2
    WHEN track = p_track AND gate = '*'    THEN 3
    ELSE 4 END
  LIMIT 1;

  v_warn := COALESCE(v_warn, 1);
  v_crit := COALESCE(v_crit, 20);

  IF p_count >= v_crit THEN RETURN 'critical'; END IF;
  IF p_count >= v_warn THEN RETURN 'warning'; END IF;
  RETURN 'ok';
END $$;

-- =========================================================
-- 3) Erweiterte Summary mit severity_per_cluster
-- =========================================================
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
  v_severity_clusters jsonb;
  v_global_severity text := 'ok';
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

  -- Severity per (track,gate) cluster, evaluated against thresholds
  WITH expanded AS (
    SELECT COALESCE(metadata->>'track','UNKNOWN') AS track,
           jsonb_array_elements_text(COALESCE(metadata->'violations','[]'::jsonb)) AS gate
    FROM public.auto_heal_log
    WHERE action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
      AND created_at >= v_since
  ),
  agg AS (
    SELECT track, gate, count(*) AS n FROM expanded GROUP BY 1,2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'track', track, 'gate', gate, 'count', n,
           'severity', public.fn_lxi_severity(track, gate, n::int)
         ) ORDER BY n DESC), '[]'::jsonb)
  INTO v_severity_clusters
  FROM agg;

  -- Global severity = max of cluster severities
  SELECT CASE
    WHEN bool_or((c->>'severity') = 'critical') THEN 'critical'
    WHEN bool_or((c->>'severity') = 'warning')  THEN 'warning'
    ELSE 'ok' END
  INTO v_global_severity
  FROM jsonb_array_elements(v_severity_clusters) c;

  RETURN jsonb_build_object(
    'window_hours', p_hours,
    'total_blocks', v_total,
    'by_track', v_by_track,
    'by_gate', v_by_gate,
    'top_clusters', v_top_cluster,
    'trend_hourly', v_trend,
    'severity_per_cluster', COALESCE(v_severity_clusters, '[]'::jsonb),
    'global_severity', COALESCE(v_global_severity, 'ok'),
    'generated_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_lxi_publish_block_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lxi_publish_block_summary(int) TO authenticated;

-- =========================================================
-- 4) Heal-Aktion pro Cluster
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_heal_lxi_block_cluster(
  p_track text,
  p_gate  text,
  p_hours int DEFAULT 24,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg uuid;
  v_dispatched int := 0;
  v_skipped    int := 0;
  v_results    jsonb := '[]'::jsonb;
  v_one        jsonb;
  v_since      timestamptz := now() - make_interval(hours => p_hours);
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_gate NOT IN (
    'gate_no_lessons',
    'gate_no_minichecks_effective',
    'gate_no_oral_effective',
    'gate_no_tutor_context_effective'
  ) THEN
    RAISE EXCEPTION 'unsupported_gate: %', p_gate USING ERRCODE = '22023';
  END IF;

  FOR v_pkg IN
    SELECT DISTINCT target_id
    FROM public.auto_heal_log
    WHERE action_type IN ('lxi_publish_blocked','lxi_publish_blocked_effective')
      AND created_at >= v_since
      AND COALESCE(metadata->>'track','UNKNOWN') = p_track
      AND metadata->'violations' ? p_gate
      AND target_id IS NOT NULL
    ORDER BY target_id
    LIMIT p_limit
  LOOP
    BEGIN
      IF p_gate = 'gate_no_lessons' THEN
        -- Use existing dispatcher (per-package mode)
        v_one := public.admin_dispatch_lxi_no_lessons_repair(v_pkg);
      ELSE
        -- Generic nudge — atomic trigger picks up the next missing step
        v_one := public.admin_nudge_atomic_trigger(v_pkg, false);
      END IF;
      v_dispatched := v_dispatched + 1;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('lxi_cluster_heal_dispatched','package',v_pkg,'success',
              jsonb_build_object('track',p_track,'gate',p_gate,'result',v_one,'triggered_by',v_uid));
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('lxi_cluster_heal_dispatched','package',v_pkg,'skipped',
              jsonb_build_object('track',p_track,'gate',p_gate,'error',SQLERRM,'triggered_by',v_uid));
    END;

    v_results := v_results || jsonb_build_object('package_id', v_pkg);
  END LOOP;

  RETURN jsonb_build_object(
    'track', p_track,
    'gate',  p_gate,
    'window_hours', p_hours,
    'dispatched', v_dispatched,
    'skipped',    v_skipped,
    'packages',   v_results
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_heal_lxi_block_cluster(text,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_lxi_block_cluster(text,text,int,int) TO authenticated;