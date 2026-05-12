-- Concern: Classifier um COVERAGE_GAP-Bucket erweitern (Migration-Discipline: 1 Concern)
CREATE OR REPLACE FUNCTION public.fn_classify_publish_last_error(p_last_error text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_last_error IS NULL OR length(trim(p_last_error)) = 0 THEN NULL
    WHEN p_last_error ILIKE '%COVERAGE_GAP_BELOW_TRACK_THRESHOLD%'
      OR p_last_error ILIKE '%competency_question_coverage_pct%'
      OR p_last_error ILIKE '%below track-min%'                              THEN 'COVERAGE_GAP'
    WHEN p_last_error ILIKE '%COURSE_PUBLISH_READINESS_BLOCKED%'
      OR p_last_error ILIKE '%missing {modules%'
      OR p_last_error ILIKE '%missing {lessons%'
      OR p_last_error ILIKE '%track_aware%'                                  THEN 'TRACK_GUARD'
    WHEN p_last_error ILIKE '%PRICING_%'
      OR p_last_error ILIKE '%stripe_price_id%'
      OR p_last_error ILIKE '%product_id%'
      OR p_last_error ILIKE '%active price%'
      OR p_last_error ILIKE '%pricing_ready%'                                THEN 'PRICING_PRODUCT'
    WHEN p_last_error ILIKE '%council_approved%'
      OR p_last_error ILIKE '%integrity_report%'
      OR p_last_error ILIKE '%must produce artifact%'
      OR p_last_error ILIKE '%COUNCIL_GATE%'
      OR p_last_error ILIKE '%LESSON_QC_GATE%'
      OR p_last_error ILIKE '%COURSE_READY%'                                 THEN 'PUBLISH_ARTIFACT'
    WHEN p_last_error ILIKE '%BRONZE_LOCKED%'
      OR p_last_error ILIKE '%bronze_lock%'                                  THEN 'BRONZE_LOCK'
    WHEN p_last_error LIKE 'PARKED_AWAITING_PRECONDITION%'
      OR p_last_error ILIKE '%PARKED_PREREQ%'                                THEN 'PARKED_PREREQ'
    WHEN p_last_error ILIKE '%REQUEUE_LOOP%'
      OR p_last_error ILIKE '%ROOT_CAUSE_HEALED%'
      OR p_last_error ILIKE '%STEP_ALREADY_DONE%'                            THEN 'NOOP_LOOP'
    ELSE 'OTHER'
  END;
$function$;

-- Smoke-Test
DO $$
DECLARE
  v_result text;
BEGIN
  v_result := public.fn_classify_publish_last_error('auto-publish TERMINAL: COVERAGE_GAP_BELOW_TRACK_THRESHOLD: competency_question_coverage_pct=70.7 below track-min=80.0');
  IF v_result <> 'COVERAGE_GAP' THEN
    RAISE EXCEPTION 'Smoke failed: expected COVERAGE_GAP, got %', v_result;
  END IF;
  v_result := public.fn_classify_publish_last_error('PRICING_NOT_READY');
  IF v_result <> 'PRICING_PRODUCT' THEN
    RAISE EXCEPTION 'Smoke failed: expected PRICING_PRODUCT, got %', v_result;
  END IF;
END$$;

INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
VALUES ('classifier_coverage_gap_bucket_added','system','success',
  'fn_classify_publish_last_error erweitert um COVERAGE_GAP-Bucket; Smoke green',
  jsonb_build_object('rollback','revert function to v1 (without COVERAGE_GAP branch)','concern','classifier_only'));