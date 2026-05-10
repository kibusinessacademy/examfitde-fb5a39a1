DROP VIEW IF EXISTS public.v_soft_drift_packages_ssot;
CREATE VIEW public.v_soft_drift_packages_ssot AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title,
         cp.curriculum_id, cp.track, cp.status
  FROM course_packages cp
  WHERE cp.status = 'published'
), hb AS (
  SELECT p.package_id,
         COUNT(*) FILTER (WHERE hc.id IS NOT NULL) AS hb_total,
         COUNT(*) FILTER (WHERE hc.id IS NOT NULL AND hc.is_published) AS hb_published
  FROM pkg p
  LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
), mc AS (
  SELECT p.package_id,
         COUNT(mq.id) AS mc_total,
         COUNT(*) FILTER (WHERE mq.status = 'approved') AS mc_approved,
         COUNT(*) FILTER (WHERE mq.status = 'archived_duplicate' OR mq.is_duplicate IS TRUE) AS archived_duplicates,
         COUNT(*) FILTER (WHERE mq.status NOT IN ('approved','archived_duplicate')
                              AND COALESCE(mq.is_duplicate,false) = false) AS active_unapproved
  FROM pkg p
  LEFT JOIN minicheck_questions mq ON mq.package_id = p.package_id
  GROUP BY p.package_id
), hb_required AS (
  SELECT track FROM track_step_applicability WHERE step_key='generate_handbook' AND should_run=true
), mc_required AS (
  SELECT track FROM track_step_applicability WHERE step_key='generate_lesson_minichecks' AND should_run=true
)
SELECT
  p.package_id, p.package_title, p.track,
  hb.hb_total, hb.hb_published,
  CASE WHEN hb.hb_total = 0 THEN NULL
       ELSE ROUND(100.0 * hb.hb_published::numeric / hb.hb_total::numeric, 1) END AS hb_publish_pct,
  (p.track IN (SELECT track FROM hb_required)) AS hb_required,
  mc.mc_total, mc.mc_approved,
  mc.archived_duplicates, mc.active_unapproved,
  CASE WHEN mc.mc_total = 0 THEN NULL
       ELSE ROUND(100.0 * mc.mc_approved::numeric / mc.mc_total::numeric, 1) END AS forensic_raw_approval_pct,
  CASE WHEN (mc.mc_approved + mc.active_unapproved) = 0 THEN NULL
       ELSE ROUND(100.0 * mc.mc_approved::numeric
                       / NULLIF(mc.mc_approved + mc.active_unapproved, 0)::numeric, 1) END AS effective_approval_pct,
  CASE WHEN (mc.mc_approved + mc.active_unapproved) = 0 THEN NULL
       ELSE ROUND(100.0 * mc.mc_approved::numeric
                       / NULLIF(mc.mc_approved + mc.active_unapproved, 0)::numeric, 1) END AS mc_approval_pct,
  (p.track IN (SELECT track FROM mc_required)) AS mc_required,
  (hb.hb_total > 0 AND hb.hb_published < hb.hb_total) AS hb_partial_drift,
  ((mc.mc_approved + mc.active_unapproved) > 0
    AND (mc.mc_approved::numeric / NULLIF(mc.mc_approved + mc.active_unapproved,0)::numeric) < 0.85
  ) AS mc_approval_drift,
  (
    CASE WHEN hb.hb_total > 0 AND hb.hb_published < hb.hb_total
      THEN (1::numeric - hb.hb_published::numeric / hb.hb_total::numeric) * 100 *
           CASE WHEN p.track IN (SELECT track FROM hb_required) THEN 2 ELSE 1 END
      ELSE 0 END +
    CASE WHEN (mc.mc_approved + mc.active_unapproved) > 0
          AND (mc.mc_approved::numeric / NULLIF(mc.mc_approved + mc.active_unapproved,0)::numeric) < 0.85
      THEN (0.85 - mc.mc_approved::numeric / NULLIF(mc.mc_approved + mc.active_unapproved,0)::numeric) * 100 *
           CASE WHEN p.track IN (SELECT track FROM mc_required) THEN 2 ELSE 1 END
      ELSE 0 END
  )::numeric(8,2) AS risk_score
FROM pkg p
LEFT JOIN hb ON hb.package_id = p.package_id
LEFT JOIN mc ON mc.package_id = p.package_id;

