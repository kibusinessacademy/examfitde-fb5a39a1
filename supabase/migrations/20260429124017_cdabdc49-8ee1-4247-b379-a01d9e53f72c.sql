
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
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
    SELECT v.package_id  AS r_package_id,
           v.title       AS r_title,
           v.cluster     AS r_cluster,
           v.pkg_status  AS r_pkg_status,
           v.qc_completed AS r_qc_completed
    FROM public.v_admin_qc_step_drift v
    WHERE v.heal_eligible = true
    ORDER BY v.step_age_sec DESC
    LIMIT GREATEST(p_limit, 1)
  LOOP
    -- ─────────── Cluster D: QC completed, Step queued → Step→done ───────────
    IF r.r_cluster = 'D_qc_completed_step_drift' THEN
      IF p_dry_run THEN
        RETURN QUERY SELECT
          r.r_package_id,
          r.r_title,
          r.r_cluster,
          'dry_run_step_set_done'::text,
          'letzter QC completed → setze step.status=done'::text;
      ELSE
        UPDATE public.package_steps ps
        SET status     = 'done',
            updated_at = now(),
            meta       = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
                           'admin_repaired_at',     now(),
                           'admin_repair_source',   'admin_repair_quality_council_drift',
                           'admin_repair_reason',   'qc_completed_step_drift'
                         )
        WHERE ps.package_id = r.r_package_id
          AND ps.step_key   = 'quality_council';

        v_acted := v_acted + 1;

        RETURN QUERY SELECT
          r.r_package_id,
          r.r_title,
          r.r_cluster,
          'step_set_done'::text,
          'package_steps.quality_council.status: queued→done'::text;
      END IF;

    -- ─────────── Cluster A_building: enqueue fehlenden QC-Job ───────────
    ELSIF r.r_cluster = 'A_building_no_qc_job' THEN
      -- Race-Schutz: kein aktiver Job darf mittlerweile existieren
      IF EXISTS (
        SELECT 1
        FROM public.job_queue jq
        WHERE jq.package_id = r.r_package_id
          AND jq.job_type   = 'package_quality_council'
          AND jq.status IN ('pending','queued','processing')
      ) THEN
        RETURN QUERY SELECT
          r.r_package_id,
          r.r_title,
          r.r_cluster,
          'skip_now_has_active_job'::text,
          'race-condition: zwischenzeitlich aktiver QC-Job entstanden'::text;
        CONTINUE;
      END IF;

      SELECT cp.curriculum_id
      INTO v_curriculum_id
      FROM public.course_packages cp
      WHERE cp.id = r.r_package_id;

      IF p_dry_run THEN
        RETURN QUERY SELECT
          r.r_package_id,
          r.r_title,
          r.r_cluster,
          'dry_run_enqueue_qc'::text,
          ('würde package_quality_council enqueuen (lane=recovery, prio=10, curriculum='
            || COALESCE(v_curriculum_id::text, 'NULL') || ')')::text;
      ELSE
        INSERT INTO public.job_queue (
          job_type, status, lane, priority, max_attempts,
          payload, package_id, meta, run_after, scheduled_at
        )
        VALUES (
          'package_quality_council',
          'pending',
          'recovery',
          10,
          25,
          jsonb_build_object(
            'package_id',    r.r_package_id,
            'curriculum_id', v_curriculum_id,
            'step_key',      'quality_council',
            'mode',          'admin_repair'
          ),
          r.r_package_id,
          jsonb_build_object(
            'admin_enqueued_at',   now(),
            'admin_repair_source', 'admin_repair_quality_council_drift',
            'admin_repair_reason', 'building_without_qc_job'
          ),
          now(),
          now()
        )
        RETURNING job_queue.id INTO v_new_job_id;

        v_acted := v_acted + 1;

        RETURN QUERY SELECT
          r.r_package_id,
          r.r_title,
          r.r_cluster,
          'qc_job_enqueued'::text,
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
