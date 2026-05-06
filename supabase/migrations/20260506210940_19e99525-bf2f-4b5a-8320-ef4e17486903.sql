-- ────────────────────────────────────────────────────────────────────
-- 1) Duplicate Quality Audit View (Cross-Blueprint Classification)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_lxi_duplicate_quality_audit AS
WITH approved AS (
  SELECT cp.id AS package_id,
         cp.title,
         cp.status,
         cp.track,
         eq.canonical_hash,
         eq.blueprint_id,
         eq.variant_group,
         eq.variant_label
  FROM course_packages cp
  JOIN exam_questions eq
    ON eq.curriculum_id = cp.curriculum_id
   AND eq.status = 'approved'::question_status
   AND eq.canonical_hash IS NOT NULL
),
hash_groups AS (
  SELECT package_id, title, status, track, canonical_hash,
         COUNT(*) AS n,
         COUNT(DISTINCT blueprint_id) FILTER (WHERE blueprint_id IS NOT NULL) AS distinct_bps,
         COUNT(*) FILTER (WHERE variant_group IS NOT NULL OR variant_label IS NOT NULL) AS variant_marked
  FROM approved
  GROUP BY package_id, title, status, track, canonical_hash
),
classified AS (
  SELECT package_id, title, status, track,
    SUM(n) AS approved_with_hash,
    SUM(CASE WHEN n > 1 AND distinct_bps >= 2 THEN n - 1 ELSE 0 END)::int AS suspicious_cross_blueprint,
    SUM(CASE WHEN n > 1 AND distinct_bps <= 1 AND variant_marked = n THEN n - 1 ELSE 0 END)::int AS allowed_variant_same_blueprint,
    SUM(CASE WHEN n > 1 AND distinct_bps <= 1 AND variant_marked < n THEN n - 1 ELSE 0 END)::int AS exact_duplicate_same_blueprint
  FROM hash_groups
  GROUP BY package_id, title, status, track
)
SELECT
  package_id, title, status, track,
  approved_with_hash::int,
  suspicious_cross_blueprint,
  allowed_variant_same_blueprint,
  exact_duplicate_same_blueprint,
  CASE WHEN approved_with_hash > 0
       THEN round(100.0 * suspicious_cross_blueprint / approved_with_hash, 2)
       ELSE 0 END AS suspicious_cross_blueprint_ratio,
  CASE WHEN approved_with_hash > 0
       THEN round(100.0 * allowed_variant_same_blueprint / approved_with_hash, 2)
       ELSE 0 END AS allowed_variant_ratio,
  CASE WHEN approved_with_hash > 0
       THEN round(100.0 * exact_duplicate_same_blueprint / approved_with_hash, 2)
       ELSE 0 END AS exact_duplicate_ratio
FROM classified;

REVOKE ALL ON public.v_lxi_duplicate_quality_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_lxi_duplicate_quality_audit TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 2) Re-calibrate v_learning_integrity_audit.gate_high_duplicates
--    (track-aware wrapper, jetzt cross-blueprint based, warn-only)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_learning_integrity_audit AS
SELECT
  raw.package_id,
  raw.package_key,
  raw.title,
  raw.curriculum_id,
  raw.status,
  raw.learningfield_count,
  raw.competency_count,
  raw.lesson_count,
  raw.minicheck_count,
  raw.tutor_context_count,
  raw.oral_blueprint_count,
  raw.approved_exam_question_count,
  raw.total_exam_question_count,
  raw.duplicate_exam_question_count,
  raw.competency_coverage_pct,
  raw.blueprint_coverage_pct,
  COALESCE(d.suspicious_cross_blueprint_ratio, 0) AS duplicate_question_ratio,
  raw.gate_no_lessons,
  raw.gate_no_minichecks AND NOT COALESCE((
    SELECT bool_or(tsa.should_run = false AND tsa.condition IS NULL)
    FROM track_step_applicability tsa
    WHERE tsa.step_key = 'generate_lesson_minichecks' AND tsa.track::text = raw.track::text
  ), false) AS gate_no_minichecks,
  raw.gate_low_exam_questions,
  raw.gate_no_oral AND NOT COALESCE((
    SELECT bool_or(tsa.should_run = false AND tsa.condition IS NULL)
    FROM track_step_applicability tsa
    WHERE tsa.step_key = 'generate_oral_exam' AND tsa.track::text = raw.track::text
  ), false) AS gate_no_oral,
  raw.gate_no_tutor_context,
  raw.gate_low_competency_coverage,
  raw.gate_low_blueprint_coverage,
  -- LXI Phase 2c: nur cross-blueprint Suspicious zählt, Variants/same-bp ignoriert
  (COALESCE(d.suspicious_cross_blueprint_ratio, 0) > 15) AS gate_high_duplicates,
  raw.learning_integrity_score,
  raw.publish_learning_status,
  raw.track
