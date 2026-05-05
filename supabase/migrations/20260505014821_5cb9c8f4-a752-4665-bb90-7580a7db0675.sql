
-- =============================================================
-- 1) Didaktik-Audit: Pakete mit lückenhaften didaktischen Steps
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_didaktik_audit_scan()
RETURNS TABLE(
  package_id uuid,
  title text,
  status text,
  track text,
  bronze_locked boolean,
  total_didactic int,
  done_didactic int,
  open_didactic int,
  failed_didactic int,
  blocked_didactic int,
  open_steps text[],
  last_progress_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.role()='service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH didactic_keys AS (
    SELECT unnest(ARRAY[
      'generate_handbook','validate_handbook','validate_handbook_depth','expand_handbook',
      'generate_glossary',
      'generate_lesson_minichecks','validate_lesson_minichecks',
      'generate_oral_exam','validate_oral_exam',
      'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
      'generate_learning_content','validate_learning_content','finalize_learning_content'
    ]) AS step_key
  ),
  agg AS (
    SELECT cb.package_id,
      COUNT(*) AS total_didactic,
      COUNT(*) FILTER (WHERE cb.status='done') AS done_didactic,
      COUNT(*) FILTER (WHERE cb.status NOT IN ('done','skipped')) AS open_didactic,
      COUNT(*) FILTER (WHERE cb.status='failed') AS failed_didactic,
      COUNT(*) FILTER (WHERE cb.status='blocked') AS blocked_didactic,
      ARRAY_AGG(cb.step_key ORDER BY cb.sort_order) FILTER (WHERE cb.status NOT IN ('done','skipped')) AS open_steps,
      MAX(GREATEST(cb.updated_at, cb.finished_at)) AS last_progress_at
    FROM course_package_build_steps cb
    WHERE cb.step_key IN (SELECT step_key FROM didactic_keys)
    GROUP BY cb.package_id
  )
  SELECT cp.id, cp.title, cp.status, cp.track,
    COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean,false) AS bronze_locked,
    a.total_didactic::int, a.done_didactic::int, a.open_didactic::int,
    a.failed_didactic::int, a.blocked_didactic::int,
    a.open_steps, a.last_progress_at
  FROM agg a
  JOIN course_packages cp ON cp.id = a.package_id
  WHERE a.open_didactic > 0
    AND cp.status IN ('building','requires_review','queued','failed')
  ORDER BY (a.failed_didactic + a.blocked_didactic) DESC, a.open_didactic DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_didaktik_audit_scan() TO authenticated;

-- =============================================================
-- 2) Didaktik-Heilung mit Bypass-Schalter
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_didaktik_heal_packages(
  p_package_ids uuid[],
  p_bypass_bronze boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pkg uuid;
  v_reset int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_actor uuid := auth.uid();
  v_bronze boolean;
  v_steps_reset int;
BEGIN
  IF NOT public.has_role(v_actor,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_package_ids IS NULL OR array_length(p_package_ids,1) IS NULL THEN
    RETURN jsonb_build_object('reset',0,'skipped',0,'results','[]'::jsonb);
  END IF;

  FOREACH v_pkg IN ARRAY p_package_ids LOOP
    SELECT COALESCE((feature_flags->'bronze'->>'locked')::boolean,false) INTO v_bronze
      FROM course_packages WHERE id=v_pkg;

    IF v_bronze AND NOT p_bypass_bronze THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('package_id',v_pkg,'action','skipped_bronze');
      CONTINUE;
    END IF;

    UPDATE course_package_build_steps
    SET status='queued', attempts=0, last_error=NULL,
        updated_at=now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'didaktik_heal_at', now(),
          'didaktik_heal_by', v_actor,
          'bypass_bronze', p_bypass_bronze)
    WHERE package_id=v_pkg
      AND status IN ('failed','blocked','pending_enqueue')
      AND step_key IN (
        'generate_handbook','validate_handbook','validate_handbook_depth','expand_handbook',
        'generate_glossary',
        'generate_lesson_minichecks','validate_lesson_minichecks',
        'generate_oral_exam','validate_oral_exam',
        'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
        'generate_learning_content','validate_learning_content','finalize_learning_content'
      );
    GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, details)
    VALUES('didaktik_manual_heal','package', v_pkg::text,
      CASE WHEN v_steps_reset>0 THEN 'success' ELSE 'noop' END,
      jsonb_build_object('steps_reset', v_steps_reset, 'bypass_bronze', p_bypass_bronze, 'actor', v_actor));

    IF v_steps_reset>0 THEN
      v_reset := v_reset + 1;
    END IF;
    v_results := v_results || jsonb_build_object('package_id',v_pkg,'steps_reset',v_steps_reset,'bronze_locked',v_bronze);
  END LOOP;

  RETURN jsonb_build_object('reset', v_reset, 'skipped', v_skipped, 'results', v_results);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_didaktik_heal_packages(uuid[], boolean) TO authenticated;

