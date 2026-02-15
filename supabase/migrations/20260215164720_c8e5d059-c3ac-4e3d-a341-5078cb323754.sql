
-- ═══════════════════════════════════════════════════════════════
-- Escalation Engine v2: Hardened with all 6 audit findings
-- 1) Adaptive thresholds (rolling avg baseline, not static)
-- 2) GREATEST(1,...) concurrency floor
-- 3) Multi-jobtype pause guard (max 2 paused at once)
-- 4) Quality floor guard (no downshift if avg quality < 75)
-- 5) Conditional restore (metric-based, not timer-only)
-- 6) Backlog spiral guard (no further reduction if backlog growing)
-- ═══════════════════════════════════════════════════════════════

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
  v_24h_ago timestamptz := v_now - interval '24 hours';
  v_rec record;

  -- Error metrics
  v_failed_1h int;
  v_total_1h int;
  v_error_rate_1h numeric;
  v_failed_24h int;
  v_total_24h int;
  v_error_rate_24h numeric;
  v_adaptive_threshold numeric;

  -- Concurrency
  v_current_max int;
  v_new_max int;

  -- Backlog
  v_pending_now int;
  v_pending_5m_ago int;
  v_backlog_growing boolean := false;

  -- Quality
  v_avg_quality numeric;

  -- Budget
  v_budget_row record;
  v_budget_pct numeric;

  -- Pause guard
  v_paused_count int;

  v_actions jsonb := '[]'::jsonb;
