
-- ══════════════════════════════════════════════════════
-- QUALITY SHIELD v1: Production Guardrails + Provider Tracking
-- ══════════════════════════════════════════════════════

-- 1) Production Quality Snapshots (taken every ~200 questions)
CREATE TABLE IF NOT EXISTS public.production_quality_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id),
  curriculum_id uuid NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  total_questions int NOT NULL DEFAULT 0,
  duplicate_rate numeric(5,2) NOT NULL DEFAULT 0,
  lf_coverage_pct numeric(5,2) NOT NULL DEFAULT 0,
  difficulty_easy_pct numeric(5,2) NOT NULL DEFAULT 0,
  difficulty_medium_pct numeric(5,2) NOT NULL DEFAULT 0,
  difficulty_hard_pct numeric(5,2) NOT NULL DEFAULT 0,
  low_confidence_count int NOT NULL DEFAULT 0,
  lf_detail jsonb DEFAULT '{}',
  flags text[] DEFAULT '{}',
  auto_paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.production_quality_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_pqs" ON public.production_quality_snapshots FOR ALL TO service_role USING (true);
CREATE POLICY "admin_read_pqs" ON public.production_quality_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_pqs_package ON public.production_quality_snapshots(package_id, snapshot_at DESC);

-- 2) Provider Performance Tracking (aggregated per provider per day)
CREATE TABLE IF NOT EXISTS public.provider_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  provider text NOT NULL,
  model text,
  total_calls int NOT NULL DEFAULT 0,
  success_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  avg_latency_ms numeric(10,2) DEFAULT 0,
  avg_tokens_out numeric(10,2) DEFAULT 0,
  near_duplicate_rate numeric(5,3) DEFAULT 0,
  hallucination_flags int NOT NULL DEFAULT 0,
  total_cost_eur numeric(10,4) DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date, provider, model)
);

ALTER TABLE public.provider_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_pp" ON public.provider_performance FOR ALL TO service_role USING (true);
CREATE POLICY "admin_read_pp" ON public.provider_performance FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Duplicate Detection Results
CREATE TABLE IF NOT EXISTS public.duplicate_detection_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id),
  question_a_id uuid NOT NULL,
  question_b_id uuid NOT NULL,
  similarity_score numeric(5,3) NOT NULL,
  detection_method text NOT NULL DEFAULT 'trigram',
  auto_blocked boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.duplicate_detection_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_ddl" ON public.duplicate_detection_log FOR ALL TO service_role USING (true);
CREATE POLICY "admin_read_ddl" ON public.duplicate_detection_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_ddl_package ON public.duplicate_detection_log(package_id, created_at DESC);
CREATE INDEX idx_ddl_score ON public.duplicate_detection_log(similarity_score DESC);