-- =============================================================
-- 3) E2E Build-Integrity pro Paket
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_build_integrity_e2e(p_limit int DEFAULT 100)
RETURNS TABLE(
  package_id uuid,
  title text,
  status text,
  total_steps int,
  done_steps int,
  queued_steps int,
  failed_steps int,
  blocked_steps int,
  pending_enqueue_steps int,
  missing_step_keys text[],
  data_holes int,
  completeness_pct numeric,
  last_progress_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_canonical_steps text[] := ARRAY[
    'auto_seed_exam_blueprints','generate_blueprint_variants','validate_blueprint_variants',
    'promote_blueprint_variants','generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
    'scaffold_learning_course','generate_learning_content','validate_learning_content',
    'fanout_learning_content','finalize_learning_content',
    'generate_handbook','validate_handbook','validate_handbook_depth','expand_handbook','enqueue_handbook_expand',
    'generate_glossary','generate_lesson_minichecks','validate_lesson_minichecks',
    'generate_oral_exam','validate_oral_exam',
    'build_ai_tutor_index','validate_tutor_index',
    'elite_harden','quality_council','run_integrity_check','auto_publish'
  ];
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.role()='service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH agg AS (
    SELECT cb.package_id,
      COUNT(*) AS total_steps,
      COUNT(*) FILTER (WHERE cb.status='done') AS done_steps,
      COUNT(*) FILTER (WHERE cb.status='queued') AS queued_steps,
      COUNT(*) FILTER (WHERE cb.status='failed') AS failed_steps,
      COUNT(*) FILTER (WHERE cb.status='blocked') AS blocked_steps,
      COUNT(*) FILTER (WHERE cb.status='pending_enqueue') AS pending_enqueue_steps,
      ARRAY(
        SELECT s FROM unnest(v_canonical_steps) s
        WHERE s NOT IN (SELECT step_key FROM course_package_build_steps WHERE package_id=cb.package_id)
      ) AS missing_step_keys,
      MAX(GREATEST(cb.updated_at, cb.finished_at)) AS last_progress_at
    FROM course_package_build_steps cb
    GROUP BY cb.package_id
  )
  SELECT cp.id, cp.title, cp.status,
    a.total_steps::int, a.done_steps::int, a.queued_steps::int,
    a.failed_steps::int, a.blocked_steps::int, a.pending_enqueue_steps::int,
    a.missing_step_keys,
    (a.failed_steps + a.blocked_steps + COALESCE(array_length(a.missing_step_keys,1),0))::int AS data_holes,
    ROUND(100.0 * a.done_steps::numeric / NULLIF(a.total_steps,0),1) AS completeness_pct,
    a.last_progress_at
  FROM agg a
  JOIN course_packages cp ON cp.id=a.package_id
  WHERE cp.status IN ('building','requires_review','queued','published','failed')
  ORDER BY data_holes DESC, completeness_pct ASC NULLS LAST
  LIMIT GREATEST(p_limit,1);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_build_integrity_e2e(int) TO authenticated;

-- =============================================================
-- 4) Lane-Reason-Breakdown
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_get_lane_reason_breakdown()
RETURNS TABLE(
  lane text,
  pending_total int,
  true_zombies int,
  dag_waiting int,
  bronze_locked int,
  manual_review int,
  complete_packages int,
  reason_summary text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.role()='service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH jobs AS (
    SELECT
      COALESCE(j.lane, public.derive_job_lane(j.job_type)) AS lane,
      j.id, j.package_id, j.job_type, j.status, j.created_at
    FROM job_queue j
    WHERE j.status IN ('pending','processing','queued')
  ),
  enriched AS (
    SELECT j.*, cp.status AS pkg_status,
      COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean,false) AS is_bronze,
      EXISTS(
        SELECT 1 FROM course_package_build_steps s
        WHERE s.package_id=j.package_id AND s.status IN ('queued','pending_enqueue','failed','blocked')
      ) AS has_open_steps
    FROM jobs j LEFT JOIN course_packages cp ON cp.id=j.package_id
  ),
  classified AS (
    SELECT lane,
      COUNT(*) AS pending_total,
      COUNT(*) FILTER (WHERE pkg_status NOT IN ('requires_review','manual_review','published')
                       AND NOT is_bronze
                       AND NOT has_open_steps
                       AND created_at < now() - interval '30 minutes') AS true_zombies,
      COUNT(*) FILTER (WHERE has_open_steps AND NOT is_bronze) AS dag_waiting,
      COUNT(*) FILTER (WHERE is_bronze) AS bronze_locked,
      COUNT(*) FILTER (WHERE pkg_status IN ('requires_review','manual_review')) AS manual_review,
      COUNT(*) FILTER (WHERE pkg_status='published') AS complete_packages
    FROM enriched
    GROUP BY lane
  )
  SELECT c.lane,
    c.pending_total::int, c.true_zombies::int, c.dag_waiting::int,
    c.bronze_locked::int, c.manual_review::int, c.complete_packages::int,
    CASE
      WHEN c.true_zombies > 0 THEN format('%s echte Zombies — Heal nötig', c.true_zombies)
      WHEN c.dag_waiting > 0 THEN format('%s warten auf DAG-Vorgänger', c.dag_waiting)
      WHEN c.bronze_locked > 0 THEN format('%s Bronze-locked (manuelles Review)', c.bronze_locked)
      WHEN c.manual_review > 0 THEN format('%s in manuellem Review', c.manual_review)
      WHEN c.complete_packages > 0 THEN format('%s bereits published', c.complete_packages)
      ELSE 'Keine Pending-Jobs'
    END
  FROM classified c
  ORDER BY c.pending_total DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_lane_reason_breakdown() TO authenticated;
