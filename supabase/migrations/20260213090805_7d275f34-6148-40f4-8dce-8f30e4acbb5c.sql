
-- ══════════════════════════════════════════════════════════════
-- Quality Shield v3 – Audit Layer + Governance Score + Provider Risk
-- ══════════════════════════════════════════════════════════════

-- 1️⃣ quality_audit_snapshots – immutable audit trail
CREATE TABLE IF NOT EXISTS public.quality_audit_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id UUID NOT NULL,
  course_id UUID,
  event_type TEXT NOT NULL, -- 'publish','force_resume','quality_hold','confidence_pass','periodic_audit'
  triggered_by TEXT NOT NULL DEFAULT 'system', -- 'system' or admin user_id
  trigger_reason TEXT,
  question_count INTEGER NOT NULL DEFAULT 0,
  blueprint_coverage_pct NUMERIC(5,2) DEFAULT 0,
  lf_coverage_pct NUMERIC(5,2) DEFAULT 0,
  duplicate_rate NUMERIC(5,2) DEFAULT 0,
  hard_ratio NUMERIC(5,2) DEFAULT 0,
  low_confidence_ratio NUMERIC(5,2) DEFAULT 0,
  provider_mix JSONB DEFAULT '{}',
  confidence_score INTEGER DEFAULT 0,
  governance_score INTEGER DEFAULT 0,
  snapshot_data JSONB DEFAULT '{}', -- full raw data for deep audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_audit_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read audit snapshots" ON public.quality_audit_snapshots
  FOR SELECT USING (true);

CREATE INDEX idx_audit_snapshots_pkg ON public.quality_audit_snapshots(package_id, created_at DESC);
CREATE INDEX idx_audit_snapshots_event ON public.quality_audit_snapshots(event_type);

-- 2️⃣ Add governance_score to production_quality_snapshots
DO $$ BEGIN
  ALTER TABLE public.production_quality_snapshots ADD COLUMN governance_score INTEGER DEFAULT 100;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 3️⃣ Extend provider_performance with risk fields
