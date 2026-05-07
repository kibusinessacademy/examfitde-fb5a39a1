-- =====================================================================
-- PR-B: Phantom-Skipped Required-Step Recovery (Capability-Aware)
-- =====================================================================
-- Drift-View + Heal-RPC für die 167+ Pakete, deren Required-Steps
-- am 2026-05-02 vom L2-Sweep fälschlich auf 'skipped' gesetzt wurden.
-- Recovery setzt step→queued (mit Bypass-GUC für PR-A-Trigger) und
-- triggert admin_nudge_atomic_trigger. Audit: phantom_skipped_required_heal.

-- ----- 1) Drift-View ---------------------------------------------------
CREATE OR REPLACE VIEW public.v_phantom_skipped_required_drift AS
WITH skipped_required AS (
  SELECT
    ps.package_id,
    ps.step_key,
    ps.status::text AS step_status,
    ps.updated_at AS skipped_at,
    ps.meta->>'skip_reason' AS skip_reason,
    cp.status::text AS pkg_status,
    cp.gate_class::text AS gate_class,
    cp.track::text AS track,
    cp.package_key,
    public.fn_package_has_oral_exam(ps.package_id) AS has_oral
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE ps.status::text = 'skipped'
    AND (
      public.fn_step_globally_required(ps.step_key)
      OR (ps.step_key IN ('generate_oral_exam','validate_oral_exam')
          AND public.fn_package_has_oral_exam(ps.package_id))
    )
    AND (
      ps.meta->>'skip_reason' IS NULL
      OR ps.meta->>'skip_reason' ILIKE 'phantom%'
      OR ps.meta->>'skip_reason' ILIKE 'data_holes%'
      OR ps.meta->>'skip_reason' ILIKE 'sweep%'
      OR ps.meta->>'skip_reason' ILIKE 'dormant%'
    )
)
SELECT
  sr.*,
  (SELECT COUNT(*) FROM public.job_queue jq
    WHERE jq.package_id = sr.package_id
      AND jq.status IN ('pending','processing')) AS active_jobs,
  (SELECT COUNT(*) FROM public.exam_questions eq
    WHERE eq.package_id = sr.package_id AND eq.status='approved') AS approved_questions,
  -- Eligibility: pkg nicht published/quarantined, keine aktiven Jobs zum step
  (sr.pkg_status NOT IN ('published','archived')
    AND (sr.gate_class IS NULL OR sr.gate_class <> 'terminal')
  ) AS eligible
FROM skipped_required sr;

REVOKE ALL ON public.v_phantom_skipped_required_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_phantom_skipped_required_drift TO service_role;

-- ----- 2) Heal-RPC -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_heal_phantom_skipped_required_steps(
  p_step_key  text DEFAULT NULL,
  p_package_id uuid DEFAULT NULL,
  p_dry_run   boolean DEFAULT true,
  p_limit     integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_rec record;
  v_processed int := 0;
  v_errors int := 0;
  v_details jsonb := '[]'::jsonb;
  v_nudge jsonb;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'eligible_count', (
        SELECT COUNT(*) FROM public.v_phantom_skipped_required_drift d
        WHERE d.eligible = true
          AND (p_step_key IS NULL OR d.step_key = p_step_key)
          AND (p_package_id IS NULL OR d.package_id = p_package_id)
      ),
      'sample', COALESCE((
        SELECT jsonb_agg(row_to_json(s))
        FROM (
          SELECT package_id, package_key, step_key, skip_reason, approved_questions
          FROM public.v_phantom_skipped_required_drift d
          WHERE d.eligible = true
            AND (p_step_key IS NULL OR d.step_key = p_step_key)
            AND (p_package_id IS NULL OR d.package_id = p_package_id)
          ORDER BY approved_questions DESC NULLS LAST
          LIMIT p_limit
        ) s
      ), '[]'::jsonb)
    );
  END IF;

  -- LIVE: Bypass-GUC for PR-A guard
  PERFORM set_config('app.allow_required_skip','on', true);

  FOR v_rec IN
    SELECT package_id, step_key
    FROM public.v_phantom_skipped_required_drift d
    WHERE d.eligible = true
      AND (p_step_key IS NULL OR d.step_key = p_step_key)
      AND (p_package_id IS NULL OR d.package_id = p_package_id)
    ORDER BY approved_questions DESC NULLS LAST
    LIMIT p_limit
  LOOP
    BEGIN
      UPDATE public.package_steps
      SET status = 'queued',
          meta = COALESCE(meta,'{}'::jsonb)
                 || jsonb_build_object(
                      'phantom_skip_recovered_at', now(),
                      'phantom_skip_recovered_by', 'admin_heal_phantom_skipped_required_steps',
                      'previous_skip_reason', meta->>'skip_reason'
                    )
                 - 'skip_reason'
                 - 'last_atomic_enqueue_at',
          updated_at = now()
      WHERE package_id = v_rec.package_id AND step_key = v_rec.step_key;

      -- nudge
      BEGIN
        SELECT public.admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
      EXCEPTION WHEN OTHERS THEN
        v_nudge := jsonb_build_object('nudge_error', SQLERRM);
      END;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'success',
              jsonb_build_object('step_key', v_rec.step_key, 'nudge', v_nudge, 'caller', v_caller));

      v_processed := v_processed + 1;
      v_details := v_details || jsonb_build_object(
        'package_id', v_rec.package_id, 'step_key', v_rec.step_key, 'status','recovered');
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      v_details := v_details || jsonb_build_object(
        'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
        'status','error','error', SQLERRM);
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'error', SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', false,
    'processed', v_processed,
    'errors', v_errors,
    'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_phantom_skipped_required_steps(text,uuid,boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_phantom_skipped_required_steps(text,uuid,boolean,integer) TO authenticated, service_role;