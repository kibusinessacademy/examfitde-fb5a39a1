
-- Quality Shield v2: columns + recovery function (fix ORDER BY issue)

-- 1) Add confidence_score column to snapshots
ALTER TABLE public.production_quality_snapshots
  ADD COLUMN IF NOT EXISTS confidence_score int DEFAULT 100;

-- 2) Add provider-level quality columns
ALTER TABLE public.provider_performance
  ADD COLUMN IF NOT EXISTS near_duplicate_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_confidence_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_question_count int DEFAULT 0;

-- 3) Auto-recovery function (fixed syntax)
CREATE OR REPLACE FUNCTION public.quality_hold_resume(
  p_package_id uuid,
  p_action text DEFAULT 'admin_resume'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_recheck jsonb;
  v_job_id uuid;
BEGIN
  SELECT * INTO v_pkg FROM course_packages WHERE id = p_package_id;
  IF NOT FOUND THEN RETURN '{"error":"package_not_found"}'::jsonb; END IF;
  IF v_pkg.status != 'quality_hold' THEN
    RETURN jsonb_build_object('error', 'not_in_quality_hold', 'status', v_pkg.status);
  END IF;

  IF p_action = 'auto_recheck' THEN
    v_recheck := check_production_quality(p_package_id, v_pkg.curriculum_id);
    IF (v_recheck->>'paused')::bool THEN
      RETURN jsonb_build_object('resumed', false, 'reason', v_recheck->>'pause_reason', 'confidence', v_recheck->>'confidence_score');
    END IF;
  END IF;

  UPDATE course_packages SET status = 'building' WHERE id = p_package_id;

  -- Re-queue stuck step using subquery
  SELECT id INTO v_job_id FROM job_queue
  WHERE payload->>'package_id' = p_package_id::text
    AND status IN ('pending', 'failed')
  ORDER BY (payload->>'sequence')::int
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    UPDATE job_queue SET status = 'pending', run_after = now() WHERE id = v_job_id;
  END IF;

  RETURN jsonb_build_object('resumed', true, 'action', p_action);
END;
$$;

-- 4) Update check_production_quality v2 thresholds (warn 3%, stop 4.5%)
CREATE OR REPLACE FUNCTION public.check_production_quality(
  p_package_id uuid,
  p_curriculum_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total      int;
  v_dup_count  int;
  v_dup_rate   numeric;
  v_lf_count   int;
  v_lf_total   int;
  v_lf_cov     numeric;
  v_easy_pct   numeric;
  v_med_pct    numeric;
  v_hard_pct   numeric;
  v_low_conf   int;
  v_flags      text[] := '{}';
  v_pause      bool := false;
  v_pause_reason text := null;
  v_lf_detail  jsonb := '{}'::jsonb;
  v_confidence int := 100;
BEGIN
  SELECT count(*) INTO v_total FROM exam_questions WHERE curriculum_id = p_curriculum_id;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('total', 0, 'status', 'no_data');
  END IF;

  SELECT count(*) INTO v_dup_count FROM duplicate_detection_log
    WHERE curriculum_id = p_curriculum_id AND similarity_score > 0.82;
  v_dup_rate := round(100.0 * v_dup_count / v_total, 1);

  SELECT count(DISTINCT lf.id), (SELECT count(*) FROM curriculum_lernfelder WHERE curriculum_id = p_curriculum_id)
    INTO v_lf_count, v_lf_total
    FROM exam_questions eq
    JOIN curriculum_lernfelder lf ON lf.id = eq.lernfeld_id
    WHERE eq.curriculum_id = p_curriculum_id;
  v_lf_cov := CASE WHEN v_lf_total > 0 THEN round(100.0 * v_lf_count / v_lf_total, 0) ELSE 0 END;

  SELECT
    round(100.0 * count(*) FILTER (WHERE difficulty = 'easy') / count(*), 0),
    round(100.0 * count(*) FILTER (WHERE difficulty = 'medium') / count(*), 0),
    round(100.0 * count(*) FILTER (WHERE difficulty = 'hard') / count(*), 0)
    INTO v_easy_pct, v_med_pct, v_hard_pct
    FROM exam_questions WHERE curriculum_id = p_curriculum_id;

  SELECT count(*) INTO v_low_conf FROM exam_questions
    WHERE curriculum_id = p_curriculum_id AND quality_score < 60;

  SELECT jsonb_object_agg(sub.lf_name, jsonb_build_object(
    'count', sub.cnt, 'pct', sub.pct,
    'target_pct', sub.target_pct, 'deviation', sub.deviation
  )) INTO v_lf_detail
  FROM (
    SELECT
      lf.titel AS lf_name,
      count(eq.id) AS cnt,
      round(100.0 * count(eq.id) / NULLIF(v_total, 0), 1) AS pct,
      round(100.0 / NULLIF(v_lf_total, 0), 1) AS target_pct,
      round(abs(100.0 * count(eq.id) / NULLIF(v_total, 0) - 100.0 / NULLIF(v_lf_total, 0)), 1) AS deviation
    FROM curriculum_lernfelder lf
    LEFT JOIN exam_questions eq ON eq.lernfeld_id = lf.id AND eq.curriculum_id = p_curriculum_id
    WHERE lf.curriculum_id = p_curriculum_id
    GROUP BY lf.id, lf.titel
  ) sub;

  -- v2 thresholds: warn at 3%, hard stop at 4.5%
  IF v_dup_rate > 3 THEN v_flags := array_append(v_flags, 'DUPLICATE_WARNING_3PCT'); END IF;
  IF v_dup_rate > 4.5 THEN
    v_flags := array_append(v_flags, 'DUPLICATE_HARD_STOP');
    v_pause := true;
    v_pause_reason := coalesce(v_pause_reason, '') || 'Duplikat-Rate ' || v_dup_rate || '% > 4.5%. ';
  END IF;

  IF v_lf_cov < 80 THEN v_flags := array_append(v_flags, 'LF_COVERAGE_LOW'); END IF;
  IF v_lf_cov < 70 THEN
    v_pause := true;
    v_pause_reason := coalesce(v_pause_reason, '') || 'LF-Coverage ' || v_lf_cov || '% < 70%. ';
  END IF;

  IF v_hard_pct < 15 THEN v_flags := array_append(v_flags, 'HARD_QUESTIONS_LOW'); END IF;
  IF v_hard_pct < 10 THEN
    v_pause := true;
    v_pause_reason := coalesce(v_pause_reason, '') || 'Hard-Fragen nur ' || v_hard_pct || '%. ';
  END IF;

  IF v_low_conf > v_total * 0.15 THEN
    v_flags := array_append(v_flags, 'HIGH_LOW_CONFIDENCE');
  END IF;

  -- Confidence score 0-100
  v_confidence := 100;
  v_confidence := v_confidence - LEAST(30, round(v_dup_rate * 6)::int);
  v_confidence := v_confidence - LEAST(20, GREATEST(0, round((100 - v_lf_cov) * 0.4)::int));
  v_confidence := v_confidence - LEAST(15, GREATEST(0, round(abs(v_hard_pct - 20) * 0.5)::int));
  v_confidence := v_confidence - LEAST(10, round(v_low_conf::numeric / NULLIF(v_total, 0) * 100)::int);
  v_confidence := GREATEST(0, v_confidence);

  IF v_pause THEN
    UPDATE course_packages SET status = 'quality_hold'
    WHERE id = p_package_id AND status = 'building';
  END IF;

  INSERT INTO production_quality_snapshots (
    package_id, total_questions, duplicate_rate, lf_coverage_pct,
    difficulty_easy_pct, difficulty_medium_pct, difficulty_hard_pct,
    low_confidence_count, lf_detail, flags, auto_paused, pause_reason, confidence_score
  ) VALUES (
    p_package_id, v_total, v_dup_rate, v_lf_cov,
    v_easy_pct, v_med_pct, v_hard_pct,
    v_low_conf, v_lf_detail, v_flags, v_pause, v_pause_reason, v_confidence
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'duplicate_rate', v_dup_rate,
    'lf_coverage', v_lf_cov,
    'difficulty', jsonb_build_object('easy', v_easy_pct, 'medium', v_med_pct, 'hard', v_hard_pct),
    'low_confidence', v_low_conf,
    'confidence_score', v_confidence,
    'flags', to_jsonb(v_flags),
    'paused', v_pause,
    'pause_reason', v_pause_reason
  );
END;
$$;
