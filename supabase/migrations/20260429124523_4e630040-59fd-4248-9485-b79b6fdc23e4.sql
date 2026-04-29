DROP FUNCTION IF EXISTS public.admin_repair_quality_council_drift(boolean, integer);

CREATE OR REPLACE FUNCTION public.admin_repair_quality_council_drift(
  p_dry_run boolean DEFAULT true,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  package_id uuid,
  cluster text,
  action text,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      d.package_id   AS r_package_id,
      d.cluster      AS r_cluster,
      d.title        AS r_title
    FROM public.v_admin_qc_step_drift d
    WHERE d.cluster IN ('A_building_no_qc_job', 'D_qc_completed_step_drift')
    ORDER BY d.cluster, d.step_updated_at NULLS LAST
    LIMIT p_limit
  LOOP
    v_count := v_count + 1;

    IF r.r_cluster = 'A_building_no_qc_job' THEN
      IF p_dry_run THEN
        package_id := r.r_package_id;
        cluster    := r.r_cluster;
        action     := 'dry_run_enqueue_qc';
        detail     := r.r_title;
        RETURN NEXT;
      ELSE
        v_payload := jsonb_build_object(
          'package_id', r.r_package_id,
          'mode', 'admin_repair_enqueue_missing_qc',
          'source', 'admin_repair_quality_council_drift'
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
      -- KEIN UPDATE auf package_steps.status — Ghost-Completion-Guard.
      -- QC-Job im Adoption-Mode enqueuen.
      IF p_dry_run THEN
        package_id := r.r_package_id;
        cluster    := r.r_cluster;
        action     := 'dry_run_enqueue_qc_adoption';
        detail     := r.r_title;
        RETURN NEXT;
      ELSE
        v_payload := jsonb_build_object(
          'package_id', r.r_package_id,
          'mode', 'admin_repair_adopt_completed_qc',
          'source', 'admin_repair_quality_council_drift',
          'note', 'replay/adoption: real worker must finalize step (no direct status=done)'
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
$$;