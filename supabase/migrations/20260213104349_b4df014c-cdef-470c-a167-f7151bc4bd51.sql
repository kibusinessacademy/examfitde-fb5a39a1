
-- ============================================================
-- EINZELDOMINANZ-MODELL: Per-Certification Dominance Tracking
-- ============================================================

-- 1) Add dominance tracking to german_certification_master
ALTER TABLE public.german_certification_master
  ADD COLUMN IF NOT EXISTS dominance_phase text NOT NULL DEFAULT 'phase_0' 
    CHECK (dominance_phase IN ('phase_0','phase_1_analyse','phase_2_seeding','phase_3_quality','phase_4_ux','phase_5_authority','dominated')),
  ADD COLUMN IF NOT EXISTS dominance_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dominance_criteria jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS deep_audit_passes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seo_ranking_keywords integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS user_reviews_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_dominance_eval_at timestamptz;

-- 2) Dominance evaluation snapshots
CREATE TABLE IF NOT EXISTS public.certification_dominance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_master_id uuid NOT NULL REFERENCES public.german_certification_master(id) ON DELETE CASCADE,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  phase text NOT NULL,
  dominance_score integer NOT NULL DEFAULT 0,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text
);

ALTER TABLE public.certification_dominance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin access dominance snapshots" ON public.certification_dominance_snapshots FOR ALL USING (true) WITH CHECK (true);

-- 3) RPC: Evaluate single certification dominance
CREATE OR REPLACE FUNCTION public.evaluate_certification_dominance(p_cert_master_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r record;
  v_question_count integer := 0;
  v_coverage_pct numeric := 0;
  v_duplicate_pct numeric := 100;
  v_confidence integer := 0;
  v_governance integer := 0;
  v_deep_audits integer := 0;
  v_score integer := 0;
  v_phase text;
  v_criteria jsonb;
  v_content_ok boolean := false;
  v_tech_ok boolean := false;
  v_market_ok boolean := false;
  v_is_dominated boolean := false;
  v_recommendation text := '';
  v_min_target integer;
BEGIN
  SELECT * INTO r FROM german_certification_master WHERE id = p_cert_master_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_min_target := r.min_fragen_target;

  -- Fetch actual metrics from package if linked
  IF r.package_id IS NOT NULL THEN
    SELECT 
      COALESCE(cp.build_progress, 0),
      COALESCE((cp.feature_flags->>'confidence_score')::int, 0),
      COALESCE((cp.feature_flags->>'governance_score')::int, 0)
    INTO v_coverage_pct, v_confidence, v_governance
    FROM course_packages cp WHERE cp.id = r.package_id;
    
    -- Count questions via curriculum
    SELECT count(*) INTO v_question_count
    FROM exam_questions eq
    JOIN course_packages cp ON cp.id = r.package_id
    WHERE eq.curriculum_id = cp.curriculum_id;
  END IF;

  v_deep_audits := r.deep_audit_passes;

  -- ── Content criteria ──
  v_content_ok := (
    v_question_count >= v_min_target
    AND v_coverage_pct >= 90
  );

  -- ── Tech criteria ──
  v_tech_ok := (
    v_confidence >= 90
    AND v_governance >= 90
    AND v_deep_audits >= 2
  );

  -- ── Market criteria ──
  v_market_ok := (
    r.seo_ranking_keywords >= 20
    AND r.user_reviews_count >= 10
    AND r.conversion_rate >= 4.0
  );

  v_is_dominated := v_content_ok AND v_tech_ok AND v_market_ok;

  -- Calculate weighted score (0-100)
  v_score := ROUND(
    -- Content (40%)
    0.40 * LEAST(100, (
      CASE WHEN v_min_target > 0 THEN (v_question_count::numeric / v_min_target * 50) ELSE 0 END
      + LEAST(v_coverage_pct, 100) * 0.5
    ))
    -- Tech (35%)
    + 0.35 * LEAST(100, (
      v_confidence * 0.45
      + v_governance * 0.45
      + LEAST(v_deep_audits, 3) * 33.0 * 0.10
    ))
    -- Market (25%)
    + 0.25 * LEAST(100, (
      LEAST(r.seo_ranking_keywords, 30) / 30.0 * 40
      + LEAST(r.user_reviews_count, 15) / 15.0 * 30
      + LEAST(r.conversion_rate, 6) / 6.0 * 30
    ))
  );

  -- Derive phase
  IF v_is_dominated THEN
    v_phase := 'dominated';
    v_recommendation := 'Zertifizierung dominiert. Nächste starten.';
  ELSIF v_content_ok AND v_tech_ok THEN
    v_phase := 'phase_5_authority';
    v_recommendation := 'SEO + Conversion + Reviews aufbauen.';
  ELSIF v_content_ok THEN
    v_phase := 'phase_3_quality';
    v_recommendation := format('Confidence auf 90+ bringen (aktuell %s). Deep Audits: %s/2.', v_confidence, v_deep_audits);
  ELSIF v_question_count >= (v_min_target * 0.5) THEN
    v_phase := 'phase_2_seeding';
    v_recommendation := format('Weiter seeden: %s/%s Fragen.', v_question_count, v_min_target);
  ELSIF r.seeding_status IN ('rahmenplan_ingested', 'blueprints_ready') THEN
    v_phase := 'phase_1_analyse';
    v_recommendation := 'Blueprint erstellen und Seeding starten.';
  ELSE
    v_phase := 'phase_0';
    v_recommendation := 'Rahmenplan ingestieren.';
  END IF;

  v_criteria := jsonb_build_object(
    'content', jsonb_build_object(
      'ok', v_content_ok,
      'question_count', v_question_count,
      'target', v_min_target,
      'coverage_pct', v_coverage_pct
    ),
    'tech', jsonb_build_object(
      'ok', v_tech_ok,
      'confidence', v_confidence,
      'governance', v_governance,
      'deep_audit_passes', v_deep_audits
    ),
    'market', jsonb_build_object(
      'ok', v_market_ok,
      'seo_keywords', r.seo_ranking_keywords,
      'reviews', r.user_reviews_count,
      'conversion_rate', r.conversion_rate
    )
  );

  -- Update master record
  UPDATE german_certification_master
  SET dominance_phase = v_phase,
      dominance_score = v_score,
      dominance_criteria = v_criteria,
      last_dominance_eval_at = now()
  WHERE id = p_cert_master_id;

  -- Save snapshot
  INSERT INTO certification_dominance_snapshots
    (certification_master_id, phase, dominance_score, criteria, recommendation)
  VALUES (p_cert_master_id, v_phase, v_score, v_criteria, v_recommendation);

  RETURN jsonb_build_object(
    'id', p_cert_master_id,
    'name', r.name,
    'phase', v_phase,
    'score', v_score,
    'is_dominated', v_is_dominated,
    'criteria', v_criteria,
    'recommendation', v_recommendation
  );
END;
$$;
