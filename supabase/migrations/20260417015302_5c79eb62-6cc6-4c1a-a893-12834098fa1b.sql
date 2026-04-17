-- Phase 6 Fix: with allowed taxonomy reasons

CREATE OR REPLACE VIEW public.v_runner_idle_anomaly AS
WITH last_30min AS (
  SELECT
    runner_name,
    SUM(succeeded) AS total_succeeded,
    SUM(claimed)   AS total_claimed,
    SUM(failed)    AS total_failed,
    COUNT(*)       AS heartbeats,
    MAX(created_at) AS last_seen
  FROM public.runner_health_log
  WHERE created_at > now() - interval '30 minutes'
  GROUP BY runner_name
),
queue_state AS (
  SELECT
    COUNT(*) FILTER (WHERE status='pending')     AS pending_jobs,
    COUNT(*) FILTER (WHERE status='processing')  AS processing_jobs
  FROM public.job_queue
)
SELECT
  l.runner_name,
  l.heartbeats,
  l.total_claimed,
  l.total_succeeded,
  l.total_failed,
  q.pending_jobs,
  q.processing_jobs,
  EXTRACT(EPOCH FROM (now() - l.last_seen))::int AS seconds_since_last_heartbeat,
  CASE
    WHEN l.total_succeeded = 0 AND l.total_claimed > 0
      THEN 'IDLE_ALL_FAILING'
    WHEN l.total_claimed = 0 AND q.pending_jobs > 0 AND l.heartbeats >= 5
      THEN 'IDLE_NOT_CLAIMING'
    WHEN l.total_claimed = 0 AND q.pending_jobs = 0
      THEN 'IDLE_QUEUE_EMPTY'
    ELSE 'HEALTHY'
  END AS anomaly_class
FROM last_30min l
CROSS JOIN queue_state q;

COMMENT ON VIEW public.v_runner_idle_anomaly IS
  'Detects RUNNER_IDLE patterns: alive but 0 completions, or alive+jobs available but not claiming.';

-- Drift promoter
CREATE OR REPLACE FUNCTION public.auto_promote_status_drift(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_promoted int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_release_class text;
BEGIN
  FOR v_rec IN
    SELECT cp.id AS package_id,
           cp.status AS current_status,
           ps_total.total_steps,
           ps_done.done_steps
    FROM course_packages cp
    JOIN LATERAL (
      SELECT count(*) AS total_steps FROM package_steps WHERE package_id = cp.id
    ) ps_total ON TRUE
    JOIN LATERAL (
      SELECT count(*) AS done_steps FROM package_steps
      WHERE package_id = cp.id AND status IN ('done','skipped')
    ) ps_done ON TRUE
    WHERE cp.status = 'building'
      AND ps_total.total_steps > 0
      AND ps_total.total_steps = ps_done.done_steps
    ORDER BY cp.updated_at ASC
    LIMIT p_limit
  LOOP
    SELECT release_class INTO v_release_class
      FROM v_package_release_classification
      WHERE package_id = v_rec.package_id;

    IF v_release_class = 'release_ok' THEN
      UPDATE course_packages
        SET status='published', published_at = COALESCE(published_at, now()),
            updated_at = now()
        WHERE id = v_rec.package_id;
      v_promoted := v_promoted + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_rec.package_id, 'action', 'promoted_to_published',
        'release_class', v_release_class
      );
    ELSE
      -- Use allowed taxonomy: content_gap (LF/Q deficits), pipeline_repair_required (other)
      UPDATE course_packages
        SET status='blocked',
            blocked_reason = CASE
              WHEN v_release_class='release_block' THEN 'content_gap'
              ELSE 'pipeline_repair_required'
            END,
            updated_at = now()
        WHERE id = v_rec.package_id;
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_rec.package_id, 'action', 'marked_blocked',
        'release_class', v_release_class
      );
    END IF;
  END LOOP;

  IF v_promoted > 0 OR v_skipped > 0 THEN
    INSERT INTO admin_actions(action, scope, payload)
    VALUES('auto_promote_status_drift', 'course_packages',
      jsonb_build_object('promoted', v_promoted, 'skipped', v_skipped, 'results', v_results));
  END IF;

  RETURN jsonb_build_object('promoted', v_promoted, 'skipped', v_skipped, 'details', v_results);
