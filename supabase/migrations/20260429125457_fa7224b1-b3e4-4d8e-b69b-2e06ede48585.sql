-- ============================================================================
-- QC-Drift Repair v2: SSOT-Datenintegrität (curriculum_id) + Cluster F
-- ============================================================================
-- Hintergrund: assert_job_payload erzwingt payload->>'curriculum_id' für
-- package_quality_council. Repair-RPC muss daher:
--   1. curriculum_id aus course_packages lesen
--   2. NULL-Fall sauber skippen (Cluster F sichtbar machen)
--   3. curriculum_id in payload mit aufnehmen
-- ============================================================================

-- 1) View erweitern: curriculum_id + Cluster F (höchste Priorität)
DROP VIEW IF EXISTS public.v_admin_qc_step_drift CASCADE;

CREATE VIEW public.v_admin_qc_step_drift
WITH (security_invoker = true)
AS
WITH base AS (
  SELECT
    ps.package_id,
    cp.curriculum_id,
    cp.title,
    cp.status AS pkg_status,
    ps.updated_at AS step_updated_at,
    EXTRACT(epoch FROM now() - ps.updated_at)::integer AS step_age_sec,
    count(j.id) FILTER (WHERE j.job_type = 'package_quality_council') AS qc_total,
    count(j.id) FILTER (WHERE j.job_type = 'package_quality_council'
                          AND j.status IN ('pending','queued','processing')) AS qc_active,
    count(j.id) FILTER (WHERE j.job_type = 'package_quality_council' AND j.status = 'failed') AS qc_failed,
    count(j.id) FILTER (WHERE j.job_type = 'package_quality_council' AND j.status = 'cancelled') AS qc_cancelled,
    count(j.id) FILTER (WHERE j.job_type = 'package_quality_council' AND j.status = 'completed') AS qc_completed
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  LEFT JOIN public.job_queue j ON j.package_id = ps.package_id
  WHERE ps.step_key = 'quality_council'
    AND ps.status = 'queued'::step_status
  GROUP BY ps.package_id, cp.curriculum_id, cp.title, cp.status, ps.updated_at
)
SELECT
  package_id,
  curriculum_id,
  title,
  pkg_status,
  step_updated_at,
  step_age_sec,
  qc_total, qc_active, qc_failed, qc_cancelled, qc_completed,
  CASE
    -- F hat höchste Priorität: Datenintegritätsproblem blockt alles
    WHEN curriculum_id IS NULL THEN 'F_missing_curriculum_id'
    WHEN qc_active > 0 THEN 'B_active_qc_job'
    WHEN qc_completed > 0 THEN 'D_qc_completed_step_drift'
    WHEN qc_failed > 0 AND qc_total = (qc_failed + qc_cancelled) THEN 'C_failed_qc_only'
    WHEN qc_total = 0 AND pkg_status = 'building' THEN 'A_building_no_qc_job'
    WHEN qc_total = 0 AND pkg_status = 'queued' THEN 'A_queued_no_qc_job'
    WHEN qc_total = 0 THEN 'A_other_no_qc_job'
    ELSE 'E_mixed'
  END AS cluster,
  CASE
    WHEN curriculum_id IS NULL THEN false  -- F ist NICHT heilbar via QC-Repair
    WHEN qc_active > 0 THEN false
    WHEN qc_completed > 0 AND pkg_status IN ('building','queued') THEN true
    WHEN qc_total = 0 AND pkg_status = 'building' THEN true
    ELSE false
  END AS heal_eligible
FROM base;

GRANT SELECT ON public.v_admin_qc_step_drift TO authenticated;

