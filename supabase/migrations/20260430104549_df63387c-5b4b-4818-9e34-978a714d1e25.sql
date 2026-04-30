
-- Re-Run + Debug + LLM-Trigger RPCs für Synthetic Cohort

-- 1) Debug-Tabelle: berechnete Werte pro Session (für Schema-Drift-Detection)
CREATE OR REPLACE FUNCTION public.synth_get_debug_table(p_run_id uuid)
RETURNS TABLE(
  package_id uuid,
  package_label text,
  persona_key text,
  total_lessons int,
  total_questions int,
  simulated_questions int,
  correct_count int,
  avg_response_ms int,
  didactic_score numeric,
  step_score numeric,
  ihk_score numeric,
  question_score numeric,
  flagged_for_llm boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.package_id,
    cp.title AS package_label,
    s.persona_key,
    (s.raw_metrics->>'total_lessons')::int            AS total_lessons,
    (s.raw_metrics->>'total_approved_questions')::int AS total_questions,
    (s.raw_metrics->>'simulated_questions')::int      AS simulated_questions,
    (s.raw_metrics->>'correct_count')::int            AS correct_count,
    (s.raw_metrics->>'avg_response_ms')::int          AS avg_response_ms,
    s.didactic_score,
    s.step_completeness_score AS step_score,
    s.ihk_coverage_score      AS ihk_score,
    s.question_quality_score  AS question_score,
    s.flagged_for_llm_review  AS flagged_for_llm
  FROM public.synth_session_results s
  LEFT JOIN public.course_packages cp ON cp.id = s.package_id
  WHERE s.run_id = p_run_id
    AND public.has_role(auth.uid(), 'admin')
  ORDER BY s.didactic_score ASC NULLS LAST, cp.title, s.persona_key;
$$;

-- 2) Re-Run: alle betroffenen package_ids des letzten Runs erneut heuristisch durchlaufen
--    + Summary neu berechnen. Idempotent: löscht alte session_results+findings für diesen Run.
CREATE OR REPLACE FUNCTION public.synth_rerun_heuristic(
  p_run_id uuid,
  p_only_flagged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_ids uuid[];
  v_pkg uuid;
  v_processed int := 0;
  v_findings_total int := 0;
  v_pkgs_with_findings int := 0;
  v_avg_score numeric;
  v_res jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_required'; END IF;

  -- Welche Pakete neu laufen lassen?
  IF p_only_flagged THEN
    SELECT array_agg(DISTINCT package_id)
      INTO v_pkg_ids
    FROM public.synth_session_results
    WHERE run_id = p_run_id AND flagged_for_llm_review = true;
  ELSE
    SELECT package_ids INTO v_pkg_ids
    FROM public.synth_cohort_runs WHERE id = p_run_id;
  END IF;

  IF v_pkg_ids IS NULL OR array_length(v_pkg_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_packages_for_rerun');
  END IF;

  -- Vor Re-Run: alte Daten DIESES Runs für diese Pakete löschen (Idempotenz)
  DELETE FROM public.synth_didactic_findings
   WHERE run_id = p_run_id AND package_id = ANY(v_pkg_ids);
  DELETE FROM public.synth_session_results
   WHERE run_id = p_run_id AND package_id = ANY(v_pkg_ids);

  -- Counter zurücksetzen (auf neu zu berechnende Basis)
  UPDATE public.synth_cohort_runs
     SET packages_completed     = GREATEST(0, packages_completed     - array_length(v_pkg_ids,1)),
         packages_with_findings = 0,
         total_findings         = 0
   WHERE id = p_run_id;

  -- Heuristik pro Paket
  FOREACH v_pkg IN ARRAY v_pkg_ids LOOP
    v_res := public.synth_run_heuristic(p_run_id, v_pkg);
    v_processed := v_processed + 1;
  END LOOP;

  -- Summary neu berechnen (aus session_results)
  SELECT
    avg(didactic_score),
    count(DISTINCT package_id) FILTER (WHERE flagged_for_llm_review)
  INTO v_avg_score, v_pkgs_with_findings
  FROM public.synth_session_results
  WHERE run_id = p_run_id;

  SELECT count(*) INTO v_findings_total
  FROM public.synth_didactic_findings WHERE run_id = p_run_id;

  UPDATE public.synth_cohort_runs
     SET avg_didactic_score = v_avg_score,
         total_findings     = v_findings_total,
         packages_with_findings = (
           SELECT count(DISTINCT package_id)
           FROM public.synth_didactic_findings WHERE run_id = p_run_id
         )
   WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'ok', true,
    'rerun_packages', v_processed,
    'avg_didactic_score', v_avg_score,
    'total_findings', v_findings_total
  );
END;
$$;

-- 3) Hilfs-RPC: package_ids zurückgeben, die im Run für LLM-Review eskaliert werden sollen
--    (niedrige didactic_score / step_score / ihk_score / question_score)
CREATE OR REPLACE FUNCTION public.synth_get_llm_candidates(
  p_run_id uuid,
  p_didactic_threshold numeric DEFAULT 70,
  p_step_threshold numeric DEFAULT 70,
  p_ihk_threshold numeric DEFAULT 60,
  p_question_threshold numeric DEFAULT 60,
  p_limit int DEFAULT 10
)
RETURNS TABLE(
  package_id uuid,
  package_label text,
  avg_didactic numeric,
  avg_step numeric,
  avg_ihk numeric,
  avg_question numeric,
  trigger_reason text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.package_id,
    cp.title AS package_label,
    avg(s.didactic_score)::numeric            AS avg_didactic,
    avg(s.step_completeness_score)::numeric   AS avg_step,
    avg(s.ihk_coverage_score)::numeric        AS avg_ihk,
    avg(s.question_quality_score)::numeric    AS avg_question,
    CASE
      WHEN avg(s.didactic_score) < p_didactic_threshold THEN 'low_didactic'
      WHEN avg(s.step_completeness_score) < p_step_threshold THEN 'low_step'
      WHEN avg(s.ihk_coverage_score) < p_ihk_threshold THEN 'low_ihk'
      WHEN avg(s.question_quality_score) < p_question_threshold THEN 'low_question'
      ELSE 'flagged_only'
    END AS trigger_reason
  FROM public.synth_session_results s
  LEFT JOIN public.course_packages cp ON cp.id = s.package_id
  WHERE s.run_id = p_run_id
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY s.package_id, cp.title
  HAVING
       avg(s.didactic_score)          < p_didactic_threshold
    OR avg(s.step_completeness_score) < p_step_threshold
    OR avg(s.ihk_coverage_score)      < p_ihk_threshold
    OR avg(s.question_quality_score)  < p_question_threshold
    OR bool_or(s.flagged_for_llm_review)
  ORDER BY avg(s.didactic_score) ASC NULLS LAST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.synth_get_debug_table(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.synth_rerun_heuristic(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.synth_get_llm_candidates(uuid, numeric, numeric, numeric, numeric, int) TO authenticated;