DO $$ BEGIN
  ALTER TABLE public.provider_performance ADD COLUMN stability_index NUMERIC(5,2) DEFAULT 100;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.provider_performance ADD COLUMN hallucination_flag_rate NUMERIC(5,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.provider_performance ADD COLUMN regeneration_rate NUMERIC(5,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.provider_performance ADD COLUMN risk_score INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.provider_performance ADD COLUMN auto_disabled BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 4️⃣ Update check_production_quality to compute governance_score + write audit snapshot
CREATE OR REPLACE FUNCTION public.check_production_quality(
  p_package_id UUID,
  p_curriculum_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
  v_dup_count INTEGER;
  v_dup_rate NUMERIC(5,2);
  v_lf_coverage NUMERIC(5,2);
  v_easy_pct NUMERIC(5,2);
  v_medium_pct NUMERIC(5,2);
  v_hard_pct NUMERIC(5,2);
  v_low_conf INTEGER;
  v_flags TEXT[] := '{}';
  v_pause BOOLEAN := false;
  v_pause_reason TEXT;
  v_lf_detail JSONB := '{}';
  v_confidence INTEGER := 100;
  v_governance INTEGER := 100;
  v_force_resume_count INTEGER;
  v_manual_review_pct NUMERIC(5,2);
  v_provider_drift NUMERIC(5,2);
  v_days_since_audit INTEGER;
BEGIN
  -- Count total questions
  SELECT count(*) INTO v_total
  FROM exam_questions eq
  JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
  WHERE eb.curriculum_id = p_curriculum_id;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('total', 0, 'status', 'no_questions');
  END IF;

  -- Duplicate rate
  SELECT count(*) INTO v_dup_count
  FROM duplicate_detection_log
  WHERE package_id = p_package_id;
  v_dup_rate := ROUND(100.0 * v_dup_count / v_total, 2);

  -- Difficulty distribution
  SELECT
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'easy') / count(*), 1),
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'medium') / count(*), 1),
    ROUND(100.0 * count(*) FILTER (WHERE difficulty = 'hard') / count(*), 1)
  INTO v_easy_pct, v_medium_pct, v_hard_pct
  FROM exam_questions eq
  JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
  WHERE eb.curriculum_id = p_curriculum_id;

  -- LF coverage
  SELECT ROUND(100.0 * count(DISTINCT eq.lernfeld_id) /
    GREATEST(1, (SELECT count(DISTINCT id) FROM lernfelder WHERE curriculum_id = p_curriculum_id)), 1)
  INTO v_lf_coverage
  FROM exam_questions eq
  JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
  WHERE eb.curriculum_id = p_curriculum_id AND eq.lernfeld_id IS NOT NULL;

  -- LF detail with target vs actual
  SELECT jsonb_object_agg(lf_name, jsonb_build_object(
    'count', cnt,
    'pct', ROUND(100.0 * cnt / v_total, 1),
    'target_pct', ROUND(100.0 / GREATEST(1, lf_total), 1),
    'deviation', ABS(ROUND(100.0 * cnt / v_total - 100.0 / GREATEST(1, lf_total), 1))
  )) INTO v_lf_detail
  FROM (
    SELECT l.bezeichnung AS lf_name, count(eq.id) AS cnt,
           (SELECT count(DISTINCT id) FROM lernfelder WHERE curriculum_id = p_curriculum_id) AS lf_total
    FROM exam_questions eq
    JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
    LEFT JOIN lernfelder l ON eq.lernfeld_id = l.id
    WHERE eb.curriculum_id = p_curriculum_id AND eq.lernfeld_id IS NOT NULL
    GROUP BY l.bezeichnung, lf_total
  ) sub;

  -- Low confidence count
  SELECT count(*) INTO v_low_conf
  FROM exam_questions eq
  JOIN exam_blueprints eb ON eq.blueprint_id = eb.id
  WHERE eb.curriculum_id = p_curriculum_id
    AND (eq.metadata->>'confidence_score')::numeric < 0.6;

  -- ═══ Flags & Pause Logic (v2 thresholds) ═══
  IF v_dup_rate > 3 THEN v_flags := array_append(v_flags, 'high_duplicate_rate'); END IF;
  IF v_dup_rate > 4.5 THEN v_pause := true; v_pause_reason := 'Duplikat-Rate > 4.5%'; END IF;
  IF v_lf_coverage < 80 THEN v_flags := array_append(v_flags, 'low_lf_coverage'); END IF;
  IF v_lf_coverage < 70 THEN v_pause := true; v_pause_reason := COALESCE(v_pause_reason || ' + ', '') || 'LF-Coverage < 70%'; END IF;
  IF v_hard_pct < 15 THEN v_flags := array_append(v_flags, 'low_hard_ratio'); END IF;
  IF v_hard_pct < 10 THEN v_pause := true; v_pause_reason := COALESCE(v_pause_reason || ' + ', '') || 'Hard-Anteil < 10%'; END IF;
  IF v_low_conf > v_total * 0.15 THEN v_flags := array_append(v_flags, 'high_low_confidence'); END IF;

  -- ═══ Confidence Score (weighted) ═══
  -- 35% Coverage + 25% Duplicate Health + 20% Difficulty Balance + 10% Provider Stability + 10% Low-Conf
  v_confidence := GREATEST(0, LEAST(100,
    ROUND(
      0.35 * LEAST(100, v_lf_coverage) +
      0.25 * GREATEST(0, 100 - v_dup_rate * 20) +
      0.20 * CASE WHEN v_hard_pct BETWEEN 15 AND 30 AND v_easy_pct BETWEEN 30 AND 50 THEN 100
                   WHEN v_hard_pct >= 10 THEN 70 ELSE 30 END +
      0.10 * 85 + -- provider stability placeholder (updated by edge fn)
      0.10 * GREATEST(0, 100 - (v_low_conf::numeric / GREATEST(1, v_total) * 500))
    )
  ));

  -- ═══ Governance Score ═══
  -- Factors: force_resume count, manual review %, provider drift, days since audit
  SELECT count(*) INTO v_force_resume_count
  FROM quality_audit_snapshots
  WHERE package_id = p_package_id AND event_type = 'force_resume';

  SELECT COALESCE(EXTRACT(DAY FROM now() - MAX(created_at))::integer, 999) INTO v_days_since_audit
  FROM quality_audit_snapshots
  WHERE package_id = p_package_id;

  -- Provider drift = max error rate across recent providers
  SELECT COALESCE(MAX(
    CASE WHEN total_calls > 0 THEN ROUND(100.0 * error_count / total_calls, 1) ELSE 0 END
  ), 0) INTO v_provider_drift
  FROM provider_performance
  WHERE date >= (CURRENT_DATE - 3);

  v_governance := GREATEST(0, LEAST(100,
    100
    - v_force_resume_count * 8           -- each force resume costs 8 pts
    - CASE WHEN v_days_since_audit > 14 THEN 15
           WHEN v_days_since_audit > 7 THEN 5 ELSE 0 END
    - CASE WHEN v_provider_drift > 20 THEN 20
           WHEN v_provider_drift > 10 THEN 10 ELSE 0 END
  ));

  -- Auto-pause
  IF v_pause THEN
    UPDATE course_packages SET status = 'quality_hold'
    WHERE id = p_package_id AND status = 'building';
  END IF;

  -- Write snapshot
  INSERT INTO production_quality_snapshots (
    package_id, total_questions, duplicate_rate, lf_coverage_pct,
    difficulty_easy_pct, difficulty_medium_pct, difficulty_hard_pct,
    low_confidence_count, confidence_score, governance_score,
    lf_detail, flags, auto_paused, pause_reason
  ) VALUES (
    p_package_id, v_total, v_dup_rate, v_lf_coverage,
    v_easy_pct, v_medium_pct, v_hard_pct,
    v_low_conf, v_confidence, v_governance,
    v_lf_detail, v_flags, v_pause, v_pause_reason
  );

  -- Write audit snapshot for significant events
  IF v_pause OR v_confidence >= 85 OR v_total % 200 < 10 THEN
    INSERT INTO quality_audit_snapshots (
      package_id, event_type, triggered_by, trigger_reason,
      question_count, lf_coverage_pct, duplicate_rate, hard_ratio,
      low_confidence_ratio, confidence_score, governance_score,
      snapshot_data
    ) VALUES (
      p_package_id,
      CASE WHEN v_pause THEN 'quality_hold' WHEN v_confidence >= 85 THEN 'confidence_pass' ELSE 'periodic_audit' END,
      'system',
      CASE WHEN v_pause THEN v_pause_reason ELSE 'Routine check at ' || v_total || ' questions' END,
      v_total, v_lf_coverage, v_dup_rate, v_hard_pct,
      ROUND(100.0 * v_low_conf / GREATEST(1, v_total), 1),
      v_confidence, v_governance,
      jsonb_build_object('flags', v_flags, 'lf_detail', v_lf_detail, 'difficulty', jsonb_build_object('easy', v_easy_pct, 'medium', v_medium_pct, 'hard', v_hard_pct))
    );
  END IF;

  RETURN jsonb_build_object(
    'total', v_total,
    'duplicate_rate', v_dup_rate,
    'lf_coverage', v_lf_coverage,
    'difficulty', jsonb_build_object('easy', v_easy_pct, 'medium', v_medium_pct, 'hard', v_hard_pct),
    'low_confidence', v_low_conf,
    'confidence_score', v_confidence,
    'governance_score', v_governance,
    'flags', to_jsonb(v_flags),
    'paused', v_pause,
    'pause_reason', v_pause_reason
  );
