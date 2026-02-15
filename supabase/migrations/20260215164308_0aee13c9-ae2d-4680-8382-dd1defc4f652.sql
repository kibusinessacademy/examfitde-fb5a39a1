
-- ═══════════════════════════════════════════════════════════════
-- Autonomous Escalation Engine: 4-Level Self-Tuning Pipeline
-- Level 1: Auto-Heal (existing)
-- Level 2: Adaptive Concurrency Downscale on error spikes
-- Level 3: Failure Pattern Auto-Pause per job_type
-- Level 4: Cost-aware Model Downshift via model_routing_rules
-- ═══════════════════════════════════════════════════════════════

-- Escalation log table
CREATE TABLE IF NOT EXISTS public.escalation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  escalation_level int NOT NULL,      -- 1-4
  action_type text NOT NULL,           -- downscale_concurrency, pause_jobtype, model_downshift, restore
  target text NOT NULL,                -- job_type or 'system' or intent
  old_value jsonb,
  new_value jsonb,
  reason text,
  auto_restore_at timestamptz          -- when to auto-restore
);

ALTER TABLE public.escalation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on escalation_log"
ON public.escalation_log FOR ALL USING (true) WITH CHECK (true);

-- ── Main Escalation Cycle Function ──────────────────────────
CREATE OR REPLACE FUNCTION public.auto_escalation_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_now timestamptz := now();
  v_1h_ago timestamptz := v_now - interval '1 hour';
  v_rec record;
  v_failed_1h int;
  v_total_1h int;
  v_error_rate numeric;
  v_current_max int;
  v_new_max int;
  v_actions jsonb := '[]'::jsonb;
  v_budget_row record;
  v_budget_pct numeric;
