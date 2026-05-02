-- ============================================================
-- Quality-Gate Auto-Heal v2.1 — Hardening Patch
-- Fixes 8 deploy-blockers from review:
--   1. SELECT * INTO (was bereits ok in classify, jetzt überall)
--   2. COUNT(*) statt COUNT()
--   3. FOR v_action IN SELECT value FROM jsonb_array_elements(...) AS t(value)
--   4. JSONB-Boolean-Cast robust
--   5. SSOT job_types: package_repair_exam_pool_*  (kein replace())
--   6. Step-Reset minimal-invasiv: nur generate_exam_pool→queued, downstream→pending_enqueue
--   7. Aktiv-Job-Detect erweitert auf package_repair_% + package_generate_exam_pool + package_validate_exam_pool
--   8. Cron-Ausdruck '15 * * * *'
--   + Architektur: Single-Action-Enqueue nach Priorität (LF→Quality→Competency)
-- ============================================================

-- ---------- 1) Classifier mit korrekten Job-Type-Mappings + Priorität ----------
CREATE OR REPLACE FUNCTION public.fn_classify_quality_gate_block(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_failed_rules text[];
  v_plan jsonb := '[]'::jsonb;
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

  -- Aktiv-Repair-Jobs: explizit auf SSOT job_types
  SELECT COUNT(*) INTO v_active_repair_jobs
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND status IN ('pending','processing')
    AND (
      job_type LIKE 'package_repair_%'
      OR job_type IN ('package_generate_exam_pool','package_validate_exam_pool')
    );

  SELECT COUNT(*) INTO v_recent_auto_heals
  FROM public.auto_heal_log
  WHERE target_id = p_package_id::text
    AND action_type = 'quality_gate_auto_heal'
    AND result_status = 'healed'
    AND created_at > now() - interval '24 hours';

  -- ── Priorität: LF Coverage → Blueprint/Quality → Competency Coverage ──
  -- Single-Action-Plan (verhindert Race Conditions / parallele Repairs)
  IF 'lf_coverage' = ANY(v_failed_rules) OR COALESCE(v_row.lf_coverage, 100) < 90 THEN
    v_plan := jsonb_build_array(jsonb_build_object(
      'job_type', 'package_repair_exam_pool_lf_coverage',
      'reason', 'lf_coverage_below_threshold',
      'priority', 1
    ));
  ELSIF 'min_question_count' = ANY(v_failed_rules)
     OR 'blueprint_coverage' = ANY(v_failed_rules) THEN
    v_plan := jsonb_build_array(jsonb_build_object(
      'job_type', 'package_repair_exam_pool_quality',
      'reason', 'min_count_or_blueprint_coverage',
      'priority', 2,
      'target_total', 500
    ));
  ELSIF 'competency_coverage' = ANY(v_failed_rules) THEN
    v_plan := jsonb_build_array(jsonb_build_object(
      'job_type', 'package_repair_exam_pool_competency_coverage',
      'reason', 'competency_coverage_below_threshold',
      'priority', 3
    ));
  ELSE
    v_plan := jsonb_build_array(jsonb_build_object(
      'job_type', 'package_repair_exam_pool_quality',
      'reason', 'generic_quality_block',
      'priority', 99
    ));
  END IF;

  RETURN jsonb_build_object(
    'classified', true,
    'reason_code', 'QUALITY_GATE_FAILED',
    'package_id', p_package_id,
    'mode', 'hard',
    'reset_from_step', 'generate_exam_pool',
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
$function$;

-- ---------- 2) Auto-Trigger mit allen Hardening-Fixes ----------
CREATE OR REPLACE FUNCTION public.fn_auto_trigger_quality_gate_heal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled_jsonb jsonb;
  v_enabled boolean;
  v_pkg record;
  v_classification jsonb;
  v_action_row record;
  v_curriculum_id uuid;
  v_job_type text;
  v_healed int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_skip_reasons jsonb := '[]'::jsonb;
BEGIN
  -- ── Fix #4: Robuster JSONB-Boolean-Cast ──
  SELECT value INTO v_enabled_jsonb FROM public.admin_settings WHERE key = 'quality_gate_auto_heal_enabled';
  v_enabled := COALESCE(
    CASE
      WHEN v_enabled_jsonb IS NULL THEN false
      WHEN jsonb_typeof(v_enabled_jsonb) = 'boolean' THEN (v_enabled_jsonb #>> '{}')::boolean
      WHEN jsonb_typeof(v_enabled_jsonb) = 'string'  THEN (v_enabled_jsonb #>> '{}')::boolean
      ELSE false
    END,
    false
  );

  IF NOT v_enabled THEN
    INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
    VALUES ('quality_gate_auto_heal','skipped','system','global', jsonb_build_object('reason','kill_switch_disabled'));
    RETURN jsonb_build_object('status','disabled');
  END IF;

  FOR v_pkg IN
    SELECT package_id, title, minutes_since_report, curriculum_id
    FROM public.v_quality_gate_blocked_packages
    WHERE minutes_since_report >= 60
    ORDER BY minutes_since_report DESC
    LIMIT 20
  LOOP
    v_classification := public.fn_classify_quality_gate_block(v_pkg.package_id);
    v_curriculum_id := v_pkg.curriculum_id;

    IF NOT (v_classification->'guards'->>'eligible_for_auto_heal')::boolean THEN
      v_skipped := v_skipped + 1;
      v_skip_reasons := v_skip_reasons || jsonb_build_object(
        'package_id', v_pkg.package_id,
        'guards', v_classification->'guards'
      );
      CONTINUE;
    END IF;

    BEGIN
      -- ── Fix #6: Step-Reset minimal & DAG-konform ──
      -- generate_exam_pool → queued (bekommt Repair-Job)
      UPDATE public.package_steps
      SET status='queued',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'guard_state','quality_gate_heal_in_progress',
            'stall_reason_code','QUALITY_GATE_AUTO_HEAL_TRIGGERED',
            'last_guard_action','auto_reset_by_quality_gate_cron',
            'auto_heal_at', now(),
            'allow_regression', true,
            'allow_regression_by','ops_sweep'
          )
      WHERE package_id = v_pkg.package_id
        AND step_key = 'generate_exam_pool';

      -- Downstream → pending_enqueue (lässt DAG/Atomic-Enqueue die Reihenfolge übernehmen)
      UPDATE public.package_steps
      SET status='pending_enqueue',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'reset_by','quality_gate_auto_heal',
            'reset_at', now(),
            'allow_regression', true,
            'allow_regression_by','ops_sweep'
          )
      WHERE package_id = v_pkg.package_id
        AND step_key IN ('validate_exam_pool','quality_council','run_integrity_check','auto_publish');

      -- ── Fix #3 + #5: korrekte FOR-Syntax + SSOT job_type aus Plan ──
      -- ── Architektur: Single-Action-Enqueue (nur erster Plan-Eintrag nach Priorität) ──
      FOR v_action_row IN
        SELECT value
        FROM jsonb_array_elements(v_classification->'enqueue_plan') AS t(value)
        ORDER BY (value->>'priority')::int NULLS LAST
        LIMIT 1
      LOOP
        v_job_type := v_action_row.value->>'job_type';

        INSERT INTO public.job_queue(package_id, job_type, status, payload, job_name)
        VALUES (
          v_pkg.package_id,
          v_job_type,
          'pending',
          jsonb_build_object(
            'package_id', v_pkg.package_id,
            'curriculum_id', v_curriculum_id,
            'triggered_by','quality_gate_auto_heal',
            'source','auto_heal',
            'is_repair', true,
            'mode', 'targeted',
            'reason', v_action_row.value->>'reason',
            'priority', v_action_row.value->>'priority',
            'exclude_deprecated_blueprints', true
          ),
          'auto_heal/' || v_pkg.package_id::text || '/' || v_job_type
        );
      END LOOP;

      v_healed := v_healed + 1;
      INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
      VALUES ('quality_gate_auto_heal','healed','course_package', v_pkg.package_id::text,
              jsonb_build_object(
                'title', v_pkg.title,
                'classification', v_classification,
                'minutes_blocked', v_pkg.minutes_since_report,
                'enqueued_job_type', v_job_type
              ));
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
      VALUES ('quality_gate_auto_heal','failed','course_package', v_pkg.package_id::text,
              jsonb_build_object('error', SQLERRM, 'classification', v_classification));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status','ok',
    'healed', v_healed,
    'skipped', v_skipped,
    'failed', v_failed,
    'skip_reasons', v_skip_reasons
  );
END;
$function$;

-- ---------- 3) Cron-Fix: Ausdruck '15 * * * *' (war kaputt: '15    ') ----------
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'quality-gate-auto-heal-hourly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'quality-gate-auto-heal-hourly',
  '15 * * * *',
  $$ SELECT public.fn_auto_trigger_quality_gate_heal(); $$
);

-- ---------- 4) Grants (Admin-RPC-Pattern bleibt) ----------
REVOKE ALL ON FUNCTION public.fn_classify_quality_gate_block(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_classify_quality_gate_block(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_auto_trigger_quality_gate_heal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_trigger_quality_gate_heal() TO service_role;