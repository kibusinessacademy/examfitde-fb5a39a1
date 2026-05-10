
DROP FUNCTION IF EXISTS public.admin_soft_drift_mc_repair(uuid[], boolean);

CREATE OR REPLACE VIEW public.v_mc_unapproved_per_package AS
WITH lesson_pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.track::text AS track,
         cp.curriculum_id, l.id AS lesson_id, l.title AS lesson_title, l.competency_id
  FROM public.course_packages cp
  JOIN public.courses c ON c.curriculum_id = cp.curriculum_id
  JOIN public.modules m ON m.course_id = c.id
  JOIN public.lessons l ON l.module_id = m.id
  WHERE cp.status = 'published'
),
mc AS (
  SELECT lp.package_id, lp.package_title, lp.track, lp.curriculum_id,
         lp.lesson_id, lp.lesson_title, lp.competency_id,
         COUNT(mq.*) AS total,
         COUNT(*) FILTER (WHERE mq.status = 'approved') AS approved,
         COUNT(*) FILTER (WHERE mq.status IS DISTINCT FROM 'approved'
                          AND mq.status IS DISTINCT FROM 'archived_duplicate') AS unapproved,
         COUNT(*) FILTER (WHERE mq.status = 'archived_duplicate') AS archived
  FROM lesson_pkg lp
  LEFT JOIN public.minicheck_questions mq
         ON mq.lesson_id = lp.lesson_id
        AND mq.curriculum_id = lp.curriculum_id
        AND mq.mode = 'lesson'
  GROUP BY 1,2,3,4,5,6,7
)
SELECT mc.*,
       CASE WHEN total = 0 THEN 0
            ELSE ROUND( (approved::numeric / total::numeric) * 100, 1) END AS approval_pct,
       (mc.track IN ('AUSBILDUNG_VOLL','STUDIUM','UMSCHULUNG','WEITERBILDUNG_VOLL')) AS required_by_track
FROM mc;

REVOKE ALL ON public.v_mc_unapproved_per_package FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_mc_unapproved_per_package TO service_role;

INSERT INTO public.ops_job_type_registry
  (job_type, pool, lane, job_name, requires_package_id, is_governance, is_active, description)
VALUES
  ('package_repair_lesson_minichecks', 'content', 'content',
   'Package Repair Lesson Minichecks', true, false, true,
   'Soft-Drift Repair: archives unapproved MCs, re-enqueues generate + validate.')
ON CONFLICT (job_type) DO UPDATE
SET lane=EXCLUDED.lane, pool=EXCLUDED.pool, job_name=EXCLUDED.job_name,
    requires_package_id=EXCLUDED.requires_package_id, is_active=true,
    description=EXCLUDED.description, updated_at=now();

CREATE OR REPLACE FUNCTION public.admin_get_mc_unapproved_top(p_limit int DEFAULT 50)
RETURNS TABLE (
  package_id uuid, package_title text, track text,
  total bigint, approved bigint, unapproved bigint, archived bigint,
  approval_pct numeric, lessons_with_unapproved bigint, required_by_track boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT package_id, package_title, track,
         SUM(total)::bigint, SUM(approved)::bigint, SUM(unapproved)::bigint, SUM(archived)::bigint,
         CASE WHEN SUM(total)=0 THEN 0
              ELSE ROUND( SUM(approved)::numeric / NULLIF(SUM(total),0)::numeric * 100, 1) END,
         COUNT(*) FILTER (WHERE unapproved > 0)::bigint,
         bool_or(required_by_track)
  FROM public.v_mc_unapproved_per_package
  WHERE has_role(auth.uid(),'admin')
  GROUP BY package_id, package_title, track
  ORDER BY SUM(unapproved) DESC, SUM(total) DESC
  LIMIT GREATEST(1, COALESCE(p_limit, 50));
$$;

CREATE OR REPLACE FUNCTION public.admin_soft_drift_mc_repair(
  p_package_ids uuid[],
  p_apply boolean DEFAULT false
)
RETURNS TABLE (
  package_id uuid, package_title text, track text,
  unapproved_count bigint, approval_pct numeric,
  action text, job_id uuid, reason text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_admin boolean;
  v_pkg record;
  v_unapproved bigint;
  v_approval numeric;
  v_active_job uuid;
  v_new_job uuid;
BEGIN
  v_caller_admin := COALESCE(has_role(auth.uid(),'admin'), false)
                    OR (current_setting('role', true) IN ('service_role','postgres'));
  IF NOT v_caller_admin THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.track::text AS track, cp.curriculum_id
    FROM course_packages cp
    WHERE cp.id = ANY(p_package_ids)
      AND cp.status = 'published'
      AND cp.track <> 'EXAM_FIRST'
  LOOP
    SELECT SUM(unapproved),
           CASE WHEN SUM(total)=0 THEN 0
                ELSE ROUND(SUM(approved)::numeric / NULLIF(SUM(total),0)::numeric * 100, 1) END
      INTO v_unapproved, v_approval
    FROM public.v_mc_unapproved_per_package
    WHERE package_id = v_pkg.id;

    IF COALESCE(v_unapproved,0) = 0 THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := COALESCE(v_approval,0);
      action := 'skip'; job_id := NULL; reason := 'no_unapproved_mcs';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT id INTO v_active_job
    FROM job_queue
    WHERE (payload->>'package_id')::uuid = v_pkg.id
      AND job_type IN ('package_repair_lesson_minichecks',
                       'package_generate_lesson_minichecks',
                       'package_validate_lesson_minichecks')
      AND status IN ('pending','processing','batch_pending')
    LIMIT 1;

    IF v_active_job IS NOT NULL THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := v_unapproved; approval_pct := v_approval;
      action := 'skip'; job_id := v_active_job; reason := 'active_mc_job_exists';
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_apply THEN
      INSERT INTO job_queue (job_type, status, run_after, payload, meta, priority)
      VALUES (
        'package_repair_lesson_minichecks', 'pending', now(),
        jsonb_build_object(
          'package_id', v_pkg.id,
          'curriculum_id', v_pkg.curriculum_id,
          'mode','soft_drift_targeted_mc_repair',
          'target','unapproved_minichecks',
          'enqueue_source','soft_drift_mc_required_repair'
        ),
        jsonb_build_object(
          'wave','soft_drift_mc',
          'previous_mc_approval_pct', v_approval,
          'previous_unapproved_count', v_unapproved
        ),
        100
      ) RETURNING id INTO v_new_job;

      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES (
        'soft_drift_mc_required_repair', 'package', v_pkg.id, 'enqueued',
        jsonb_build_object('job_id', v_new_job, 'unapproved', v_unapproved, 'approval_pct', v_approval)
      );

      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := v_unapproved; approval_pct := v_approval;
      action := 'enqueued'; job_id := v_new_job; reason := 'package_repair_lesson_minichecks';
      RETURN NEXT;
    ELSE
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := v_unapproved; approval_pct := v_approval;
      action := 'dry_run'; job_id := NULL; reason := 'eligible_for_repair';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_soft_drift_mc_repair(uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_soft_drift_mc_repair(uuid[], boolean) TO service_role;
REVOKE ALL ON FUNCTION public.admin_get_mc_unapproved_top(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_mc_unapproved_top(int) TO service_role;

INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'soft_drift_mc_repair_v3_installed', 'system', 'success',
  jsonb_build_object(
    'view','v_mc_unapproved_per_package',
    'job_type','package_repair_lesson_minichecks',
    'rpc','admin_soft_drift_mc_repair → package_repair_lesson_minichecks'
  )
);
