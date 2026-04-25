
-- ============================================================================
-- ROOT-CAUSE DIAGNOSE & AUTO-FIX FÜR EXAM_POOL TOO_FEW_APPROVED
-- ============================================================================

-- ── 1) Trigger-Härtung: synchroner qc_status-Sync bei Auto-Promotion ─────────
CREATE OR REPLACE FUNCTION public.fn_auto_promote_tier1_passed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Promote wenn alle Pflichtfelder gesetzt sind UND qc_status = tier1_passed
  IF NEW.qc_status = 'tier1_passed'
     AND NEW.curriculum_id IS NOT NULL
     AND NEW.learning_field_id IS NOT NULL
     AND NEW.competency_id IS NOT NULL
     AND NEW.difficulty IS NOT NULL
     AND NEW.cognitive_level IS NOT NULL
     AND NEW.correct_answer IS NOT NULL
     AND NEW.question_text IS NOT NULL
     AND length(NEW.question_text) >= 10
  THEN
    -- WICHTIG: Beide Felder synchron setzen — sonst Promotion-Stau
    NEW.status    := 'approved';
    NEW.qc_status := 'approved';
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_promote_tier1_to_approved ON public.exam_questions;
CREATE TRIGGER trg_auto_promote_tier1_to_approved
  BEFORE INSERT OR UPDATE ON public.exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_promote_tier1_passed();

