
-- ============================================================================
-- 1. Klassifikator-Funktion
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_classify_lf_repair_root_cause(p_package_id uuid)
RETURNS TABLE (
  subcode text,
  reason_detail text,
  missing_lfs text[],
  blueprint_count_for_gaps bigint,
  variant_count_for_gaps bigint,
  approved_question_count_for_gaps bigint,
  question_deficit_total bigint,
  recommendation text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_blueprint_gap_count int := 0;
  v_variant_gap_count   int := 0;
  v_question_gap_only   int := 0;
  v_mixed_gap_count     int := 0;
  v_ok_count            int := 0;
  v_total_lf            int := 0;
  v_missing_lfs         text[];
  v_bp_for_gaps         bigint := 0;
  v_var_for_gaps        bigint := 0;
  v_q_for_gaps          bigint := 0;
  v_deficit_total       bigint := 0;
  v_subcode             text;
  v_reason              text;
  v_recommendation      text;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE gap_class = 'BLUEPRINT_GAP'),
    COUNT(*) FILTER (WHERE gap_class = 'VARIANT_GAP'),
    COUNT(*) FILTER (WHERE gap_class = 'QUESTION_GAP_ONLY'),
    COUNT(*) FILTER (WHERE gap_class = 'MIXED_GAP'),
    COUNT(*) FILTER (WHERE gap_class = 'OK'),
    COUNT(*),
    COALESCE(ARRAY_AGG(lf_code ORDER BY sort_order) FILTER (WHERE gap_class <> 'OK'), ARRAY[]::text[]),
    COALESCE(SUM(total_bp_count) FILTER (WHERE gap_class <> 'OK'), 0),
    COALESCE(SUM(usable_variant_count) FILTER (WHERE gap_class <> 'OK'), 0),
    COALESCE(SUM(approved_question_count) FILTER (WHERE gap_class <> 'OK'), 0),
    COALESCE(SUM(question_deficit) FILTER (WHERE gap_class <> 'OK'), 0)
  INTO v_blueprint_gap_count, v_variant_gap_count, v_question_gap_only,
       v_mixed_gap_count, v_ok_count, v_total_lf,
       v_missing_lfs, v_bp_for_gaps, v_var_for_gaps, v_q_for_gaps, v_deficit_total
  FROM public.v_exam_pool_lf_repair_gap_classification
  WHERE package_id = p_package_id;

  IF v_total_lf = 0 THEN
    v_subcode := 'LF_REPAIR_NO_DATA';
    v_reason := 'No LF rows in gap classification view';
    v_recommendation := 'Investigate curriculum/learning_field rows';
  ELSIF v_blueprint_gap_count + v_variant_gap_count + v_mixed_gap_count + v_question_gap_only = 0 THEN
    v_subcode := 'LF_REPAIR_GATE_SOURCE_DRIFT';
    v_reason := 'All LFs OK in classification but gate still reports LF_COVERAGE_GAP';
    v_recommendation := 'Gate liest andere Quelle als Klassifikations-View — Source-Drift fixen';
  ELSIF v_blueprint_gap_count > 0 AND v_variant_gap_count = 0 AND v_mixed_gap_count = 0 THEN
    v_subcode := 'LF_REPAIR_NO_BLUEPRINTS';
    v_reason := format('%s LFs need blueprints first (no variants possible without BPs)', v_blueprint_gap_count);
    v_recommendation := 'Targeted blueprint_fill statt coverage-repair enqueuen';
  ELSIF v_variant_gap_count > 0 AND v_var_for_gaps = 0 THEN
    v_subcode := 'LF_REPAIR_NO_EFFECT';
    v_reason := format('%s LFs have BPs (%s total) but 0 usable variants — coverage-repair worker kann nicht materialisieren', v_variant_gap_count, v_bp_for_gaps);
    v_recommendation := 'Variant-Generator (blueprint→variants) ausführen, NICHT Coverage-Repair re-enqueuen';
  ELSIF v_question_gap_only > 0 AND v_q_for_gaps > 0 THEN
    v_subcode := 'LF_REPAIR_MATERIALIZED_BUT_STILL_FAILING';
    v_reason := format('%s LFs haben %s approved questions, Gate misst aber Lücke — Source-Drift wahrscheinlich', v_question_gap_only, v_q_for_gaps);
    v_recommendation := 'Gate-Source-Drift prüfen (gate liest evtl. raw_questions statt approved)';
  ELSIF v_mixed_gap_count > 0 THEN
    v_subcode := 'LF_REPAIR_NO_EFFECT';
    v_reason := format('%s MIXED_GAP LFs — Repair-Job materialisiert nicht (BPs+Variants beide unvollständig)', v_mixed_gap_count);
    v_recommendation := 'Variant-Generator + Question-Materializer nacheinander, Coverage-Repair stoppen';
  ELSE
    v_subcode := 'LF_REPAIR_NO_EFFECT';
    v_reason := 'Mixed signal — see counters';
    v_recommendation := 'Manual review';
  END IF;

  RETURN QUERY SELECT v_subcode, v_reason, v_missing_lfs, v_bp_for_gaps,
                      v_var_for_gaps, v_q_for_gaps, v_deficit_total, v_recommendation;
END;
$$;

COMMENT ON FUNCTION public.fn_classify_lf_repair_root_cause(uuid)
  IS 'Klassifiziert die Wurzel-Ursache eines GATE_NOT_PASS Loops für package_repair_exam_pool_lf_coverage. Subcodes: LF_REPAIR_NO_BLUEPRINTS, LF_REPAIR_NO_EFFECT, LF_REPAIR_MATERIALIZED_BUT_STILL_FAILING, LF_REPAIR_GATE_SOURCE_DRIFT, LF_REPAIR_NO_DATA.';