FROM v_learning_integrity_audit_raw raw
LEFT JOIN v_lxi_duplicate_quality_audit d ON d.package_id = raw.package_id;

-- ────────────────────────────────────────────────────────────────────
-- 3) Admin RPC: Duplicate Quality Audit (Drilldown + Top-N)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_lxi_duplicate_quality_audit(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_top jsonb;
  v_summary jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_agg(row_to_json(t)) INTO v_top
  FROM (
    SELECT *
    FROM public.v_lxi_duplicate_quality_audit
    WHERE status = 'published'
    ORDER BY suspicious_cross_blueprint_ratio DESC, suspicious_cross_blueprint DESC
    LIMIT p_limit
  ) t;

  SELECT jsonb_build_object(
    'total_published', COUNT(*),
    'flagged_suspicious', COUNT(*) FILTER (WHERE suspicious_cross_blueprint_ratio > 15),
    'avg_suspicious_ratio', round(avg(suspicious_cross_blueprint_ratio)::numeric, 2),
    'max_suspicious_ratio', max(suspicious_cross_blueprint_ratio)
  ) INTO v_summary
  FROM public.v_lxi_duplicate_quality_audit
  WHERE status = 'published';

  -- Audit (light, only on demand)
  INSERT INTO public.auto_heal_log(target_type, action_type, result_status, metadata)
  VALUES ('system', 'lxi_gate_high_duplicates_calibrated', 'success', v_summary);

  RETURN jsonb_build_object('summary', v_summary, 'top', COALESCE(v_top, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lxi_duplicate_quality_audit(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lxi_duplicate_quality_audit(int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 4) Push queued gate_no_lessons → Build (Preview + Safety-checked Enqueue)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_push_queued_no_lessons_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.title) INTO v_rows
  FROM (
    SELECT
      cp.id AS package_id,
      cp.title,
      cp.track,
      cp.status,
      a.lesson_count,
      a.competency_count,
      (SELECT COUNT(*) FROM job_queue jq
        WHERE jq.package_id = cp.id
          AND jq.status IN ('pending','queued','processing')) AS active_jobs,
      (SELECT COUNT(*) FROM job_queue jq
        WHERE jq.package_id = cp.id AND jq.status = 'failed'
          AND jq.created_at > now() - interval '6 hours') AS recent_failed,
      COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean, false) AS bronze_locked,
      -- Eligibility = sicher zu pushen
      (cp.status = 'queued'
        AND COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean, false) = false
        AND NOT EXISTS (SELECT 1 FROM job_queue jq
                          WHERE jq.package_id = cp.id
                            AND jq.status IN ('pending','queued','processing'))
        AND NOT EXISTS (SELECT 1 FROM job_queue jq
                          WHERE jq.package_id = cp.id AND jq.status = 'failed'
                            AND jq.created_at > now() - interval '6 hours')
      ) AS eligible
    FROM course_packages cp
    JOIN v_learning_integrity_audit a ON a.package_id = cp.id
    WHERE cp.status = 'queued' AND a.gate_no_lessons = true AND cp.archived = false
  ) t;

  RETURN jsonb_build_object(
    'total', COALESCE(jsonb_array_length(v_rows), 0),
    'eligible', (SELECT COUNT(*) FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) e WHERE (e->>'eligible')::boolean),
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_push_queued_no_lessons_preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_push_queued_no_lessons_preview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_push_queued_no_lessons_to_build(
  p_dry_run boolean DEFAULT true,
  p_max int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg uuid;
  v_promoted int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_eligible uuid[];
  v_wip int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COUNT(*) INTO v_wip FROM course_packages WHERE status='building' AND archived=false;
  IF v_wip >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wip_cap_reached', 'wip_current', v_wip);
  END IF;

  SELECT array_agg(cp.id ORDER BY cp.title) INTO v_eligible
  FROM (
    SELECT cp.id, cp.title FROM course_packages cp
    JOIN v_learning_integrity_audit a ON a.package_id = cp.id
    WHERE cp.status = 'queued' AND a.gate_no_lessons = true AND cp.archived = false
      AND COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean, false) = false
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','queued','processing'))
      AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status = 'failed' AND jq.created_at > now() - interval '6 hours')
    LIMIT LEAST(p_max, GREATEST(0, 60 - v_wip))
  ) cp;

  IF v_eligible IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'promoted', 0, 'skipped', 0, 'reason', 'no_eligible');
  END IF;

  IF p_dry_run THEN
    INSERT INTO auto_heal_log(target_type, action_type, result_status, metadata)
    VALUES ('system','lxi_queued_no_lessons_pushed','dry_run',
      jsonb_build_object('candidates', to_jsonb(v_eligible), 'count', array_length(v_eligible,1)));
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'candidates', to_jsonb(v_eligible));
  END IF;

  FOREACH v_pkg IN ARRAY v_eligible LOOP
    BEGIN
      PERFORM public.admin_nudge_atomic_trigger(v_pkg, false);
      v_promoted := v_promoted + 1;
      v_results := v_results || jsonb_build_object('package_id', v_pkg, 'status', 'promoted');
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('package_id', v_pkg, 'status', 'skipped', 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO auto_heal_log(target_type, action_type, result_status, metadata)
  VALUES ('system','lxi_queued_no_lessons_pushed',
    CASE WHEN v_promoted > 0 THEN 'success' ELSE 'partial' END,
    jsonb_build_object('promoted', v_promoted, 'skipped', v_skipped, 'wip_before', v_wip, 'results', v_results));

  RETURN jsonb_build_object('ok', true, 'promoted', v_promoted, 'skipped', v_skipped, 'wip_before', v_wip, 'results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_push_queued_no_lessons_to_build(boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_push_queued_no_lessons_to_build(boolean, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 5) MiniCheck-Stillstands-Heal (Stuck >20min ohne Statuswechsel → Retry)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lxi_minichecks_stall_heal(
  p_stall_minutes int DEFAULT 20,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_inspected int := 0;
  v_actions jsonb := '[]'::jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT id, package_id, job_type, status, attempts, last_error, updated_at
    FROM public.job_queue
    WHERE job_type IN ('package_generate_lesson_minichecks','package_validate_lesson_minichecks')
      AND status IN ('processing','running','queued','pending')
      AND updated_at < now() - make_interval(mins => p_stall_minutes)
    ORDER BY updated_at ASC
    LIMIT p_limit
  LOOP
    v_inspected := v_inspected + 1;
    IF COALESCE(r.attempts,0) >= 5 THEN
      -- terminal: nicht endlos retry'en
      UPDATE public.job_queue
         SET status = 'failed',
             last_error = COALESCE(last_error,'') || ' [stall_heal_terminal]',
             updated_at = now()
       WHERE id = r.id;
      v_actions := v_actions || jsonb_build_object('job_id', r.id, 'package_id', r.package_id, 'action', 'terminal_failed');
    ELSE
      UPDATE public.job_queue
         SET status = 'pending',
             locked_at = NULL,
             updated_at = now()
       WHERE id = r.id;
      v_healed := v_healed + 1;
      v_actions := v_actions || jsonb_build_object('job_id', r.id, 'package_id', r.package_id, 'action', 'reset_to_pending', 'attempts', r.attempts);
    END IF;
  END LOOP;

  IF v_inspected > 0 THEN
    INSERT INTO public.auto_heal_log(target_type, action_type, result_status, metadata)
    VALUES ('system', 'lxi_minicheck_stall_heal',
      CASE WHEN v_healed > 0 THEN 'success' ELSE 'noop' END,
      jsonb_build_object('inspected', v_inspected, 'healed', v_healed,
                         'stall_minutes', p_stall_minutes, 'actions', v_actions));
  END IF;

  RETURN jsonb_build_object('inspected', v_inspected, 'healed', v_healed, 'actions', v_actions);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_lxi_minichecks_stall_heal(int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lxi_minichecks_stall_heal(int,int) TO service_role;

-- Cron alle 10 Minuten
DO $$
BEGIN
  PERFORM cron.unschedule('lxi-minicheck-stall-heal-10min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'lxi-minicheck-stall-heal-10min',
  '*/10 * * * *',
  $$SELECT public.fn_lxi_minichecks_stall_heal(20, 50);$$
);