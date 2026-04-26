-- ═══════════════════════════════════════════════════════════════
-- 1. View: kanonische Coverage-Gap-Diagnose
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_package_coverage_gap AS
WITH track_min AS (
  SELECT 'EXAM_FIRST'::text AS track, 80.0::numeric AS min_pct
  UNION ALL SELECT 'EXAM_FIRST_PLUS', 75.0
  UNION ALL SELECT 'STUDIUM', 75.0
  UNION ALL SELECT 'AUSBILDUNG_VOLL', 85.0
),
cov AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.track,
    cp.status,
    cp.build_progress,
    cp.blocked_reason,
    cp.curriculum_id,
    cp.last_progress_at,
    (SELECT COUNT(DISTINCT c.id)
       FROM public.learning_fields lf
       JOIN public.competencies c ON c.learning_field_id = lf.id
      WHERE lf.curriculum_id = cp.curriculum_id) AS comps_total,
    (SELECT COUNT(DISTINCT eq.competency_id)
       FROM public.exam_questions eq
      WHERE eq.package_id = cp.id AND eq.competency_id IS NOT NULL) AS comps_with_q
  FROM public.course_packages cp
  WHERE cp.status IN ('building','blocked','queued','published')
)
SELECT
  cov.package_id,
  cov.title,
  cov.track,
  cov.status,
  cov.build_progress,
  cov.blocked_reason,
  cov.last_progress_at,
  cov.comps_total,
  cov.comps_with_q,
  COALESCE(ROUND(100.0 * cov.comps_with_q / NULLIF(cov.comps_total,0), 1), 0) AS coverage_pct,
  COALESCE(tm.min_pct, 80.0) AS track_min_pct,
  GREATEST(0, COALESCE(tm.min_pct,80.0) - COALESCE(ROUND(100.0 * cov.comps_with_q / NULLIF(cov.comps_total,0), 1), 0)) AS gap_pp,
  CASE
    WHEN cov.comps_total = 0 THEN 'no_curriculum'
    WHEN COALESCE(ROUND(100.0 * cov.comps_with_q / NULLIF(cov.comps_total,0), 1), 0) >= COALESCE(tm.min_pct,80.0) THEN 'ok'
    WHEN COALESCE(ROUND(100.0 * cov.comps_with_q / NULLIF(cov.comps_total,0), 1), 0) >= COALESCE(tm.min_pct,80.0) - 10 THEN 'near_threshold'
    ELSE 'gap_blocking_publish'
  END AS gap_severity
FROM cov
LEFT JOIN track_min tm ON tm.track = cov.track::text;

GRANT SELECT ON public.v_package_coverage_gap TO authenticated, service_role;

COMMENT ON VIEW public.v_package_coverage_gap IS
'Kanonische Coverage-Gap-Diagnose: Welche Pakete haben zu wenige Kompetenzen mit Fragen? Quelle für Cockpit-Karte und Routing.';

-- ═══════════════════════════════════════════════════════════════
-- 2. View: ehrlicher Active vs Cold Backlog
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_active_vs_cold_backlog AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.track,
  cp.status,
  cp.build_progress,
  cp.last_progress_at,
  CASE
    WHEN cp.status = 'published' OR cp.is_published = true THEN 'live'
    WHEN cp.status IN ('building','blocked') THEN 'active_inflight'
    WHEN cp.status = 'queued' AND (cp.last_progress_at IS NULL OR cp.last_progress_at < now() - interval '7 days') THEN 'cold_backlog'
    WHEN cp.status = 'queued' THEN 'warm_backlog'
    ELSE 'other'
  END AS bucket,
  EXTRACT(DAY FROM (now() - COALESCE(cp.last_progress_at, cp.created_at)))::int AS days_idle
FROM public.course_packages cp
WHERE cp.archived = false OR cp.archived IS NULL;

