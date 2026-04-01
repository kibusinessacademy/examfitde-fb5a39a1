
-- 1) Function: Auto-reject orphan draft questions without competency_id after 2h grace
CREATE OR REPLACE FUNCTION public.reap_orphan_draft_questions(p_grace_hours int DEFAULT 2, p_limit int DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rejected_count int;
  v_cutoff timestamptz;
BEGIN
  v_cutoff := now() - (p_grace_hours || ' hours')::interval;
  
  WITH rejected AS (
    UPDATE exam_questions
    SET status = 'rejected'
    WHERE status = 'draft'
      AND competency_id IS NULL
      AND created_at < v_cutoff
    RETURNING id, curriculum_id
  )
  SELECT count(*) INTO v_rejected_count FROM rejected;
  
  -- Log to auto_heal_log for observability
  IF v_rejected_count > 0 THEN
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
    VALUES (
      'reap_orphan_drafts',
      'scheduled',
      'exam_questions',
      'success',
      v_rejected_count || ' orphan drafts rejected (no competency_id, >' || p_grace_hours || 'h)',
      jsonb_build_object('rejected_count', v_rejected_count, 'grace_hours', p_grace_hours)
    );
  END IF;
  
  RETURN jsonb_build_object('rejected_count', v_rejected_count, 'cutoff', v_cutoff);
END;
$$;

-- 2) Function: Auto-complete stale pending council sessions after 4h
CREATE OR REPLACE FUNCTION public.reap_stale_council_sessions(p_grace_hours int DEFAULT 4, p_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed_count int;
  v_cutoff timestamptz;
  v_package_ids uuid[];
BEGIN
  v_cutoff := now() - (p_grace_hours || ' hours')::interval;
  
  WITH completed AS (
    UPDATE council_sessions
    SET status = 'completed',
        decision = COALESCE(decision, 'auto-completed by stale session reaper')
    WHERE status = 'pending'
      AND created_at < v_cutoff
    RETURNING id, package_id
  )
  SELECT count(*), array_agg(DISTINCT package_id) 
  INTO v_completed_count, v_package_ids
  FROM completed;
  
  -- Log for observability
  IF v_completed_count > 0 THEN
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
    VALUES (
      'reap_stale_council_sessions',
      'scheduled',
      'council_sessions',
      'success',
      v_completed_count || ' stale pending sessions completed (>' || p_grace_hours || 'h)',
      jsonb_build_object('completed_count', v_completed_count, 'grace_hours', p_grace_hours, 'package_ids', v_package_ids)
    );
  END IF;
  
  RETURN jsonb_build_object('completed_count', v_completed_count, 'package_count', coalesce(array_length(v_package_ids, 1), 0), 'cutoff', v_cutoff);
END;
$$;

-- 3) View: Detect orphan drafts for monitoring (used by nightly audit + admin UI)
CREATE OR REPLACE VIEW public.ops_orphan_draft_questions AS
SELECT 
  eq.curriculum_id,
  c.title AS curriculum_title,
  count(*) AS orphan_count,
  min(eq.created_at) AS oldest_created_at,
  max(eq.created_at) AS newest_created_at,
  round(extract(epoch FROM (now() - min(eq.created_at))) / 3600)::int AS oldest_age_hours
FROM exam_questions eq
JOIN curricula c ON c.id = eq.curriculum_id
WHERE eq.status = 'draft' AND eq.competency_id IS NULL
GROUP BY eq.curriculum_id, c.title;

-- 4) View: Detect stale council sessions for monitoring
CREATE OR REPLACE VIEW public.ops_stale_council_sessions AS
SELECT 
  cs.package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  count(*) AS pending_count,
  min(cs.created_at) AS oldest_pending_at,
  round(extract(epoch FROM (now() - min(cs.created_at))) / 3600)::int AS oldest_age_hours
FROM council_sessions cs
JOIN course_packages cp ON cp.id = cs.package_id
WHERE cs.status = 'pending'
GROUP BY cs.package_id, cp.title, cp.status;

-- 5) View: Detect churn loops (council pending + quality_council step not done)
CREATE OR REPLACE VIEW public.ops_council_churn_loops AS
SELECT 
  ps.package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  ps.status AS step_status,
  ps.attempts AS step_attempts,
  (SELECT count(*) FROM council_sessions cs WHERE cs.package_id = ps.package_id AND cs.status = 'pending') AS pending_sessions,
  (SELECT count(*) FROM council_sessions cs WHERE cs.package_id = ps.package_id AND cs.status = 'processing') AS processing_sessions,
  (SELECT min(cs.created_at) FROM council_sessions cs WHERE cs.package_id = ps.package_id AND cs.status = 'pending') AS oldest_pending_at
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.step_key = 'quality_council'
  AND ps.status NOT IN ('done', 'skipped')
  AND EXISTS (SELECT 1 FROM council_sessions cs WHERE cs.package_id = ps.package_id AND cs.status = 'pending');

-- Secure views for service_role only
REVOKE SELECT ON public.ops_orphan_draft_questions FROM anon, authenticated;
REVOKE SELECT ON public.ops_stale_council_sessions FROM anon, authenticated;
REVOKE SELECT ON public.ops_council_churn_loops FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