END;
$$;

-- 5️⃣ Update quality_hold_resume to log audit snapshot
CREATE OR REPLACE FUNCTION public.quality_hold_resume(
  p_package_id UUID,
  p_action TEXT DEFAULT 'admin_resume'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_result JSONB;
BEGIN
  SELECT * INTO v_pkg FROM course_packages WHERE id = p_package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('resumed', false, 'reason', 'Package not found'); END IF;
  IF v_pkg.status != 'quality_hold' THEN RETURN jsonb_build_object('resumed', false, 'reason', 'Not in quality_hold'); END IF;

  IF p_action = 'admin_resume' THEN
    UPDATE course_packages SET status = 'building' WHERE id = p_package_id;
    -- Log force resume in audit
    INSERT INTO quality_audit_snapshots (package_id, event_type, triggered_by, trigger_reason, question_count, confidence_score, governance_score)
    SELECT p_package_id, 'force_resume', 'admin', 'Admin Force Resume', 
           COALESCE(s.total_questions, 0), COALESCE(s.confidence_score, 0), COALESCE(s.governance_score, 0)
    FROM production_quality_snapshots s WHERE s.package_id = p_package_id ORDER BY s.snapshot_at DESC LIMIT 1;
    RETURN jsonb_build_object('resumed', true, 'action', 'admin_resume');
  END IF;

  IF p_action = 'auto_recheck' THEN
    SELECT * INTO v_result FROM check_production_quality(p_package_id, v_pkg.curriculum_id);
    IF (v_result->>'paused')::boolean = false THEN
      UPDATE course_packages SET status = 'building' WHERE id = p_package_id;
      RETURN jsonb_build_object('resumed', true, 'action', 'auto_recheck', 'quality', v_result);
    ELSE
      RETURN jsonb_build_object('resumed', false, 'reason', v_result->>'pause_reason', 'quality', v_result);
    END IF;
  END IF;

  RETURN jsonb_build_object('resumed', false, 'reason', 'Unknown action');
END;
$$;