-- 4) RPC: Production Quality Check (called every ~200 questions)
CREATE OR REPLACE FUNCTION public.check_production_quality(
  p_package_id uuid,
  p_curriculum_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_dup_rate numeric;
  v_lf_coverage numeric;
  v_easy_pct numeric;
  v_medium_pct numeric;
  v_hard_pct numeric;
  v_low_conf int;
  v_lf_detail jsonb;
  v_flags text[] := '{}';
  v_pause boolean := false;
  v_pause_reason text;
  v_total_lf int;
  v_covered_lf int;
BEGIN
  -- Total questions
  SELECT count(*) INTO v_total
  FROM exam_questions WHERE curriculum_id = p_curriculum_id;

  IF v_total < 50 THEN
    RETURN jsonb_build_object('skip', true, 'reason', 'too_few_questions', 'total', v_total);
  END IF;

  -- Difficulty distribution
  SELECT
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'easy') / NULLIF(count(*), 0), 1),
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'medium') / NULLIF(count(*), 0), 1),
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'hard') / NULLIF(count(*), 0), 1),
    count(*) FILTER (WHERE validation_score IS NOT NULL AND validation_score < 0.6)
  INTO v_easy_pct, v_medium_pct, v_hard_pct, v_low_conf
  FROM exam_questions WHERE curriculum_id = p_curriculum_id;

  -- LF Coverage
  SELECT count(DISTINCT id) INTO v_total_lf
  FROM curriculum_lernfelder WHERE curriculum_id = p_curriculum_id;

  SELECT count(DISTINCT lernfeld_id) INTO v_covered_lf
  FROM exam_questions WHERE curriculum_id = p_curriculum_id AND lernfeld_id IS NOT NULL;

  v_lf_coverage := CASE WHEN v_total_lf > 0 
    THEN ROUND(100.0 * v_covered_lf / v_total_lf, 1) ELSE 100 END;

  -- LF detail breakdown
  SELECT jsonb_object_agg(
    COALESCE(cl.name, cl.id::text),
    jsonb_build_object(
      'count', COALESCE(eq.cnt, 0),
      'pct', CASE WHEN v_total > 0 THEN ROUND(100.0 * COALESCE(eq.cnt, 0) / v_total, 1) ELSE 0 END
    )
  ) INTO v_lf_detail
  FROM curriculum_lernfelder cl
  LEFT JOIN (
    SELECT lernfeld_id, count(*) as cnt 
    FROM exam_questions WHERE curriculum_id = p_curriculum_id 
    GROUP BY lernfeld_id
  ) eq ON eq.lernfeld_id = cl.id
  WHERE cl.curriculum_id = p_curriculum_id;

  -- Duplicate rate (trigram-based, sample last 200)
  WITH recent AS (
    SELECT id, question_text 
    FROM exam_questions 
    WHERE curriculum_id = p_curriculum_id 
    ORDER BY created_at DESC LIMIT 200
  ),
  pairs AS (
    SELECT a.id as aid, b.id as bid, similarity(a.question_text, b.question_text) as sim
    FROM recent a, recent b 
    WHERE a.id < b.id AND similarity(a.question_text, b.question_text) > 0.82
  )
  SELECT ROUND(100.0 * count(*) / NULLIF((SELECT count(*) FROM recent), 0), 2)
  INTO v_dup_rate FROM pairs;

  v_dup_rate := COALESCE(v_dup_rate, 0);

  -- Auto-block high duplicates
  INSERT INTO duplicate_detection_log (package_id, question_a_id, question_b_id, similarity_score, detection_method, auto_blocked)
  SELECT p_package_id, a.id, b.id, similarity(a.question_text, b.question_text), 'trigram_auto', true
  FROM exam_questions a, exam_questions b
  WHERE a.curriculum_id = p_curriculum_id
    AND b.curriculum_id = p_curriculum_id
    AND a.id < b.id
    AND similarity(a.question_text, b.question_text) > 0.82
    AND a.created_at > now() - interval '1 hour'
  ON CONFLICT DO NOTHING;

  -- Build flags
  IF v_dup_rate > 4 THEN v_flags := v_flags || 'DUPLICATE_HIGH'; END IF;
  IF v_lf_coverage < 85 THEN v_flags := v_flags || 'LF_COVERAGE_LOW'; END IF;
  IF v_hard_pct < 15 THEN v_flags := v_flags || 'HARD_QUESTIONS_LOW'; END IF;
  IF v_low_conf > v_total * 0.1 THEN v_flags := v_flags || 'LOW_CONFIDENCE_HIGH'; END IF;

  -- Auto-pause logic
  IF v_dup_rate > 6 OR v_lf_coverage < 70 THEN
    v_pause := true;
    v_pause_reason := 'Critical quality threshold breached: dup=' || v_dup_rate || '%, lf=' || v_lf_coverage || '%';
  END IF;

  -- Save snapshot
  INSERT INTO production_quality_snapshots (
    package_id, curriculum_id, total_questions, duplicate_rate, lf_coverage_pct,
    difficulty_easy_pct, difficulty_medium_pct, difficulty_hard_pct,
    low_confidence_count, lf_detail, flags, auto_paused, pause_reason
  ) VALUES (
    p_package_id, p_curriculum_id, v_total, v_dup_rate, v_lf_coverage,
    v_easy_pct, v_medium_pct, v_hard_pct,
    v_low_conf, v_lf_detail, v_flags, v_pause, v_pause_reason
  );

  -- If auto-pause, mark package
  IF v_pause THEN
    UPDATE course_packages SET status = 'quality_hold' WHERE id = p_package_id AND status = 'building';
  END IF;

  RETURN jsonb_build_object(
    'total', v_total,
    'duplicate_rate', v_dup_rate,
    'lf_coverage', v_lf_coverage,
    'difficulty', jsonb_build_object('easy', v_easy_pct, 'medium', v_medium_pct, 'hard', v_hard_pct),
    'low_confidence', v_low_conf,
    'flags', to_jsonb(v_flags),
    'auto_paused', v_pause,
    'pause_reason', v_pause_reason,
    'lf_detail', v_lf_detail
  );
END;
$$;

-- 5) Enable pg_trgm if not already (needed for similarity())
CREATE EXTENSION IF NOT EXISTS pg_trgm;
