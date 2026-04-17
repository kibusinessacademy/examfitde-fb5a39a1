
-- 1. History table for integrity check results
CREATE TABLE IF NOT EXISTS public.integrity_check_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  curriculum_id uuid,
  score integer,
  passed boolean NOT NULL DEFAULT false,
  hard_fail_count integer NOT NULL DEFAULT 0,
  hard_fail_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  trigger_source text,
  job_id uuid,
  no_progress_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integrity_history_pkg_created
  ON public.integrity_check_history (package_id, created_at DESC);

ALTER TABLE public.integrity_check_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read integrity history" ON public.integrity_check_history;
CREATE POLICY "Admins can read integrity history"
  ON public.integrity_check_history
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role insert integrity history" ON public.integrity_check_history;
CREATE POLICY "Service role insert integrity history"
  ON public.integrity_check_history
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 2. Record + check function
CREATE OR REPLACE FUNCTION public.fn_record_integrity_run_and_check_progress(
  p_package_id uuid,
  p_curriculum_id uuid,
  p_score integer,
  p_passed boolean,
  p_hard_fails text[],
  p_trigger_source text DEFAULT NULL,
  p_job_id uuid DEFAULT NULL,
  p_min_improvement integer DEFAULT 3,
  p_window integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_history_id uuid;
  v_recent_scores integer[];
  v_max_recent integer;
  v_min_recent integer;
  v_no_progress boolean := false;
  v_pkg_status text;
  v_pkg_published_at timestamptz;
BEGIN
  -- Insert current run
  INSERT INTO public.integrity_check_history
    (package_id, curriculum_id, score, passed, hard_fail_count, hard_fail_reasons, trigger_source, job_id)
  VALUES
    (p_package_id, p_curriculum_id, p_score, p_passed, COALESCE(array_length(p_hard_fails,1),0), COALESCE(p_hard_fails, ARRAY[]::text[]), p_trigger_source, p_job_id)
  RETURNING id INTO v_history_id;

  -- If passed, no-progress check is irrelevant
  IF p_passed THEN
    RETURN jsonb_build_object(
      'history_id', v_history_id,
      'no_progress_block', false,
      'reason', 'passed'
    );
  END IF;

  -- Skip guard for already published packages (depublish protection lives elsewhere)
  SELECT status, published_at INTO v_pkg_status, v_pkg_published_at
    FROM public.course_packages WHERE id = p_package_id;
  IF v_pkg_status = 'published' OR v_pkg_published_at IS NOT NULL THEN
    RETURN jsonb_build_object('history_id', v_history_id, 'no_progress_block', false, 'reason', 'published_skip');
  END IF;

  -- Pull last p_window FAILED runs (incl. the just-inserted one)
  SELECT array_agg(score ORDER BY created_at DESC)
    INTO v_recent_scores
  FROM (
    SELECT score, created_at
      FROM public.integrity_check_history
     WHERE package_id = p_package_id
       AND passed = false
       AND score IS NOT NULL
     ORDER BY created_at DESC
     LIMIT p_window
  ) t;

  IF v_recent_scores IS NULL OR array_length(v_recent_scores, 1) < p_window THEN
    RETURN jsonb_build_object(
      'history_id', v_history_id,
      'no_progress_block', false,
      'reason', 'insufficient_history',
      'runs_in_window', COALESCE(array_length(v_recent_scores, 1), 0)
    );
  END IF;

  v_max_recent := (SELECT max(s) FROM unnest(v_recent_scores) s);
  v_min_recent := (SELECT min(s) FROM unnest(v_recent_scores) s);

  -- No progress = score range across last N runs is < min_improvement
  IF (v_max_recent - v_min_recent) < p_min_improvement THEN
    v_no_progress := true;

    UPDATE public.integrity_check_history
       SET no_progress_blocked = true
     WHERE id = v_history_id;

    UPDATE public.course_packages
       SET status = 'blocked',
           blocked_reason = 'quality_no_progress_3x',
           updated_at = now()
     WHERE id = p_package_id
       AND status <> 'published'
       AND published_at IS NULL;

    -- Cancel all pending repair + integrity loop jobs for this package
    UPDATE public.job_queue
       SET status = 'cancelled',
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
             'cancel_reason', 'quality_no_progress_3x',
             'cancel_source', 'fn_record_integrity_run_and_check_progress',
             'cancelled_at', now()
           ),
           updated_at = now()
     WHERE package_id = p_package_id
       AND status IN ('pending','processing')
       AND job_type IN (
         'package_run_integrity_check',
         'package_repair_exam_pool_quality',
         'package_repair_exam_pool',
         'package_validate_exam_pool'
       );

    INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
    VALUES (
      '🛑 No-Progress-Guard: Quality stagnation',
      format('Package %s: %s consecutive integrity runs without score improvement (range=%s, scores=%s). Status set to blocked, repair jobs cancelled. Manual review required.',
        substr(p_package_id::text, 1, 8),
        p_window,
        (v_max_recent - v_min_recent),
        v_recent_scores::text),
      'quality',
      'error',
      'course_package',
      p_package_id,
      jsonb_build_object(
        'recent_scores', v_recent_scores,
        'window', p_window,
        'min_improvement', p_min_improvement,
        'hard_fails_latest', p_hard_fails
      )
    );

    INSERT INTO public.admin_actions (action, scope, affected_ids, payload, created_at)
    VALUES (
      'auto_block_no_progress_quality_threshold',
      'course_packages',
      ARRAY[p_package_id::text],
      jsonb_build_object(
        'history_id', v_history_id,
        'recent_scores', v_recent_scores,
        'window', p_window,
        'min_improvement', p_min_improvement,
        'reason', 'no integrity score improvement across window'
      ),
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'history_id', v_history_id,
    'no_progress_block', v_no_progress,
    'recent_scores', v_recent_scores,
    'score_range', v_max_recent - v_min_recent,
    'window', p_window,
    'min_improvement', p_min_improvement
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_record_integrity_run_and_check_progress(uuid,uuid,integer,boolean,text[],text,uuid,integer,integer) TO service_role;