-- ============================================================================
-- 2. View — alle LF-Repair Hotloops mit Subcode
-- ============================================================================
DROP VIEW IF EXISTS public.v_lf_repair_hotloops_classified CASCADE;
CREATE VIEW public.v_lf_repair_hotloops_classified AS
WITH base AS (
  SELECT v.package_id, v.fail_count, v.last_failed_at, v.first_failed_at,
         v.last_error_text, v.quarantined
  FROM public.v_failed_job_hotloops_24h v
  WHERE v.job_type = 'package_repair_exam_pool_lf_coverage'
)
SELECT
  b.package_id,
  b.fail_count,
  b.last_failed_at,
  b.first_failed_at,
  b.last_error_text,
  b.quarantined,
  c.subcode,
  c.reason_detail,
  c.missing_lfs,
  c.blueprint_count_for_gaps,
  c.variant_count_for_gaps,
  c.approved_question_count_for_gaps,
  c.question_deficit_total,
  c.recommendation
FROM base b
CROSS JOIN LATERAL public.fn_classify_lf_repair_root_cause(b.package_id) c;

REVOKE ALL ON public.v_lf_repair_hotloops_classified FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_lf_repair_hotloops_classified TO service_role;

-- ============================================================================
-- 3. Admin-RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_lf_repair_hotloop_classifications()
RETURNS TABLE (
  package_id uuid,
  package_title text,
  fail_count int,
  last_failed_at timestamptz,
  quarantined boolean,
  subcode text,
  reason_detail text,
  missing_lfs text[],
  blueprint_count_for_gaps bigint,
  variant_count_for_gaps bigint,
  approved_question_count_for_gaps bigint,
  question_deficit_total bigint,
  recommendation text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;
  RETURN QUERY
    SELECT v.package_id, cp.title::text, v.fail_count, v.last_failed_at,
           v.quarantined, v.subcode, v.reason_detail, v.missing_lfs,
           v.blueprint_count_for_gaps, v.variant_count_for_gaps,
           v.approved_question_count_for_gaps, v.question_deficit_total,
           v.recommendation
    FROM public.v_lf_repair_hotloops_classified v
    LEFT JOIN public.course_packages cp ON cp.id = v.package_id
    ORDER BY v.fail_count DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_lf_repair_hotloop_classifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_lf_repair_hotloop_classifications() TO authenticated;

-- ============================================================================
-- 4. Error-Code Normalizer V2 (kontextsensitiv für LF-Repair)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_normalize_job_error_code(p_last_error text, p_job_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_job_type = 'package_repair_exam_pool_lf_coverage'
         AND (p_last_error ILIKE '%LF_COVERAGE_GAP%' OR p_last_error ILIKE '%Gate not PASS%')
      THEN 'LF_REPAIR_GATE_NOT_PASS'   -- generic fallback, wird via classified-view aufgelöst
    ELSE public.fn_normalize_job_error_code(p_last_error)
  END;
$$;

-- ============================================================================
-- 5. Auto-Audit Trigger (post-fail)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_audit_lf_repair_failure_classified()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_class record;
BEGIN
  IF NEW.job_type <> 'package_repair_exam_pool_lf_coverage' THEN RETURN NEW; END IF;
  IF NEW.status <> 'failed' THEN RETURN NEW; END IF;
  IF OLD.status = 'failed' THEN RETURN NEW; END IF;
  IF NEW.package_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_class FROM public.fn_classify_lf_repair_root_cause(NEW.package_id) LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.auto_heal_log
    (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES
    ('fn_audit_lf_repair_failure_classified', 'lf_repair_failure_classified',
     NEW.package_id::text, 'package', 'classified',
     format('%s — %s', v_class.subcode, v_class.reason_detail),
     jsonb_build_object(
       'package_id', NEW.package_id,
       'job_id', NEW.id,
       'job_type', NEW.job_type,
       'subcode', v_class.subcode,
       'missing_lfs', v_class.missing_lfs,
       'blueprint_count_for_gaps', v_class.blueprint_count_for_gaps,
       'variant_count_for_gaps', v_class.variant_count_for_gaps,
       'approved_question_count_for_gaps', v_class.approved_question_count_for_gaps,
       'question_deficit_total', v_class.question_deficit_total,
       'recommendation', v_class.recommendation,
       'last_error', left(COALESCE(NEW.last_error,''), 400)
     ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_lf_repair_failure_classified ON public.job_queue;
CREATE TRIGGER trg_audit_lf_repair_failure_classified
AFTER UPDATE OF status ON public.job_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_lf_repair_failure_classified();

-- ============================================================================
-- 6. Smoke
-- ============================================================================
DO $$
DECLARE
  v_a record; v_b record;
BEGIN
  SELECT * INTO v_a FROM public.fn_classify_lf_repair_root_cause('b064f0c5-489b-4469-b7e0-774b4ca4f445'::uuid);
  SELECT * INTO v_b FROM public.fn_classify_lf_repair_root_cause('5d74dcbf-8ae7-4c82-b181-09e23f02dd2c'::uuid);
  RAISE NOTICE 'b064f0c5 subcode=% — %', v_a.subcode, v_a.reason_detail;
  RAISE NOTICE '5d74dcbf subcode=% — %', v_b.subcode, v_b.reason_detail;
END$$;