-- ── 2) Idempotenter Backfill-Helper für Bestands-tier1_passed ────────────────
CREATE OR REPLACE FUNCTION public.fn_promote_eligible_tier1_to_approved(p_curriculum_id uuid)
RETURNS TABLE(promoted_count int, skipped_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted int := 0;
  v_skipped  int := 0;
BEGIN
  WITH eligible AS (
    SELECT id FROM public.exam_questions
    WHERE curriculum_id = p_curriculum_id
      AND qc_status = 'tier1_passed'
      AND learning_field_id IS NOT NULL
      AND competency_id IS NOT NULL
      AND difficulty IS NOT NULL
      AND cognitive_level IS NOT NULL
      AND correct_answer IS NOT NULL
      AND question_text IS NOT NULL
      AND length(question_text) >= 10
  ), updated AS (
    UPDATE public.exam_questions eq
    SET qc_status = 'approved',
        status    = 'approved',
        reviewed_at = COALESCE(reviewed_at, now())
    FROM eligible e
    WHERE eq.id = e.id
    RETURNING eq.id
  )
  SELECT COUNT(*) INTO v_promoted FROM updated;

  SELECT COUNT(*) INTO v_skipped
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id
    AND qc_status = 'tier1_passed';

  RETURN QUERY SELECT v_promoted, v_skipped;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_promote_eligible_tier1_to_approved(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3) Root-Cause-Diagnose-RPC ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_diagnose_exam_pool_deficit(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg          record;
  v_curriculum   uuid;
  v_track        text;
  v_min_required int;
  v_total        int;
  v_approved     int;
  v_tier1        int;
  v_tier1_eligible int;
  v_draft        int;
  v_rejected     int;
  v_needs_review int;
  v_lf_total     int;
  v_lf_covered   int;
  v_lf_missing   int;
  v_root_cause   text;
  v_root_detail  text;
  v_recommended  jsonb;
  v_deficit_after_promote int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND current_setting('role') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT cp.id, cp.title, cp.status, cp.track, cp.curriculum_id, cp.is_rebuild
    INTO v_pkg
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF v_pkg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;

  v_curriculum := v_pkg.curriculum_id;
  v_track := COALESCE(v_pkg.track, 'AUSBILDUNG_VOLL');

  -- Track-spezifische Mindestmenge (SSOT mit package-run-integrity-check)
  v_min_required := CASE v_track
    WHEN 'EXAM_FIRST'      THEN 60
    WHEN 'EXAM_FIRST_PLUS' THEN 500
    WHEN 'STUDIUM'         THEN 200
    WHEN 'ELITE'           THEN 800
    ELSE 500
  END;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE qc_status = 'approved'),
    COUNT(*) FILTER (WHERE qc_status = 'tier1_passed'),
    COUNT(*) FILTER (
      WHERE qc_status = 'tier1_passed'
        AND learning_field_id IS NOT NULL
        AND competency_id IS NOT NULL
        AND difficulty IS NOT NULL
        AND cognitive_level IS NOT NULL
        AND correct_answer IS NOT NULL
        AND question_text IS NOT NULL
        AND length(question_text) >= 10
    ),
    COUNT(*) FILTER (WHERE qc_status = 'needs_review' OR status = 'draft'),
    COUNT(*) FILTER (WHERE qc_status IN ('rejected','pruned_quality')),
    COUNT(*) FILTER (WHERE qc_status = 'needs_review')
  INTO v_total, v_approved, v_tier1, v_tier1_eligible, v_draft, v_rejected, v_needs_review
  FROM public.exam_questions
  WHERE curriculum_id = v_curriculum;

  SELECT COUNT(*) INTO v_lf_total
  FROM public.learning_fields WHERE curriculum_id = v_curriculum;

  SELECT COUNT(DISTINCT learning_field_id) INTO v_lf_covered
  FROM public.exam_questions
  WHERE curriculum_id = v_curriculum
    AND qc_status IN ('approved','tier1_passed');

  v_lf_missing := GREATEST(0, COALESCE(v_lf_total,0) - COALESCE(v_lf_covered,0));
  v_deficit_after_promote := GREATEST(0, v_min_required - (v_approved + v_tier1_eligible));

  -- Root-Cause-Analyse (priorisiert)
  IF v_tier1_eligible > 0 AND (v_approved + v_tier1_eligible) >= v_min_required THEN
    v_root_cause  := 'PROMOTION_STALL';
    v_root_detail := format(
      '%s tier1_passed Fragen sind promotion-fähig (alle Pflichtfelder gesetzt), wurden aber nicht zu approved promoted. Trigger-Sync war defekt — 1-Klick-Backfill löst das Problem.',
      v_tier1_eligible
    );
    v_recommended := jsonb_build_object(
      'action', 'promote_tier1',
      'expected_new_approved', v_approved + v_tier1_eligible,
      'safe', true,
      'one_click', true
    );
  ELSIF v_tier1_eligible > 0 AND v_deficit_after_promote > 0 THEN
    v_root_cause  := 'PROMOTION_PARTIAL_PLUS_GENERATION';
    v_root_detail := format(
      '%s tier1_passed Fragen sind sofort promotion-fähig, aber es fehlen danach noch %s Fragen. Empfehlung: erst promoten, dann generieren.',
      v_tier1_eligible, v_deficit_after_promote
    );
    v_recommended := jsonb_build_object(
      'action', 'promote_then_generate',
      'expected_new_approved', v_approved + v_tier1_eligible,
      'remaining_deficit', v_deficit_after_promote,
      'safe', true,
      'one_click', true
    );
  ELSIF v_lf_missing > 0 THEN
    v_root_cause  := 'COVERAGE_GAP';
    v_root_detail := format(
      '%s von %s Lernfeldern haben keine freigegebenen Fragen. Generator muss gezielt für diese Lernfelder Fragen erzeugen.',
      v_lf_missing, v_lf_total
    );
    v_recommended := jsonb_build_object(
      'action', 'enqueue_lf_gap_fill',
      'missing_lf_count', v_lf_missing,
      'safe', true,
      'one_click', true
    );
  ELSIF v_total < v_min_required THEN
    v_root_cause  := 'GENERATION_DEFICIT';
    v_root_detail := format(
      'Pool hat nur %s Fragen total (Ziel %s). Generator muss neu enqueued werden mit erhöhtem exam_target.',
      v_total, v_min_required
    );
    v_recommended := jsonb_build_object(
      'action', 'enqueue_generate_exam_pool',
      'exam_target', GREATEST(v_min_required + 200, ROUND(v_min_required * 1.4)),
      'safe', true,
      'one_click', true
    );
  ELSIF v_rejected > (v_total / 2) THEN
    v_root_cause  := 'QUALITY_DEFICIT';
    v_root_detail := format(
      '%s von %s Fragen wurden rejected (%.0f%%). Pool muss neu generiert werden mit verbesserten Prompts.',
      v_rejected, v_total, (v_rejected::numeric / NULLIF(v_total,0)) * 100
    );
    v_recommended := jsonb_build_object(
      'action', 'rebuild_exam_pool',
      'safe', false,
      'one_click', false,
      'reason', 'manual_review_required'
    );
  ELSE
    v_root_cause  := 'UNKNOWN';
    v_root_detail := 'Keine eindeutige Root-Cause identifiziert. Manuelle Inspektion empfohlen.';
    v_recommended := jsonb_build_object('action', 'manual_review', 'safe', false, 'one_click', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'package', jsonb_build_object(
      'id', v_pkg.id,
      'title', v_pkg.title,
      'status', v_pkg.status,
      'track', v_track,
      'curriculum_id', v_curriculum,
      'is_rebuild', v_pkg.is_rebuild
    ),
    'metrics', jsonb_build_object(
      'total', v_total,
      'approved', v_approved,
      'tier1_passed', v_tier1,
      'tier1_promotable', v_tier1_eligible,
      'draft', v_draft,
      'rejected', v_rejected,
      'needs_review', v_needs_review,
      'min_required', v_min_required,
      'current_deficit', GREATEST(0, v_min_required - v_approved),
      'deficit_after_promotion', v_deficit_after_promote,
      'lf_total', v_lf_total,
      'lf_covered', v_lf_covered,
      'lf_missing', v_lf_missing
    ),
    'root_cause', jsonb_build_object(
      'code', v_root_cause,
      'detail', v_root_detail
    ),
    'recommended_fix', v_recommended,
    'diagnosed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_diagnose_exam_pool_deficit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_diagnose_exam_pool_deficit(uuid) TO authenticated, service_role;

-- ── 4) Auto-Fix-RPC ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_autofix_exam_pool_deficit(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_diag         jsonb;
  v_action       text;
  v_curriculum   uuid;
  v_safe         boolean;
  v_promoted     int := 0;
  v_skipped      int := 0;
  v_enqueued_jobs jsonb := '[]'::jsonb;
  v_target       int;
  v_track        text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND current_setting('role') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_diag := public.fn_diagnose_exam_pool_deficit(p_package_id);
  IF (v_diag->>'ok')::boolean IS NOT TRUE THEN
    RETURN v_diag;
  END IF;

  v_action     := v_diag->'recommended_fix'->>'action';
  v_safe       := COALESCE((v_diag->'recommended_fix'->>'safe')::boolean, false);
  v_curriculum := (v_diag->'package'->>'curriculum_id')::uuid;
  v_track      := v_diag->'package'->>'track';

  IF NOT v_safe THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unsafe_action_requires_manual_review',
      'diagnosis', v_diag
    );
  END IF;

  -- Aktion 1: Promotion durchführen
  IF v_action IN ('promote_tier1','promote_then_generate') THEN
    SELECT promoted_count, skipped_count
      INTO v_promoted, v_skipped
    FROM public.fn_promote_eligible_tier1_to_approved(v_curriculum);
  END IF;

  -- Aktion 2: Generierung enqueuen wenn nötig
  IF v_action IN ('promote_then_generate','enqueue_generate_exam_pool') THEN
    v_target := COALESCE(
      (v_diag->'recommended_fix'->>'exam_target')::int,
      700
    );
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta, created_at, updated_at)
    VALUES (
      'package_generate_exam_pool',
      p_package_id,
      'pending',
      5,
      3,
      jsonb_build_object('package_id', p_package_id, 'curriculum_id', v_curriculum, 'exam_target', v_target),
      jsonb_build_object(
        'enqueued_by', 'fn_autofix_exam_pool_deficit',
        'reason', 'auto_fix_too_few_approved',
        'exam_target', v_target,
        'track', v_track
      ),
      now(), now()
    );
    v_enqueued_jobs := v_enqueued_jobs || jsonb_build_object('job_type', 'package_generate_exam_pool', 'exam_target', v_target);
  END IF;

  IF v_action = 'enqueue_lf_gap_fill' THEN
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta, created_at, updated_at)
    VALUES (
      'pool_fill_lf_gaps',
      p_package_id,
      'pending',
      5,
      3,
      jsonb_build_object('package_id', p_package_id, 'curriculum_id', v_curriculum),
      jsonb_build_object('enqueued_by', 'fn_autofix_exam_pool_deficit', 'reason', 'auto_fix_lf_coverage_gap'),
      now(), now()
    );
    v_enqueued_jobs := v_enqueued_jobs || jsonb_build_object('job_type', 'pool_fill_lf_gaps');
  END IF;

  -- Audit
  INSERT INTO public.admin_notifications (type, severity, title, message, payload, created_at)
  VALUES (
    'exam_pool_autofix',
    'info',
    format('Auto-Fix angewendet: %s', v_diag->'package'->>'title'),
    format('Root-Cause: %s | Promoted: %s | Jobs: %s',
      v_diag->'root_cause'->>'code', v_promoted, jsonb_array_length(v_enqueued_jobs)),
    jsonb_build_object(
      'package_id', p_package_id,
      'diagnosis', v_diag,
      'promoted', v_promoted,
      'skipped', v_skipped,
      'enqueued', v_enqueued_jobs
    ),
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action_taken', v_action,
    'promoted_count', v_promoted,
    'skipped_count', v_skipped,
    'enqueued_jobs', v_enqueued_jobs,
    'diagnosis', v_diag,
    'applied_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_autofix_exam_pool_deficit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_autofix_exam_pool_deficit(uuid) TO authenticated, service_role;
