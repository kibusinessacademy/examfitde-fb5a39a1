
-- Phase 1: Extend user_skill_scores for multi-source mastery
ALTER TABLE public.user_skill_scores
  ADD COLUMN IF NOT EXISTS exam_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minicheck_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repetition_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decay_adjusted_mastery numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_exam_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_minicheck_at timestamptz,
  ADD COLUMN IF NOT EXISTS minicheck_attempts int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minicheck_correct int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mastery_status text DEFAULT 'not_mastered';

-- Backfill existing rows: set exam_score from current mastery_pct
UPDATE public.user_skill_scores
SET exam_score = COALESCE(mastery_pct, 0),
    decay_adjusted_mastery = COALESCE(mastery_pct, 0),
    mastery_status = CASE
      WHEN COALESCE(mastery_pct, 0) >= 80 THEN 'mastered'
      WHEN COALESCE(mastery_pct, 0) >= 60 THEN 'partial'
      ELSE 'not_mastered'
    END,
    confidence = CASE WHEN COALESCE(attempts, 0) >= 20 THEN 1 ELSE COALESCE(attempts, 0)::numeric / 20 END
WHERE exam_score IS NULL OR exam_score = 0;

-- Central SSOT function: recalculate mastery from all sources
CREATE OR REPLACE FUNCTION public.recalculate_mastery(
  p_user_id uuid,
  p_skill_node_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record user_skill_scores%ROWTYPE;
  v_exam_score numeric;
  v_minicheck_score numeric;
  v_repetition_score numeric;
  v_raw_mastery numeric;
  v_decay_factor numeric;
  v_days_since numeric;
  v_confidence numeric;
  v_final_mastery numeric;
  v_status text;
  v_trend text;
BEGIN
  SELECT * INTO v_record
  FROM user_skill_scores
  WHERE user_id = p_user_id AND skill_node_id = p_skill_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no_score_record');
  END IF;

  -- Exam score: correct/attempts ratio * 100
  v_exam_score := CASE
    WHEN COALESCE(v_record.attempts, 0) > 0
    THEN (COALESCE(v_record.correct, 0)::numeric / v_record.attempts) * 100
    ELSE 0
  END;

  -- MiniCheck score: minicheck_correct/minicheck_attempts ratio * 100
  v_minicheck_score := CASE
    WHEN COALESCE(v_record.minicheck_attempts, 0) > 0
    THEN (COALESCE(v_record.minicheck_correct, 0)::numeric / v_record.minicheck_attempts) * 100
    ELSE 0
  END;

  -- Repetition score: trend-based bonus
  v_repetition_score := CASE v_record.trend
    WHEN 'improving' THEN 80
    WHEN 'stable' THEN 60
    WHEN 'declining' THEN 30
    ELSE 50
  END;

  -- Weighted combination: 50% exam + 30% minicheck + 20% repetition
  -- If no minicheck data, redistribute: 70% exam + 30% repetition
  IF COALESCE(v_record.minicheck_attempts, 0) = 0 THEN
    v_raw_mastery := 0.7 * v_exam_score + 0.3 * v_repetition_score;
  ELSE
    v_raw_mastery := 0.5 * v_exam_score + 0.3 * v_minicheck_score + 0.2 * v_repetition_score;
  END IF;

  -- Decay: exponential forgetting based on days since last activity
  v_days_since := EXTRACT(EPOCH FROM (now() - COALESCE(
    GREATEST(v_record.last_attempt_at, v_record.last_minicheck_at),
    v_record.last_attempt_at,
    v_record.updated_at
  ))) / 86400.0;

  -- λ = 0.003 → ~10% decay after 30 days, ~26% after 90 days
  v_decay_factor := exp(-0.003 * GREATEST(v_days_since, 0));
  v_final_mastery := ROUND((v_raw_mastery * v_decay_factor)::numeric, 2);

  -- Confidence: min(1, total_attempts / 20)
  v_confidence := LEAST(1.0, (COALESCE(v_record.attempts, 0) + COALESCE(v_record.minicheck_attempts, 0))::numeric / 20.0);
  v_confidence := ROUND(v_confidence, 2);

  -- Status classification
  v_status := CASE
    WHEN v_final_mastery >= 80 THEN 'mastered'
    WHEN v_final_mastery >= 60 THEN 'partial'
    ELSE 'not_mastered'
  END;

  -- Trend: compare to previous mastery_pct
  v_trend := CASE
    WHEN v_final_mastery > COALESCE(v_record.mastery_pct, 0) + 2 THEN 'improving'
    WHEN v_final_mastery < COALESCE(v_record.mastery_pct, 0) - 2 THEN 'declining'
    ELSE 'stable'
  END;

  -- Persist
  UPDATE user_skill_scores SET
    exam_score = v_exam_score,
    minicheck_score = v_minicheck_score,
    repetition_score = v_repetition_score,
    confidence = v_confidence,
    mastery_pct = v_final_mastery,
    decay_adjusted_mastery = v_final_mastery,
    mastery_status = v_status,
    trend = v_trend,
    updated_at = now()
  WHERE user_id = p_user_id AND skill_node_id = p_skill_node_id;

  RETURN jsonb_build_object(
    'exam_score', v_exam_score,
    'minicheck_score', v_minicheck_score,
    'repetition_score', v_repetition_score,
    'raw_mastery', ROUND(v_raw_mastery, 2),
    'decay_factor', ROUND(v_decay_factor::numeric, 4),
    'days_since_activity', ROUND(v_days_since::numeric, 1),
    'final_mastery', v_final_mastery,
    'confidence', v_confidence,
    'status', v_status,
    'trend', v_trend
  );
END;
$$;

-- Batch recalculate for a user across all skills
CREATE OR REPLACE FUNCTION public.recalculate_all_mastery(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skill record;
  v_count int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  FOR v_skill IN
    SELECT skill_node_id FROM user_skill_scores WHERE user_id = p_user_id
  LOOP
    PERFORM recalculate_mastery(p_user_id, v_skill.skill_node_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('recalculated', v_count);
END;
$$;