BEGIN
  -- ══════════════════════════════════════════════════════════
  -- BASELINE METRICS
  -- ══════════════════════════════════════════════════════════
  
  -- 1h window
  SELECT count(*) FILTER (WHERE status = 'failed' AND updated_at >= v_1h_ago),
         count(*) FILTER (WHERE updated_at >= v_1h_ago AND status IN ('completed','failed','cancelled'))
  INTO v_failed_1h, v_total_1h
  FROM public.job_queue;

  v_error_rate_1h := CASE WHEN v_total_1h > 5 THEN (v_failed_1h::numeric / v_total_1h) * 100 ELSE 0 END;

  -- 24h rolling baseline
  SELECT count(*) FILTER (WHERE status = 'failed' AND updated_at >= v_24h_ago),
         count(*) FILTER (WHERE updated_at >= v_24h_ago AND status IN ('completed','failed','cancelled'))
  INTO v_failed_24h, v_total_24h
  FROM public.job_queue;

  v_error_rate_24h := CASE WHEN v_total_24h > 20 THEN (v_failed_24h::numeric / v_total_24h) * 100 ELSE 5 END;

  -- ADAPTIVE THRESHOLD: 1.8x of 24h baseline, minimum 20%, maximum 60%
  v_adaptive_threshold := GREATEST(20, LEAST(60, v_error_rate_24h * 1.8));

  -- Current concurrency
  SELECT COALESCE((value)::int, 5) INTO v_current_max
  FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages';

  -- BACKLOG SPIRAL GUARD: compare pending now vs recent snapshot
  SELECT count(*) INTO v_pending_now
  FROM public.job_queue WHERE status = 'pending';

  SELECT COALESCE(pending_count, v_pending_now)
  INTO v_pending_5m_ago
  FROM public.backpressure_snapshots
  WHERE snapshot_at >= v_now - interval '10 minutes'
  ORDER BY snapshot_at DESC LIMIT 1;

  v_backlog_growing := (v_pending_now > v_pending_5m_ago * 1.3 AND v_pending_now > 10);

  -- How many job types are currently paused?
  SELECT count(*) INTO v_paused_count
  FROM public.jobtype_limits WHERE max_processing = 0;

  -- Average quality score (recent 100 validations)
  SELECT COALESCE(avg(overall_score), 95)
  INTO v_avg_quality
  FROM (
    SELECT overall_score FROM public.ai_validations
    ORDER BY validated_at DESC LIMIT 100
  ) recent;

  -- ══════════════════════════════════════════════════════════
  -- LEVEL 2: Adaptive Concurrency Downscale
  -- Uses rolling baseline, backlog spiral guard, floor at 1
  -- ══════════════════════════════════════════════════════════
  IF v_error_rate_1h > v_adaptive_threshold
     AND v_total_1h >= 10
     AND v_current_max > 1
     AND NOT v_backlog_growing  -- SPIRAL GUARD: don't reduce if backlog is growing
  THEN
    v_new_max := GREATEST(1, v_current_max - 1);  -- FLOOR GUARD: never below 1
    UPDATE public.ops_pipeline_config 
    SET value = v_new_max::text::jsonb, updated_at = v_now, updated_by = 'escalation_engine'
    WHERE key = 'max_concurrent_packages';

    INSERT INTO public.escalation_log (escalation_level, action_type, target, old_value, new_value, reason, auto_restore_at)
    VALUES (2, 'downscale_concurrency', 'system',
            jsonb_build_object('max_concurrent', v_current_max),
            jsonb_build_object('max_concurrent', v_new_max),
            format('Error rate %.1f%% > adaptive threshold %.1f%% (24h baseline %.1f%%), backlog_growing=%s',
                   v_error_rate_1h, v_adaptive_threshold, v_error_rate_24h, v_backlog_growing),
            v_now + interval '30 minutes');

    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'level', 2, 'action', 'downscale', 'from', v_current_max, 'to', v_new_max,
      'error_rate', round(v_error_rate_1h, 1), 'threshold', round(v_adaptive_threshold, 1)
    ));
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- LEVEL 3: Failure Pattern Auto-Pause per job_type
  -- GUARD: max 2 job types paused at once; only if isolated failure
  -- ══════════════════════════════════════════════════════════
  IF v_paused_count < 2 THEN
    FOR v_rec IN
      SELECT job_type, count(*) as fail_count
      FROM public.job_queue
      WHERE status = 'failed' AND updated_at >= v_1h_ago
      GROUP BY job_type
      HAVING count(*) >= 15
      ORDER BY count(*) DESC
      LIMIT 1  -- Only pause the worst offender per cycle
    LOOP
      -- ISOLATION CHECK: only pause if other job types are healthy
      IF EXISTS (
        SELECT 1 FROM public.job_queue
        WHERE status = 'completed' AND updated_at >= v_1h_ago
        AND job_type != v_rec.job_type
        LIMIT 1
      ) THEN
        -- Store old value before pause
        DECLARE
          v_old_max int;
        BEGIN
          SELECT max_processing INTO v_old_max
          FROM public.jobtype_limits WHERE job_type = v_rec.job_type;

          IF v_old_max IS NOT NULL AND v_old_max > 0 THEN
            UPDATE public.jobtype_limits SET max_processing = 0
            WHERE job_type = v_rec.job_type;

            INSERT INTO public.escalation_log (escalation_level, action_type, target, old_value, new_value, reason, auto_restore_at)
            VALUES (3, 'pause_jobtype', v_rec.job_type,
                    jsonb_build_object('max_processing', v_old_max),
                    '{"max_processing": 0}'::jsonb,
                    format('%s failures in 1h (isolated, other types healthy)', v_rec.fail_count),
                    v_now + interval '20 minutes');

            v_actions := v_actions || jsonb_build_array(jsonb_build_object(
              'level', 3, 'action', 'pause', 'job_type', v_rec.job_type, 'failures', v_rec.fail_count
            ));
          END IF;
        END;
      END IF;
    END LOOP;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- LEVEL 4: Cost-aware Model Downshift
  -- QUALITY FLOOR GUARD: no downshift if avg quality < 75
  -- ══════════════════════════════════════════════════════════
  SELECT budget_eur, spent_eur INTO v_budget_row
  FROM public.ai_cost_budgets
  ORDER BY month DESC LIMIT 1;

  IF v_budget_row IS NOT NULL AND v_budget_row.budget_eur > 0 THEN
    v_budget_pct := (v_budget_row.spent_eur / v_budget_row.budget_eur) * 100;

    IF v_budget_pct >= 85
       AND v_avg_quality >= 75  -- QUALITY FLOOR: don't downshift if quality already low
       AND NOT EXISTS (
         SELECT 1 FROM public.escalation_log
         WHERE action_type = 'model_downshift' AND created_at >= v_now - interval '2 hours'
       )
    THEN
      UPDATE public.model_routing_rules
      SET enabled = false, updated_at = v_now
      WHERE intent IN ('exam_questions','oral_exam','minicheck','support','summary','blooms_classify','repair')
        AND is_fallback = false
        AND model NOT LIKE '%mini%';

      UPDATE public.model_routing_rules
      SET enabled = true, updated_at = v_now
      WHERE intent IN ('exam_questions','oral_exam','minicheck','support','summary','blooms_classify','repair')
        AND (model LIKE '%mini%' OR model LIKE '%deepseek%');

      INSERT INTO public.escalation_log (escalation_level, action_type, target, old_value, new_value, reason, auto_restore_at)
      VALUES (4, 'model_downshift', 'cost_intents',
              jsonb_build_object('budget_pct', round(v_budget_pct), 'avg_quality', round(v_avg_quality, 1)),
              jsonb_build_object('downshifted_intents', '["exam_questions","oral_exam","minicheck","support","summary","blooms_classify","repair"]'),
              format('Budget at %.0f%%, quality floor OK (%.1f >= 75)', v_budget_pct, v_avg_quality),
              v_now + interval '24 hours');

      v_actions := v_actions || jsonb_build_array(jsonb_build_object(
        'level', 4, 'action', 'model_downshift', 'budget_pct', round(v_budget_pct), 'quality', round(v_avg_quality, 1)
      ));
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- AUTO-RESTORE: Conditional (metric-based + timer fallback)
  -- Restore when: error_rate < threshold AND timer expired
  -- ══════════════════════════════════════════════════════════
  FOR v_rec IN
    SELECT * FROM public.escalation_log
    WHERE auto_restore_at IS NOT NULL AND auto_restore_at <= v_now
    ORDER BY created_at
  LOOP
    -- Additional condition check before restoring
    DECLARE
      v_should_restore boolean := true;
    BEGIN
      IF v_rec.action_type = 'downscale_concurrency' THEN
        -- Only restore if error rate is now below adaptive threshold
        IF v_error_rate_1h > v_adaptive_threshold * 0.7 THEN
          v_should_restore := false;
          -- Extend timer by 15 minutes
          UPDATE public.escalation_log SET auto_restore_at = v_now + interval '15 minutes' WHERE id = v_rec.id;
        END IF;

      ELSIF v_rec.action_type = 'pause_jobtype' THEN
        -- Only restore if that job type hasn't failed again recently
        IF EXISTS (
          SELECT 1 FROM public.job_queue
          WHERE job_type = v_rec.target AND status = 'failed'
          AND updated_at >= v_now - interval '10 minutes'
          LIMIT 1
        ) THEN
          v_should_restore := false;
          UPDATE public.escalation_log SET auto_restore_at = v_now + interval '10 minutes' WHERE id = v_rec.id;
        END IF;

      ELSIF v_rec.action_type = 'model_downshift' THEN
        -- Only restore if budget is back below 70%
        IF v_budget_row IS NOT NULL AND v_budget_row.budget_eur > 0 THEN
          IF (v_budget_row.spent_eur / v_budget_row.budget_eur) * 100 >= 70 THEN
            v_should_restore := false;
            UPDATE public.escalation_log SET auto_restore_at = v_now + interval '2 hours' WHERE id = v_rec.id;
          END IF;
        END IF;
      END IF;

      IF v_should_restore THEN
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
          UPDATE public.model_routing_rules SET enabled = true, updated_at = v_now;
        END IF;

        UPDATE public.escalation_log SET auto_restore_at = NULL WHERE id = v_rec.id;

        INSERT INTO public.escalation_log (escalation_level, action_type, target, reason)
        VALUES (0, 'restore', v_rec.target, format('Conditional restore: metrics OK after escalation %s', v_rec.id));

        v_actions := v_actions || jsonb_build_array(jsonb_build_object('level', 0, 'action', 'restore', 'target', v_rec.target));
      END IF;
    END;
  END LOOP;

  v_result := jsonb_build_object(
    'ts', v_now,
    'error_rate_1h', round(v_error_rate_1h, 1),
    'error_rate_24h', round(v_error_rate_24h, 1),
    'adaptive_threshold', round(v_adaptive_threshold, 1),
    'failed_1h', v_failed_1h,
    'total_1h', v_total_1h,
    'pending', v_pending_now,
    'backlog_growing', v_backlog_growing,
    'avg_quality', round(v_avg_quality, 1),
    'paused_jobtypes', v_paused_count,
    'current_concurrency', v_current_max,
    'actions', v_actions
  );

  IF jsonb_array_length(v_actions) > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, result_status, metadata)
    VALUES ('escalation_cycle', 'cron', 'success', v_result);
  END IF;

  RETURN v_result;
END;
$$;
