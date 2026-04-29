
-- =========================================================================
-- Quality-Council Drift-Reparatur
-- =========================================================================
-- Adressiert chirurgisch nur:
--   • A_building: package status='building' + qc step='queued' + KEIN qc-job
--   • D:          last qc-job 'completed' + qc step still 'queued' (status drift)
--
-- NICHT adressiert (bewusst):
--   • A_queued: 305 Pakete mit pkg_status='queued' → admin_bulk_promote_queued_to_building
--   • B_active: 19 Pakete mit aktivem QC-Job läuft → Worker-Throughput
--   • C_failed: bereits durch admin_retry_failed_step abgedeckt
-- =========================================================================

-- 1) Diagnose-View: alle Cluster auf einen Blick
CREATE OR REPLACE VIEW public.v_admin_qc_step_drift AS
WITH base AS (
  SELECT
    ps.package_id,
    cp.title,
    cp.status AS pkg_status,
    ps.updated_at AS step_updated_at,
    EXTRACT(EPOCH FROM (now() - ps.updated_at))::int AS step_age_sec,
    COUNT(j.id) FILTER (WHERE j.job_type='package_quality_council') AS qc_total,
    COUNT(j.id) FILTER (WHERE j.job_type='package_quality_council' AND j.status IN ('pending','queued','processing')) AS qc_active,
    COUNT(j.id) FILTER (WHERE j.job_type='package_quality_council' AND j.status='failed') AS qc_failed,
    COUNT(j.id) FILTER (WHERE j.job_type='package_quality_council' AND j.status='cancelled') AS qc_cancelled,
    COUNT(j.id) FILTER (WHERE j.job_type='package_quality_council' AND j.status='completed') AS qc_completed
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  LEFT JOIN public.job_queue j ON j.package_id = ps.package_id
  WHERE ps.step_key = 'quality_council' AND ps.status = 'queued'
  GROUP BY ps.package_id, cp.title, cp.status, ps.updated_at
)
SELECT
  package_id, title, pkg_status, step_updated_at, step_age_sec,
  qc_total, qc_active, qc_failed, qc_cancelled, qc_completed,
  CASE
    WHEN qc_active   > 0                         THEN 'B_active_qc_job'
    WHEN qc_completed > 0                        THEN 'D_qc_completed_step_drift'
    WHEN qc_failed   > 0 AND qc_total = qc_failed + qc_cancelled THEN 'C_failed_qc_only'
    WHEN qc_total    = 0 AND pkg_status = 'building' THEN 'A_building_no_qc_job'
    WHEN qc_total    = 0 AND pkg_status = 'queued'   THEN 'A_queued_no_qc_job'
    WHEN qc_total    = 0                         THEN 'A_other_no_qc_job'
    ELSE 'E_mixed'
  END AS cluster,
  CASE
    WHEN qc_active > 0 THEN false
    WHEN qc_completed > 0 AND pkg_status IN ('building','queued') THEN true   -- Cluster D heilbar
    WHEN qc_total = 0 AND pkg_status = 'building' THEN true                   -- Cluster A_building heilbar
    ELSE false
  END AS heal_eligible
FROM base;

GRANT SELECT ON public.v_admin_qc_step_drift TO authenticated;

-- 2) Cluster-Summary für Dashboard
CREATE OR REPLACE FUNCTION public.admin_get_qc_step_drift_summary()
RETURNS TABLE(cluster text, pkgs bigint, heal_eligible_cnt bigint, oldest_step_age_sec int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT cluster,
         COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE heal_eligible)::bigint,
         MAX(step_age_sec)
  FROM public.v_admin_qc_step_drift
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY cluster
  ORDER BY COUNT(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_qc_step_drift_summary() TO authenticated;

-- 3) Detail-Liste pro Cluster (für Drilldown)
CREATE OR REPLACE FUNCTION public.admin_get_qc_step_drift_detail(p_cluster text DEFAULT NULL, p_limit int DEFAULT 100)
RETURNS SETOF public.v_admin_qc_step_drift
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.v_admin_qc_step_drift
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (p_cluster IS NULL OR cluster = p_cluster)
  ORDER BY step_age_sec DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_qc_step_drift_detail(text, int) TO authenticated;