END
$$;

COMMENT ON FUNCTION public.auto_promote_status_drift IS
  'Promotes packages with all steps done/skipped to published (release_ok) or marks blocked using allowed taxonomy.';

-- Auto-resume backlog
CREATE OR REPLACE FUNCTION public.auto_resume_blocked_with_progress(p_limit int DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_resumed int := 0;
  v_results jsonb := '[]'::jsonb;
  v_active_builds int;
  v_wip_cap int := 8;
BEGIN
  SELECT count(*) INTO v_active_builds FROM course_packages WHERE status='building';
  IF v_active_builds >= v_wip_cap THEN
    RETURN jsonb_build_object('resumed', 0, 'reason', 'wip_full',
      'active_builds', v_active_builds, 'wip_cap', v_wip_cap);
  END IF;

  FOR v_rec IN
    SELECT vrc.package_id, vrc.release_class, vrc.approved_questions
    FROM v_package_release_classification vrc
    JOIN course_packages cp ON cp.id = vrc.package_id
    LEFT JOIN v_package_build_priority vbp ON vbp.package_id = vrc.package_id
    WHERE vrc.package_status = 'blocked'
      AND vrc.release_class IN ('release_ok','release_warn')
      AND coalesce(cp.blocked_reason,'') NOT IN ('content_gap','admin_hold','manual_review_required','compliance_hold')
    ORDER BY vbp.effective_priority DESC NULLS LAST, vrc.approved_questions DESC
    LIMIT LEAST(p_limit, v_wip_cap - v_active_builds)
  LOOP
    UPDATE course_packages
      SET status = CASE WHEN v_rec.release_class='release_ok' THEN 'published' ELSE 'building' END,
          published_at = CASE WHEN v_rec.release_class='release_ok' THEN now() ELSE published_at END,
          blocked_reason = NULL,
          updated_at = now()
      WHERE id = v_rec.package_id;
    v_resumed := v_resumed + 1;
    v_results := v_results || jsonb_build_object(
      'package_id', v_rec.package_id, 'release_class', v_rec.release_class,
      'new_status', CASE WHEN v_rec.release_class='release_ok' THEN 'published' ELSE 'building' END
    );
  END LOOP;

  IF v_resumed > 0 THEN
    INSERT INTO admin_actions(action, scope, payload)
    VALUES('auto_resume_blocked_with_progress', 'course_packages',
      jsonb_build_object('resumed', v_resumed, 'results', v_results));
  END IF;

  RETURN jsonb_build_object('resumed', v_resumed, 'wip', v_active_builds, 'details', v_results);
END
$$;

COMMENT ON FUNCTION public.auto_resume_blocked_with_progress IS
  'Resumes blocked packages whose release_class improved to release_ok/warn. Respects WIP cap of 8.';

-- Sofort-Sweep mit erlaubten reasons
DO $$
DECLARE
  v_drift_result jsonb;
  v_resume_result jsonb;
BEGIN
  -- Immobilienverwalter: Handbook 500 erschöpft → content_gap
  UPDATE course_packages
    SET status='blocked', blocked_reason='content_gap', updated_at=now()
    WHERE id='d2000000-0011-4000-8000-000000000001' AND status <> 'blocked';

  v_drift_result := public.auto_promote_status_drift(20);
  RAISE NOTICE 'Drift promote: %', v_drift_result;

  v_resume_result := public.auto_resume_blocked_with_progress(5);
  RAISE NOTICE 'Resume: %', v_resume_result;

  INSERT INTO admin_actions(action, scope, payload)
  VALUES('phase6_runner_idle_drift_sweep', 'system',
    jsonb_build_object('drift', v_drift_result, 'resume', v_resume_result));
END $$;