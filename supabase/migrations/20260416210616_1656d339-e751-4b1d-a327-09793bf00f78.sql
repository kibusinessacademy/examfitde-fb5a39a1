-- ============================================================
-- SSOT Schema Fix: competencies.curriculum_id → JOIN via learning_fields
-- ============================================================
-- Befund: Die Tabelle public.competencies hat KEINE Spalte curriculum_id.
-- Die Verknüpfung muss über learning_fields.curriculum_id erfolgen.
-- Bug-Analyse zeigt: Nur check_curriculum_readiness() referenziert noch
-- direkt competencies.curriculum_id. Alle anderen 43 RPCs sind korrekt.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_curriculum_readiness(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum record;
  v_learning_fields int := 0;
  v_competencies int := 0;
  v_blueprints int := 0;
  v_market_score numeric := 0;
  v_ready boolean := false;
BEGIN
  SELECT * INTO v_curriculum FROM public.curricula WHERE id = p_curriculum_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'curriculum_not_found');
  END IF;

  -- Count learning fields
  BEGIN
    SELECT count(*) INTO v_learning_fields
    FROM public.learning_fields
    WHERE curriculum_id = p_curriculum_id;
  EXCEPTION WHEN undefined_table THEN v_learning_fields := 0;
  END;

  -- Count competencies via learning_fields JOIN (SSOT mandate)
  BEGIN
    SELECT count(*) INTO v_competencies
    FROM public.competencies c
    JOIN public.learning_fields lf ON lf.id = c.learning_field_id
    WHERE lf.curriculum_id = p_curriculum_id;
  EXCEPTION WHEN undefined_table THEN v_competencies := 0;
  END;

  -- Count blueprints
  BEGIN
    SELECT count(*) INTO v_blueprints
    FROM public.question_blueprints
    WHERE curriculum_id = p_curriculum_id;
  EXCEPTION WHEN undefined_table THEN v_blueprints := 0;
  END;

  -- Market score from beruf_market_data if available
  BEGIN
    SELECT COALESCE(avg(fit_score), 0) INTO v_market_score
    FROM public.beruf_market_data
    WHERE beruf_id = v_curriculum.beruf_id;
  EXCEPTION
    WHEN undefined_table THEN v_market_score := 0;
    WHEN undefined_column THEN v_market_score := 0;
  END;

  v_ready := true;

  RETURN jsonb_build_object(
    'ok', true,
    'curriculum_id', p_curriculum_id,
    'learning_fields', v_learning_fields,
    'competencies', v_competencies,
    'blueprints', v_blueprints,
    'market_score', v_market_score,
    'ready', v_ready
  );
END;
$function$;

-- ============================================================
-- Audit-Log
-- ============================================================
INSERT INTO public.admin_actions (action, scope, payload, user_id)
VALUES (
  'systemwide_competency_join_ssot_fix',
  'rpc+edge_functions',
  jsonb_build_object(
    'reason', 'competencies hat keine curriculum_id-Spalte; Joins MUSS via learning_fields erfolgen',
    'fixed_rpcs', ARRAY['public.check_curriculum_readiness'],
    'fixed_edge_functions', ARRAY['_shared/validation-requeue-guard.ts','generate-store-listing/index.ts'],
    'verified_clean', 'count_unenriched_competencies_for_curriculum, get_unenriched_competencies_for_curriculum, list_curriculum_competencies, get_exam_pool_gap_report, fn_classify_exam_pool_gate, calculate_exam_readiness, fn_auto_heal_materialization_guard, assemble_minicheck_weighted (alle bereits korrekt via learning_fields-JOIN)'
  ),
  NULL
);