-- 4) Repair-RPC: chirurgisch A_building enqueuen + D step→done
DROP FUNCTION IF EXISTS public.admin_repair_quality_council_drift(boolean, int);

CREATE OR REPLACE FUNCTION public.admin_repair_quality_council_drift(
  p_dry_run boolean DEFAULT true,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  package_id uuid,
  title text,
  cluster text,
  action text,
  detail text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_curriculum_id uuid;
  v_new_job_id uuid;
  v_acted int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  FOR r IN
    SELECT v.package_id, v.title, v.cluster, v.pkg_status, v.qc_completed
    FROM public.v_admin_qc_step_drift v
    WHERE v.heal_eligible = true
    ORDER BY v.step_age_sec DESC
    LIMIT GREATEST(p_limit, 1)
  LOOP
    IF r.cluster = 'D_qc_completed_step_drift' THEN
      IF p_dry_run THEN
        RETURN QUERY SELECT r.package_id, r.title, r.cluster, 'dry_run_step_set_done'::text,
          ('letzter QC completed → setze step.status=done')::text;
      ELSE
        UPDATE public.package_steps
        SET status = 'done',
            updated_at = now(),
            meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'admin_repaired_at', now(),
              'admin_repair_source', 'admin_repair_quality_council_drift',
              'admin_repair_reason', 'qc_completed_step_drift'
            )
        WHERE package_id = r.package_id AND step_key = 'quality_council';
        v_acted := v_acted + 1;
        RETURN QUERY SELECT r.package_id, r.title, r.cluster, 'step_set_done'::text,
          'package_steps.quality_council.status: queued→done'::text;
      END IF;

    ELSIF r.cluster = 'A_building_no_qc_job' THEN
      -- Sicherheitsnetz: kein aktiver Job darf existieren (race-condition)
      IF EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.package_id = r.package_id
          AND jq.job_type = 'package_quality_council'
          AND jq.status IN ('pending','queued','processing')
      ) THEN
        RETURN QUERY SELECT r.package_id, r.title, r.cluster, 'skip_now_has_active_job'::text,
          'race-condition: zwischenzeitlich aktiver QC-Job entstanden'::text;
        CONTINUE;
      END IF;

      -- curriculum_id aus course_packages laden (Spalte existiert dort)
      SELECT cp.curriculum_id INTO v_curriculum_id
      FROM public.course_packages cp WHERE cp.id = r.package_id;

      IF p_dry_run THEN
        RETURN QUERY SELECT r.package_id, r.title, r.cluster, 'dry_run_enqueue_qc'::text,
          ('würde package_quality_council enqueuen (lane=recovery, prio=10, curriculum=' || COALESCE(v_curriculum_id::text,'NULL') || ')')::text;
      ELSE
        INSERT INTO public.job_queue (
          job_type, status, lane, priority, max_attempts,
          payload, package_id, meta, run_after, scheduled_at
        )
        VALUES (
          'package_quality_council', 'pending', 'recovery', 10, 25,
          jsonb_build_object(
            'package_id', r.package_id,
            'curriculum_id', v_curriculum_id,
            'step_key', 'quality_council',
            'mode', 'admin_repair'
          ),
          r.package_id,
          jsonb_build_object(
            'admin_enqueued_at', now(),
            'admin_repair_source', 'admin_repair_quality_council_drift',
            'admin_repair_reason', 'building_without_qc_job'
          ),
          now(),
          now()
        )
        RETURNING id INTO v_new_job_id;
        v_acted := v_acted + 1;
        RETURN QUERY SELECT r.package_id, r.title, r.cluster, 'qc_job_enqueued'::text,
          ('neuer job_id=' || v_new_job_id::text)::text;
      END IF;
    END IF;
  END LOOP;

  IF NOT p_dry_run AND v_acted > 0 THEN
    RAISE NOTICE 'admin_repair_quality_council_drift: % heilende Aktionen ausgeführt', v_acted;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_repair_quality_council_drift(boolean, int) TO authenticated;