-- 2) Detail-RPC + Summary-RPC neu signieren (curriculum_id aufnehmen)
DROP FUNCTION IF EXISTS public.admin_get_qc_step_drift_summary();
CREATE OR REPLACE FUNCTION public.admin_get_qc_step_drift_summary()
RETURNS TABLE(
  cluster text,
  pkgs bigint,
  heal_eligible_cnt bigint,
  oldest_step_age_sec integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    v.cluster,
    count(*)::bigint,
    count(*) FILTER (WHERE v.heal_eligible)::bigint,
    max(v.step_age_sec)
  FROM public.v_admin_qc_step_drift v
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY v.cluster
  ORDER BY v.cluster;
$$;

DROP FUNCTION IF EXISTS public.admin_get_qc_step_drift_detail(text, integer);
CREATE OR REPLACE FUNCTION public.admin_get_qc_step_drift_detail(
  p_cluster text,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  package_id uuid,
  curriculum_id uuid,
  title text,
  pkg_status text,
  step_updated_at timestamptz,
  step_age_sec integer,
  qc_total bigint,
  qc_active bigint,
  qc_failed bigint,
  qc_cancelled bigint,
  qc_completed bigint,
  cluster text,
  heal_eligible boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    v.package_id, v.curriculum_id, v.title, v.pkg_status,
    v.step_updated_at, v.step_age_sec,
    v.qc_total, v.qc_active, v.qc_failed, v.qc_cancelled, v.qc_completed,
    v.cluster, v.heal_eligible
  FROM public.v_admin_qc_step_drift v
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND v.cluster = p_cluster
  ORDER BY v.step_updated_at NULLS LAST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_qc_step_drift_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_qc_step_drift_detail(text, integer) TO authenticated;

-- 3) Repair-RPC patchen: curriculum_id-Pflicht + skip-Pfad + payload-injection
DROP FUNCTION IF EXISTS public.admin_repair_quality_council_drift(boolean, integer);
CREATE OR REPLACE FUNCTION public.admin_repair_quality_council_drift(
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 50
)
RETURNS TABLE(
  package_id uuid,
  cluster    text,
  action     text,
  detail     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
#variable_conflict use_column
DECLARE
  r record;
  v_count int := 0;
  v_payload jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR r IN
    SELECT
      d.package_id    AS r_package_id,
      d.curriculum_id AS r_curriculum_id,
      d.cluster       AS r_cluster,
      d.title         AS r_title
    FROM public.v_admin_qc_step_drift d
    WHERE d.cluster IN ('A_building_no_qc_job', 'D_qc_completed_step_drift')
    ORDER BY d.cluster, d.step_updated_at NULLS LAST
    LIMIT p_limit
  LOOP
    v_count := v_count + 1;

    -- SSOT-GUARD: ohne curriculum_id KEIN enqueue (assert_job_payload würde blocken)
    IF r.r_curriculum_id IS NULL THEN
      package_id := r.r_package_id;
      cluster    := r.r_cluster;
      action     := 'skip_missing_curriculum_id';
      detail     := COALESCE(r.r_title, '') || ' — course_packages.curriculum_id IS NULL (Cluster F)';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF r.r_cluster = 'A_building_no_qc_job' THEN
      IF p_dry_run THEN
        package_id := r.r_package_id;
        cluster    := r.r_cluster;
        action     := 'dry_run_enqueue_qc';
        detail     := r.r_title;
        RETURN NEXT;
      ELSE
        v_payload := jsonb_build_object(
          'package_id',    r.r_package_id,
          'curriculum_id', r.r_curriculum_id,
          'mode',          'admin_repair_enqueue_missing_qc',
          'source',        'admin_repair_quality_council_drift'
        );
        INSERT INTO public.job_queue
          (job_type, status, lane, priority, max_attempts, payload, package_id)
        VALUES
          ('package_quality_council', 'pending', 'recovery', 10, 25, v_payload, r.r_package_id);

        package_id := r.r_package_id;
        cluster    := r.r_cluster;
        action     := 'qc_job_enqueued';
        detail     := r.r_title;
        RETURN NEXT;
      END IF;

    ELSIF r.r_cluster = 'D_qc_completed_step_drift' THEN
      IF p_dry_run THEN
        package_id := r.r_package_id;
        cluster    := r.r_cluster;
        action     := 'dry_run_enqueue_qc_adoption';
        detail     := r.r_title;
        RETURN NEXT;
      ELSE
        v_payload := jsonb_build_object(
          'package_id',    r.r_package_id,
          'curriculum_id', r.r_curriculum_id,
          'mode',          'admin_repair_adopt_completed_qc',
          'source',        'admin_repair_quality_council_drift',
          'note',          'replay/adoption: real worker must finalize step (no direct status=done)'
        );
        INSERT INTO public.job_queue
          (job_type, status, lane, priority, max_attempts, payload, package_id)
        VALUES
          ('package_quality_council', 'pending', 'recovery', 10, 25, v_payload, r.r_package_id);

        package_id := r.r_package_id;
        cluster    := r.r_cluster;
        action     := 'qc_job_enqueued_for_adoption';
        detail     := r.r_title;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    package_id := NULL;
    cluster    := 'none';
    action     := 'noop';
    detail     := 'no healable drift found';
    RETURN NEXT;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_repair_quality_council_drift(boolean, integer) TO authenticated;