DROP FUNCTION IF EXISTS public.admin_get_soft_drift_top(integer);
CREATE FUNCTION public.admin_get_soft_drift_top(_limit integer DEFAULT 20)
RETURNS TABLE(
  package_id uuid, package_title text, track text,
  hb_published int, hb_total int, hb_publish_pct numeric, hb_required boolean,
  mc_approved bigint, mc_total bigint,
  effective_approval_pct numeric, forensic_raw_approval_pct numeric,
  archived_duplicates bigint, active_unapproved bigint,
  mc_approval_pct numeric, mc_required boolean,
  hb_partial_drift boolean, mc_approval_drift boolean,
  risk_score numeric, recommended_heal text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT v.package_id, v.package_title, v.track,
         v.hb_published::int, v.hb_total::int, v.hb_publish_pct, v.hb_required,
         v.mc_approved, v.mc_total,
         v.effective_approval_pct, v.forensic_raw_approval_pct,
         v.archived_duplicates, v.active_unapproved,
         v.mc_approval_pct, v.mc_required,
         v.hb_partial_drift, v.mc_approval_drift, v.risk_score,
         CASE
           WHEN v.hb_partial_drift AND v.mc_approval_drift
             THEN 'admin_publish_handbook_remaining + mc_targeted_repair (review-only)'
           WHEN v.hb_partial_drift AND v.hb_required
             THEN 'admin_publish_handbook_remaining (track requires handbook)'
           WHEN v.hb_partial_drift
             THEN 'admin_publish_handbook_remaining (optional track, low priority)'
           WHEN v.mc_approval_drift AND v.mc_required
             THEN 'mc_targeted_repair: dedupe-replace via admin_enqueue_minicheck_repair_targeted'
           WHEN v.mc_approval_drift
             THEN 'mc_review_only: enqueue council in review-only mode'
           WHEN v.archived_duplicates > 50 AND COALESCE(v.effective_approval_pct,100) >= 85
             THEN 'metric_v2_no_action_needed: archived duplicates inflate raw, effective ≥ 85%'
           ELSE 'no action — within tolerance'
         END
  FROM public.v_soft_drift_packages_ssot v
  WHERE has_role(auth.uid(),'admin')
    AND (v.hb_partial_drift OR v.mc_approval_drift)
  ORDER BY v.risk_score DESC NULLS LAST, v.package_title
  LIMIT GREATEST(1, COALESCE(_limit, 20));
$$;
REVOKE ALL ON FUNCTION public.admin_get_soft_drift_top(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_soft_drift_top(int) TO authenticated;

DROP VIEW IF EXISTS public.v_mc_unapproved_per_package;
CREATE VIEW public.v_mc_unapproved_per_package AS
WITH lesson_pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title,
         cp.track::text AS track, cp.curriculum_id,
         l.id AS lesson_id, l.title AS lesson_title, l.competency_id
  FROM course_packages cp
  JOIN courses c ON c.curriculum_id = cp.curriculum_id
  JOIN modules m ON m.course_id = c.id
  JOIN lessons l ON l.module_id = m.id
  WHERE cp.status = 'published'
), mc AS (
  SELECT lp.package_id, lp.package_title, lp.track, lp.curriculum_id,
         lp.lesson_id, lp.lesson_title, lp.competency_id,
         COUNT(mq.*) AS total,
         COUNT(*) FILTER (WHERE mq.status = 'approved') AS approved,
         COUNT(*) FILTER (WHERE mq.status IS DISTINCT FROM 'approved'
                              AND mq.status IS DISTINCT FROM 'archived_duplicate') AS unapproved,
         COUNT(*) FILTER (WHERE mq.status = 'archived_duplicate') AS archived
  FROM lesson_pkg lp
  LEFT JOIN minicheck_questions mq
    ON mq.lesson_id = lp.lesson_id
   AND mq.curriculum_id = lp.curriculum_id
   AND mq.mode = 'lesson'
  GROUP BY lp.package_id, lp.package_title, lp.track, lp.curriculum_id,
           lp.lesson_id, lp.lesson_title, lp.competency_id
)
SELECT
  package_id, package_title, track, curriculum_id,
  lesson_id, lesson_title, competency_id,
  total, approved, unapproved, archived,
  CASE WHEN total=0 THEN 0::numeric
       ELSE ROUND(approved::numeric / total::numeric * 100, 1) END AS approval_pct,
  CASE WHEN (approved + unapproved) = 0 THEN NULL
       ELSE ROUND(approved::numeric / NULLIF(approved + unapproved, 0)::numeric * 100, 1) END AS effective_approval_pct,
  track = ANY (ARRAY['AUSBILDUNG_VOLL','STUDIUM','UMSCHULUNG','WEITERBILDUNG_VOLL']) AS required_by_track
FROM mc;

CREATE OR REPLACE FUNCTION public.admin_enqueue_minicheck_repair_targeted(
  p_package_ids uuid[], p_target_per_lesson int DEFAULT 5, p_max_per_package int DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg uuid; v_active int; v_demand int; v_eff numeric;
  v_inserted int := 0; v_skipped int := 0;
  v_results jsonb := '[]'::jsonb; v_job_id uuid;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_package_ids IS NULL OR array_length(p_package_ids,1) IS NULL THEN
    RAISE EXCEPTION 'p_package_ids must not be empty';
  END IF;

  FOREACH v_pkg IN ARRAY p_package_ids LOOP
    SELECT COUNT(*) INTO v_active FROM public.job_queue
     WHERE package_id = v_pkg AND job_type = 'package_repair_lesson_minichecks'
       AND status IN ('pending','queued','processing');
    SELECT COALESCE(SUM(replacement_needed),0) INTO v_demand
      FROM public.v_minicheck_replacement_demand WHERE package_id = v_pkg;
    SELECT effective_approval_pct INTO v_eff
      FROM public.v_minicheck_effective_quality WHERE package_id = v_pkg;

    IF (COALESCE(v_eff,100) >= 85) AND v_demand <= 0 THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'package_id', v_pkg, 'status','skipped',
        'reason','effective_quality_above_threshold_and_no_demand',
        'effective_approval_pct', v_eff, 'replacement_needed', v_demand));
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('admin_enqueue_minicheck_repair_targeted','package',v_pkg::text,'skipped',
        jsonb_build_object('actor_uid',v_uid,'reason','effective_quality_above_threshold_and_no_demand',
          'effective_approval_pct',v_eff,'replacement_needed',v_demand));
      CONTINUE;
    END IF;

    IF v_demand <= 0 THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'package_id', v_pkg,'status','skipped','reason','no_replacement_demand',
        'effective_approval_pct', v_eff));
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('admin_enqueue_minicheck_repair_targeted','package',v_pkg::text,'skipped',
        jsonb_build_object('actor_uid',v_uid,'reason','no_replacement_demand','effective_approval_pct',v_eff));
      CONTINUE;
    END IF;

    IF v_active >= p_max_per_package THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'package_id', v_pkg,'status','skipped',
        'reason','active_repair_jobs_present','active_jobs',v_active));
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('admin_enqueue_minicheck_repair_targeted','package',v_pkg::text,'skipped',
        jsonb_build_object('actor_uid',v_uid,'reason','active_repair_jobs_present',
          'active_jobs',v_active,'effective_approval_pct',v_eff));
      CONTINUE;
    END IF;

    INSERT INTO public.job_queue(
      job_type, status, payload, meta, package_id, worker_pool, lane,
      run_after, attempts, max_attempts, priority, provider
    ) VALUES (
      'package_repair_lesson_minichecks','pending',
      jsonb_build_object('package_id', v_pkg,'mode','dedupe_replace',
        'target_per_lesson', p_target_per_lesson,'is_repair', true,
        'dedupe_replace_mode', true,
        'enqueue_source','admin_minicheck_repair_targeted','model','gpt-4o-mini'),
      jsonb_build_object('is_repair', true,'exempt_from_auto_cancel', true,
        'can_run_when_not_building', true,'wave','minicheck_repair_v2_targeted',
        'actor_uid', v_uid,'pre_check_effective_approval_pct', v_eff,
        'pre_check_replacement_needed', v_demand),
      v_pkg, 'content','content', now(), 0, 3, 50, 'openai'
    ) RETURNING id INTO v_job_id;

    v_inserted := v_inserted + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'package_id', v_pkg,'status','enqueued','job_id', v_job_id,
      'replacement_demand', v_demand,'effective_approval_pct', v_eff));
    INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES('admin_enqueue_minicheck_repair_targeted','package',v_pkg::text,'enqueued',
      jsonb_build_object('actor_uid',v_uid,'job_id',v_job_id,
        'replacement_demand',v_demand,'effective_approval_pct',v_eff,
        'target_per_lesson',p_target_per_lesson));
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES('admin_enqueue_minicheck_repair_targeted_run','system',NULL,
    CASE WHEN v_inserted>0 THEN 'applied' ELSE 'noop' END,
    jsonb_build_object('actor_uid',v_uid,'inserted',v_inserted,'skipped',v_skipped,
      'package_count',array_length(p_package_ids,1)));

  RETURN jsonb_build_object('inserted',v_inserted,'skipped',v_skipped,
    'results',v_results,'generated_at',now());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_enqueue_minicheck_repair_targeted(uuid[],int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_minicheck_repair_targeted(uuid[],int,int) TO authenticated;