BEGIN
  -- ══════════════════════════════════════════════════════════
  -- LEVEL 2: Adaptive Concurrency Downscale
  -- If error rate > 30% in last hour, reduce max_concurrent_packages
  -- ══════════════════════════════════════════════════════════
  SELECT count(*) FILTER (WHERE status = 'failed' AND updated_at >= v_1h_ago),
         count(*) FILTER (WHERE updated_at >= v_1h_ago AND status IN ('completed','failed'))
  INTO v_failed_1h, v_total_1h
  FROM public.job_queue;

  v_error_rate := CASE WHEN v_total_1h > 0 THEN (v_failed_1h::numeric / v_total_1h) * 100 ELSE 0 END;

  SELECT COALESCE((value)::int, 5) INTO v_current_max
  FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages';

  IF v_error_rate > 30 AND v_total_1h >= 10 AND v_current_max > 1 THEN
    v_new_max := GREATEST(1, v_current_max - 1);
    UPDATE public.ops_pipeline_config SET value = v_new_max::text::jsonb, updated_at = v_now, updated_by = 'escalation_engine'
    WHERE key = 'max_concurrent_packages';

    INSERT INTO public.escalation_log (escalation_level, action_type, target, old_value, new_value, reason, auto_restore_at)
    VALUES (2, 'downscale_concurrency', 'system',
            jsonb_build_object('max_concurrent', v_current_max),
            jsonb_build_object('max_concurrent', v_new_max),
            format('Error rate %.0f%% (%s/%s jobs in 1h)', v_error_rate, v_failed_1h, v_total_1h),
            v_now + interval '30 minutes');

    v_actions := v_actions || jsonb_build_array(jsonb_build_object('level', 2, 'action', 'downscale', 'from', v_current_max, 'to', v_new_max));
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- LEVEL 3: Failure Pattern Auto-Pause per job_type
  -- If same job_type fails > 15 times in 1h, pause it (set max_processing=0)
  -- ══════════════════════════════════════════════════════════
  FOR v_rec IN
    SELECT job_type, count(*) as fail_count
    FROM public.job_queue
    WHERE status = 'failed' AND updated_at >= v_1h_ago
    GROUP BY job_type
    HAVING count(*) >= 15
  LOOP
    -- Check not already paused
    IF EXISTS (SELECT 1 FROM public.jobtype_limits WHERE job_type = v_rec.job_type AND max_processing > 0) THEN
      -- Store old value
      UPDATE public.jobtype_limits
      SET max_processing = 0
      WHERE job_type = v_rec.job_type;

      INSERT INTO public.escalation_log (escalation_level, action_type, target, old_value, new_value, reason, auto_restore_at)
      VALUES (3, 'pause_jobtype', v_rec.job_type,
              (SELECT jsonb_build_object('max_processing', max_processing) FROM public.jobtype_limits WHERE job_type = v_rec.job_type),
              '{"max_processing": 0}'::jsonb,
              format('%s failures in 1h for %s', v_rec.fail_count, v_rec.job_type),
              v_now + interval '20 minutes');

      v_actions := v_actions || jsonb_build_array(jsonb_build_object('level', 3, 'action', 'pause', 'job_type', v_rec.job_type, 'failures', v_rec.fail_count));
    END IF;
  END LOOP;

  -- ══════════════════════════════════════════════════════════
  -- LEVEL 4: Cost-aware Model Downshift
  -- If monthly budget > 85%, downshift expensive models to cheaper ones
  -- ══════════════════════════════════════════════════════════
  SELECT budget_eur, spent_eur INTO v_budget_row
  FROM public.ai_cost_budgets
  ORDER BY month DESC LIMIT 1;

  IF v_budget_row IS NOT NULL AND v_budget_row.budget_eur > 0 THEN
    v_budget_pct := (v_budget_row.spent_eur / v_budget_row.budget_eur) * 100;

    IF v_budget_pct >= 85 THEN
      -- Downshift: disable expensive primary models, promote mini/fallbacks
      -- Only if not already downshifted (check escalation_log for recent downshift)
      IF NOT EXISTS (
        SELECT 1 FROM public.escalation_log
        WHERE action_type = 'model_downshift' AND created_at >= v_now - interval '2 hours'
      ) THEN
        -- Swap exam_questions, oral_exam, minicheck, support, summary to cheapest
        UPDATE public.model_routing_rules
        SET enabled = false, updated_at = v_now
        WHERE intent IN ('exam_questions','oral_exam','minicheck','support','summary','blooms_classify','repair')
          AND is_fallback = false
          AND model NOT LIKE '%mini%';

        -- Ensure mini/cheap models are enabled
        UPDATE public.model_routing_rules
        SET enabled = true, updated_at = v_now
        WHERE intent IN ('exam_questions','oral_exam','minicheck','support','summary','blooms_classify','repair')
          AND (model LIKE '%mini%' OR model LIKE '%deepseek%');

        INSERT INTO public.escalation_log (escalation_level, action_type, target, old_value, new_value, reason, auto_restore_at)
        VALUES (4, 'model_downshift', 'cost_intents',
                jsonb_build_object('budget_pct', round(v_budget_pct)),
                jsonb_build_object('downshifted_intents', '["exam_questions","oral_exam","minicheck","support","summary","blooms_classify","repair"]'),
                format('Budget at %.0f%% (€%.0f/€%.0f)', v_budget_pct, v_budget_row.spent_eur, v_budget_row.budget_eur),
                v_now + interval '24 hours');

        v_actions := v_actions || jsonb_build_array(jsonb_build_object('level', 4, 'action', 'model_downshift', 'budget_pct', round(v_budget_pct)));
      END IF;
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- AUTO-RESTORE: Undo expired escalations
  -- ══════════════════════════════════════════════════════════
  FOR v_rec IN
    SELECT * FROM public.escalation_log
    WHERE auto_restore_at IS NOT NULL AND auto_restore_at <= v_now
    ORDER BY created_at
  LOOP
    IF v_rec.action_type = 'downscale_concurrency' THEN
      UPDATE public.ops_pipeline_config
      SET value = (COALESCE((v_rec.old_value->>'max_concurrent')::int, 5))::text::jsonb,
          updated_at = v_now, updated_by = 'escalation_restore'
      WHERE key = 'max_concurrent_packages';

    ELSIF v_rec.action_type = 'pause_jobtype' THEN
      UPDATE public.jobtype_limits
      SET max_processing = COALESCE((v_rec.old_value->>'max_processing')::int, 2)
      WHERE job_type = v_rec.target;

    ELSIF v_rec.action_type = 'model_downshift' THEN
      -- Re-enable all models
      UPDATE public.model_routing_rules SET enabled = true, updated_at = v_now;
    END IF;

    -- Mark as restored
    UPDATE public.escalation_log SET auto_restore_at = NULL WHERE id = v_rec.id;

    INSERT INTO public.escalation_log (escalation_level, action_type, target, reason)
    VALUES (0, 'restore', v_rec.target, format('Auto-restored from escalation %s', v_rec.id));

    v_actions := v_actions || jsonb_build_array(jsonb_build_object('level', 0, 'action', 'restore', 'target', v_rec.target));
  END LOOP;

  v_result := jsonb_build_object(
    'ts', v_now,
    'error_rate_1h', round(v_error_rate, 1),
    'failed_1h', v_failed_1h,
    'total_1h', v_total_1h,
    'current_concurrency', v_current_max,
    'actions', v_actions
  );

  -- Log to auto_heal_log for dashboard visibility
  IF jsonb_array_length(v_actions) > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, result_status, metadata)
    VALUES ('escalation_cycle', 'cron', 'success', v_result);
  END IF;

  RETURN v_result;
END;
$$;
