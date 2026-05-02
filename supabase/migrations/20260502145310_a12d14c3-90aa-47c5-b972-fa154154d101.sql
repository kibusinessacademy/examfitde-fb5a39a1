-- ============================================================================
-- Heal-Engine v2: Quality-Gate First-Class + Auto-Trigger
-- ============================================================================

-- 1) KILL-SWITCH via admin_settings
INSERT INTO public.admin_settings (key, value, description)
VALUES ('quality_gate_auto_heal_enabled', 'true'::jsonb, 'Master-Switch für stündlichen Quality-Gate Auto-Heal Cron')
ON CONFLICT (key) DO NOTHING;

-- 2) VIEW: alle Pakete mit aktivem Quality-Gate-Block
CREATE OR REPLACE VIEW public.v_quality_gate_blocked_packages AS
WITH latest AS (
  SELECT DISTINCT ON (package_id)
    package_id, status, report, created_at
  FROM public.package_quality_reports
  ORDER BY package_id, created_at DESC
)
SELECT
  l.package_id,
  cp.title,
  cp.status AS package_status,
  cp.curriculum_id,
  l.created_at AS report_at,
  EXTRACT(EPOCH FROM (now() - l.created_at))/60 AS minutes_since_report,
  COALESCE((l.report->>'total_questions')::int, 0) AS total_questions,
  COALESCE((l.report->>'blueprint_coverage')::numeric, 0) AS blueprint_coverage,
  COALESCE((l.report->>'lf_coverage')::numeric, 0) AS lf_coverage,
  COALESCE((l.report->>'competency_coverage_pct')::numeric, 0) AS competency_coverage,
  (
    SELECT array_agg(r->>'rule_key')
    FROM jsonb_array_elements(l.report->'results') r
    WHERE (r->>'passed')::boolean = false AND r->>'severity' = 'block'
  ) AS failed_block_rules,
  l.report AS full_report
FROM latest l
JOIN public.course_packages cp ON cp.id = l.package_id
WHERE l.status = 'fail'
  AND cp.status NOT IN ('published', 'archived');

REVOKE ALL ON public.v_quality_gate_blocked_packages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_quality_gate_blocked_packages TO service_role;