GRANT SELECT ON public.v_active_vs_cold_backlog TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 3. Funktion: routet REPAIR_NO_EFFECT korrekt
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_route_blocked_to_correct_lane(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE(
  package_id uuid,
  title text,
  action text,
  coverage_pct numeric,
  track_min_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_action text;
BEGIN
  -- Auth: Admin only
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  FOR rec IN
    SELECT
      cp.id,
      cp.title,
      cp.track,
      cp.status,
      cg.coverage_pct,
      cg.track_min_pct,
      cg.gap_severity
    FROM public.course_packages cp
    JOIN public.v_package_coverage_gap cg ON cg.package_id = cp.id
    WHERE cp.status = 'blocked'
      AND (cp.stuck_reason ILIKE '%REPAIR_NO_EFFECT%'
           OR cp.blocked_reason = 'quality_no_progress_3x'
           OR cp.blocked_reason = 'coverage_gap')
  LOOP
    -- Decide action
    IF rec.gap_severity = 'ok' THEN
      v_action := 'requeue_auto_publish';  -- 100%-Fälle: false positive blockade
    ELSIF rec.gap_severity = 'no_curriculum' THEN
      v_action := 'manual_review_no_curriculum';
    ELSE
      v_action := 'route_to_targeted_competency_fill';
    END IF;

    package_id := rec.id;
    title := rec.title;
    action := v_action;
    coverage_pct := rec.coverage_pct;
    track_min_pct := rec.track_min_pct;
    RETURN NEXT;

    IF p_dry_run THEN CONTINUE; END IF;

    -- Apply action
    IF v_action = 'requeue_auto_publish' THEN
      -- Coverage IS fine, repair_no_effect was a false positive. Reset and re-publish.
      UPDATE public.package_steps
      SET status = 'queued',
          attempts = 0,
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'reset_reason', 'coverage_ok_false_blockade',
            'reset_at', now(),
            'reset_by', 'admin_route_blocked_to_correct_lane'
          )
      WHERE package_id = rec.id
        AND step_key IN ('repair_exam_pool_quality','run_integrity_check','quality_council','auto_publish');

      UPDATE public.course_packages
      SET status = 'building',
          blocked_reason = NULL,
          stuck_reason = NULL,
          last_progress_at = now()
      WHERE id = rec.id;

    ELSIF v_action = 'route_to_targeted_competency_fill' THEN
      -- True coverage gap — must enrich content first.
      UPDATE public.course_packages
      SET blocked_reason = 'coverage_gap',
          stuck_reason = format('Coverage %s%% < track-min %s%% — requires targeted_competency_fill',
                                rec.coverage_pct, rec.track_min_pct),
          unblock_hint = 'enqueue package_targeted_competency_fill, then auto_publish'
      WHERE id = rec.id;

      -- Enqueue targeted_competency_fill if helper exists; otherwise just relabel.
      BEGIN
        INSERT INTO public.job_queue (job_type, package_id, status, priority, created_at, run_after, meta)
        VALUES (
          'package_targeted_competency_fill',
          rec.id,
          'pending',
          50,
          now(),
          now(),
          jsonb_build_object(
            'enqueued_by', 'admin_route_blocked_to_correct_lane',
            'reason', 'coverage_gap_after_repair_no_effect',
            'coverage_pct', rec.coverage_pct,
            'track_min_pct', rec.track_min_pct
          )
        )
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        -- helper job_type may not be enqueueable — non-fatal, status is already updated
        NULL;
      END;
    END IF;

    -- Audit log
    BEGIN
      INSERT INTO public.system_heal_log (heal_type, package_id, detail, created_at)
      VALUES (
        'route_blocked_to_correct_lane',
        rec.id,
        jsonb_build_object(
          'action', v_action,
          'coverage_pct', rec.coverage_pct,
          'track_min_pct', rec.track_min_pct,
          'gap_severity', rec.gap_severity,
          'previous_blocked_reason', rec.status
        ),
        now()
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_route_blocked_to_correct_lane(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_route_blocked_to_correct_lane(boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 4. Funktion: bricht Auto-Publish-Retry-Storm
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_cancel_publish_retry_storm()
RETURNS TABLE(package_id uuid, cancelled_jobs int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_cnt int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  FOR rec IN
    SELECT DISTINCT cg.package_id
    FROM public.v_package_coverage_gap cg
    WHERE cg.gap_severity IN ('gap_blocking_publish','no_curriculum')
      AND cg.status IN ('building','blocked')
  LOOP
    UPDATE public.job_queue
    SET status = 'cancelled',
        last_error = COALESCE(last_error,'') || ' | terminal_coverage_gap_storm_break',
        updated_at = now()
    WHERE job_queue.package_id = rec.package_id
      AND job_type = 'package_auto_publish'
      AND status IN ('pending','batch_pending');

    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt > 0 THEN
      package_id := rec.package_id;
      cancelled_jobs := v_cnt;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_publish_retry_storm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_publish_retry_storm() TO authenticated, service_role;