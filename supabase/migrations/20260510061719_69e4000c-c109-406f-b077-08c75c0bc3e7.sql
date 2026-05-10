
-- ── 1. Fix admin_soft_drift_mc_repair (drop batch_pending, richer no-op reasons) ──
DROP FUNCTION IF EXISTS public.admin_soft_drift_mc_repair(uuid[], boolean);

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
  v_lessons_total bigint;
BEGIN
  v_caller_admin := COALESCE(has_role(auth.uid(),'admin'), false)
                    OR (current_setting('role', true) IN ('service_role','postgres'));
  IF NOT v_caller_admin THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.track::text AS track, cp.curriculum_id, cp.status::text AS status
    FROM course_packages cp
    WHERE cp.id = ANY(p_package_ids)
  LOOP
    -- Filter 1: status
    IF v_pkg.status <> 'published' THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := 0;
      action := 'skip'; job_id := NULL; reason := 'package_not_published:' || v_pkg.status;
      RETURN NEXT; CONTINUE;
    END IF;

    -- Filter 2: track
    IF v_pkg.track = 'EXAM_FIRST' THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := 0;
      action := 'skip'; job_id := NULL; reason := 'track_not_applicable_exam_first';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_lessons_total
    FROM v_mc_unapproved_per_package v
    WHERE v.package_id = v_pkg.id;

    IF v_lessons_total = 0 THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := 0;
      action := 'skip'; job_id := NULL; reason := 'no_lessons_in_package';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT SUM(unapproved),
           CASE WHEN SUM(total)=0 THEN 0
                ELSE ROUND(SUM(approved)::numeric / NULLIF(SUM(total),0)::numeric * 100, 1) END
      INTO v_unapproved, v_approval
    FROM public.v_mc_unapproved_per_package
    WHERE v_mc_unapproved_per_package.package_id = v_pkg.id;

    IF COALESCE(v_unapproved,0) = 0 THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := COALESCE(v_approval,0);
      action := 'skip'; job_id := NULL; reason := 'no_unapproved_mcs';
      RETURN NEXT; CONTINUE;
    END IF;

    -- Dedup: only valid statuses
    SELECT id INTO v_active_job
    FROM job_queue
    WHERE (payload->>'package_id')::uuid = v_pkg.id
      AND job_type IN ('package_repair_lesson_minichecks',
                       'package_generate_lesson_minichecks',
                       'package_validate_lesson_minichecks')
      AND status IN ('pending','processing')
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
      -- Dry-run: log to audit too so the diagnostic decision is auditable
      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES (
        'soft_drift_mc_required_repair_dryrun', 'package', v_pkg.id, 'eligible',
        jsonb_build_object('unapproved', v_unapproved, 'approval_pct', v_approval)
      );
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := v_unapproved; approval_pct := v_approval;
      action := 'dry_run'; job_id := NULL; reason := 'eligible_for_repair';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_soft_drift_mc_repair(uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_soft_drift_mc_repair(uuid[], boolean) TO service_role, authenticated;

-- ── 2. Job-Type ↔ Worker Audit RPC ──
CREATE OR REPLACE FUNCTION public.admin_get_job_type_worker_audit()
RETURNS TABLE (
  job_type text, lane text, pool text, is_governance boolean, requires_package_id boolean,
  jobs_7d bigint, done_7d bigint, failed_7d bigint, open_now bigint,
  last_seen_at timestamptz, last_completed_at timestamptz,
  worker_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (COALESCE(has_role(auth.uid(),'admin'), false)
          OR current_setting('role', true) IN ('service_role','postgres')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT jq.job_type,
           COUNT(*) FILTER (WHERE jq.created_at > now() - interval '7 days') AS jobs_7d,
           COUNT(*) FILTER (WHERE jq.status='completed' AND jq.completed_at > now() - interval '7 days') AS done_7d,
           COUNT(*) FILTER (WHERE jq.status='failed'    AND jq.completed_at > now() - interval '7 days') AS failed_7d,
           COUNT(*) FILTER (WHERE jq.status IN ('pending','processing')) AS open_now,
           MAX(jq.created_at)   AS last_seen_at,
           MAX(jq.completed_at) FILTER (WHERE jq.status='completed') AS last_completed_at
    FROM job_queue jq
    GROUP BY jq.job_type
  )
  SELECT r.job_type, r.lane, r.pool, r.is_governance, r.requires_package_id,
         COALESCE(s.jobs_7d, 0), COALESCE(s.done_7d, 0),
         COALESCE(s.failed_7d, 0), COALESCE(s.open_now, 0),
         s.last_seen_at, s.last_completed_at,
         CASE
           WHEN s.last_seen_at IS NULL                                       THEN 'NEVER_SEEN'
           WHEN COALESCE(s.failed_7d,0) > 0
                AND COALESCE(s.done_7d,0) = 0                                THEN 'FAILING_ONLY'
           WHEN COALESCE(s.jobs_7d,0) = 0
                AND s.last_seen_at < now() - interval '30 days'              THEN 'IDLE_30D'
           WHEN COALESCE(s.jobs_7d,0) = 0                                    THEN 'IDLE_7D'
           WHEN COALESCE(s.failed_7d,0) > COALESCE(s.done_7d,0)              THEN 'FAILING_DEGRADED'
           ELSE 'HEALTHY'
         END AS worker_status
  FROM ops_job_type_registry r
  LEFT JOIN stats s ON s.job_type = r.job_type
  WHERE r.is_active = true
  ORDER BY r.lane, r.job_type;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_job_type_worker_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_job_type_worker_audit() TO service_role, authenticated;

INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('soft_drift_mc_repair_v4_corrections', 'system', 'success',
        jsonb_build_object(
          'fix','removed batch_pending; richer noop reasons; dry-run audit insert',
          'new_rpc','admin_get_job_type_worker_audit'
        ));