-- 3) FUNKTION: Klassifikation + Heilplan-Ableitung
CREATE OR REPLACE FUNCTION public.fn_classify_quality_gate_block(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_failed_rules text[];
  v_plan jsonb := '[]'::jsonb;
  v_reset_step text := 'generate_exam_pool';
  v_active_repair_jobs int;
  v_recent_auto_heals int;
BEGIN
  SELECT * INTO v_row
  FROM public.v_quality_gate_blocked_packages
  WHERE package_id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('classified', false, 'reason', 'no_active_quality_gate_block');
  END IF;

  v_failed_rules := COALESCE(v_row.failed_block_rules, ARRAY[]::text[]);

  SELECT COUNT(*) INTO v_active_repair_jobs
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND status IN ('pending','processing')
    AND (job_type LIKE 'repair_%' OR job_type IN ('generate_exam_pool','validate_exam_pool'));

  SELECT COUNT(*) INTO v_recent_auto_heals
  FROM public.auto_heal_log
  WHERE target_id = p_package_id::text
    AND action_type = 'quality_gate_auto_heal'
    AND result_status = 'healed'
    AND created_at > now() - interval '24 hours';

  IF 'lf_coverage' = ANY(v_failed_rules) OR v_row.lf_coverage < 90 THEN
    v_plan := v_plan || jsonb_build_object('action', 'enqueue_repair_exam_pool_lf_coverage', 'reason', 'lf_coverage_below_threshold');
  END IF;

  IF 'min_question_count' = ANY(v_failed_rules) THEN
    v_plan := v_plan || jsonb_build_object('action', 'enqueue_repair_exam_pool_quality', 'reason', 'min_question_count_unmet', 'target_total', 500);
  END IF;

  IF 'blueprint_coverage' = ANY(v_failed_rules) THEN
    v_plan := v_plan || jsonb_build_object('action', 'enqueue_repair_exam_pool_quality', 'reason', 'blueprint_coverage_below_threshold');
  END IF;

  IF 'competency_coverage' = ANY(v_failed_rules) THEN
    v_plan := v_plan || jsonb_build_object('action', 'enqueue_repair_exam_pool_competency_coverage', 'reason', 'competency_coverage_below_threshold');
  END IF;

  IF jsonb_array_length(v_plan) = 0 THEN
    v_plan := jsonb_build_array(jsonb_build_object('action', 'enqueue_repair_exam_pool_quality', 'reason', 'generic_quality_block'));
  END IF;

  RETURN jsonb_build_object(
    'classified', true,
    'reason_code', 'QUALITY_GATE_FAILED',
    'package_id', p_package_id,
    'mode', 'hard',
    'reset_from_step', v_reset_step,
    'enqueue_plan', v_plan,
    'failed_rules', to_jsonb(v_failed_rules),
    'metrics', jsonb_build_object(
      'total_questions', v_row.total_questions,
      'blueprint_coverage', v_row.blueprint_coverage,
      'lf_coverage', v_row.lf_coverage,
      'competency_coverage', v_row.competency_coverage,
      'minutes_since_report', v_row.minutes_since_report
    ),
    'guards', jsonb_build_object(
      'active_repair_jobs', v_active_repair_jobs,
      'recent_auto_heals_24h', v_recent_auto_heals,
      'eligible_for_auto_heal',
        v_active_repair_jobs = 0
        AND v_recent_auto_heals < 3
        AND v_row.minutes_since_report >= 60
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_classify_quality_gate_block(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_classify_quality_gate_block(uuid) TO service_role;

-- 4) ADMIN RPC mit Rollen-Gate
CREATE OR REPLACE FUNCTION public.admin_classify_package_root_cause(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN public.fn_classify_quality_gate_block(p_package_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_classify_package_root_cause(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_classify_package_root_cause(uuid) TO authenticated;

-- 5) AUTO-TRIGGER FUNKTION
CREATE OR REPLACE FUNCTION public.fn_auto_trigger_quality_gate_heal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled_jsonb jsonb;
  v_enabled boolean;
  v_pkg record;
  v_classification jsonb;
  v_action jsonb;
  v_healed int := 0;
  v_skipped int := 0;
  v_skip_reasons jsonb := '[]'::jsonb;
BEGIN
  SELECT value INTO v_enabled_jsonb FROM public.admin_settings WHERE key = 'quality_gate_auto_heal_enabled';
  v_enabled := COALESCE((v_enabled_jsonb)::text::boolean, false);

  IF NOT v_enabled THEN
    INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
    VALUES ('quality_gate_auto_heal', 'skipped', 'system', 'global', jsonb_build_object('reason', 'kill_switch_disabled'));
    RETURN jsonb_build_object('status', 'disabled');
  END IF;

  FOR v_pkg IN
    SELECT package_id, title, minutes_since_report
    FROM public.v_quality_gate_blocked_packages
    WHERE minutes_since_report >= 60
    ORDER BY minutes_since_report DESC
    LIMIT 20
  LOOP
    v_classification := public.fn_classify_quality_gate_block(v_pkg.package_id);

    IF NOT (v_classification->'guards'->>'eligible_for_auto_heal')::boolean THEN
      v_skipped := v_skipped + 1;
      v_skip_reasons := v_skip_reasons || jsonb_build_object(
        'package_id', v_pkg.package_id,
        'guards', v_classification->'guards'
      );
      CONTINUE;
    END IF;

    BEGIN
      UPDATE public.package_steps
      SET status = 'queued',
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'guard_state', 'quality_gate_heal_in_progress',
            'stall_reason_code', 'QUALITY_GATE_AUTO_HEAL_TRIGGERED',
            'last_guard_action', 'auto_reset_by_quality_gate_cron',
            'auto_heal_at', now()
          )
      WHERE package_id = v_pkg.package_id
        AND step_key IN ('generate_exam_pool','validate_exam_pool','quality_council','run_integrity_check','auto_publish');

      FOR v_action IN SELECT * FROM jsonb_array_elements(v_classification->'enqueue_plan')
      LOOP
        DECLARE
          v_job_type text;
        BEGIN
          v_job_type := replace(v_action->>'action', 'enqueue_', '');
          INSERT INTO public.job_queue(package_id, job_type, status, payload, source)
          VALUES (
            v_pkg.package_id,
            v_job_type,
            'pending',
            jsonb_build_object(
              'package_id', v_pkg.package_id,
              'triggered_by', 'quality_gate_auto_heal',
              'reason', v_action->>'reason',
              'exclude_deprecated_blueprints', true
            ),
            'auto_heal'
          );
        END;
      END LOOP;

      v_healed := v_healed + 1;

      INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
      VALUES (
        'quality_gate_auto_heal',
        'healed',
        'course_package',
        v_pkg.package_id::text,
        jsonb_build_object(
          'title', v_pkg.title,
          'classification', v_classification,
          'minutes_blocked', v_pkg.minutes_since_report
        )
      );
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
      VALUES (
        'quality_gate_auto_heal',
        'failed',
        'course_package',
        v_pkg.package_id::text,
        jsonb_build_object('error', SQLERRM, 'classification', v_classification)
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'healed', v_healed,
    'skipped', v_skipped,
    'skip_reasons', v_skip_reasons
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_auto_trigger_quality_gate_heal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_trigger_quality_gate_heal() TO service_role;

-- 6) CRON: stündlich Minute 15
DO $$
BEGIN
  PERFORM cron.unschedule('quality-gate-auto-heal-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'quality-gate-auto-heal-hourly',
  '15 * * * *',
  $cron$ SELECT public.fn_auto_trigger_quality_gate_heal(); $cron$
);
