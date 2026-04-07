
-- 1. Rebalancer v2
CREATE OR REPLACE FUNCTION public.fn_rebalance_wip_priority(
    p_max_demotions INT DEFAULT 3
)
RETURNS TABLE(
    demoted_package_id UUID,
    demoted_title TEXT,
    demoted_priority INT,
    freed_for_priority INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wip_cap INT;
    v_current_building INT;
    v_best_queued_priority INT;
    v_rec RECORD;
    v_min_progress_to_protect INT := 70;
    v_finalization_steps TEXT[] := ARRAY['quality_council', 'run_integrity_check', 'auto_publish'];
BEGIN
    SELECT COALESCE(value::int, 14) INTO v_wip_cap
    FROM ops_pipeline_config WHERE key = 'wip_total_cap';

    SELECT count(*) INTO v_current_building
    FROM course_packages WHERE status = 'building';

    SELECT min(priority) INTO v_best_queued_priority
    FROM course_packages WHERE status = 'queued' AND priority IS NOT NULL;

    IF v_best_queued_priority IS NULL THEN RETURN; END IF;
    IF v_current_building < v_wip_cap THEN RETURN; END IF;

    FOR v_rec IN
        SELECT cp.id, c.title, cp.priority, cp.build_progress
        FROM course_packages cp
        JOIN courses c ON c.id = cp.course_id
        WHERE cp.status = 'building'
          AND cp.priority > v_best_queued_priority
          AND cp.build_progress < v_min_progress_to_protect
          AND NOT EXISTS (
              SELECT 1 FROM package_steps ps
              WHERE ps.package_id = cp.id
                AND ps.step_key = ANY(v_finalization_steps)
                AND ps.status = 'processing'
          )
        ORDER BY cp.priority DESC, cp.build_progress ASC, cp.updated_at ASC
        LIMIT p_max_demotions
    LOOP
        UPDATE job_queue SET status = 'cancelled', updated_at = now()
        WHERE package_id = v_rec.id AND status = 'pending';

        UPDATE course_packages SET status = 'queued', updated_at = now()
        WHERE id = v_rec.id;

        INSERT INTO admin_actions (action, scope, affected_ids, payload)
        VALUES ('wip_priority_rebalance', 'pipeline', ARRAY[v_rec.id::text],
            jsonb_build_object(
                'demoted_package', v_rec.id, 'demoted_title', v_rec.title,
                'demoted_priority', v_rec.priority, 'demoted_progress', v_rec.build_progress,
                'best_queued_priority', v_best_queued_priority,
                'wip_before', v_current_building, 'wip_cap', v_wip_cap,
                'version', 'v2_safe_demotion'
            ));

        v_current_building := v_current_building - 1;

        demoted_package_id := v_rec.id;
        demoted_title := v_rec.title;
        demoted_priority := v_rec.priority;
        freed_for_priority := v_best_queued_priority;
        RETURN NEXT;

        IF v_current_building < v_wip_cap THEN EXIT; END IF;
    END LOOP;
    RETURN;
END;
$$;

-- 2. Bonus WIP config
INSERT INTO ops_pipeline_config (key, value)
VALUES 
    ('wip_bonus_progress_threshold', '50'),
    ('wip_bonus_slots', '4')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- 3. Helper function for effective WIP state
CREATE OR REPLACE FUNCTION public.fn_effective_wip_state()
RETURNS TABLE(
    base_cap INT,
    bonus_slots INT,
    bonus_threshold INT,
    total_building INT,
    base_building INT,
    bonus_eligible INT,
    effective_cap INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_base_cap INT;
    v_bonus_slots INT;
    v_bonus_threshold INT;
BEGIN
    SELECT COALESCE(value::int, 14) INTO v_base_cap FROM ops_pipeline_config WHERE key = 'wip_total_cap';
    SELECT COALESCE(value::int, 4) INTO v_bonus_slots FROM ops_pipeline_config WHERE key = 'wip_bonus_slots';
    SELECT COALESCE(value::int, 50) INTO v_bonus_threshold FROM ops_pipeline_config WHERE key = 'wip_bonus_progress_threshold';

    base_cap := v_base_cap;
    bonus_slots := v_bonus_slots;
    bonus_threshold := v_bonus_threshold;

    SELECT count(*) INTO total_building FROM course_packages WHERE status = 'building';
    SELECT count(*) INTO bonus_eligible FROM course_packages WHERE status = 'building' AND build_progress >= v_bonus_threshold;
    
    base_building := total_building - bonus_eligible;
    effective_cap := v_base_cap + LEAST(bonus_eligible, v_bonus_slots);

    RETURN NEXT;
END;
$$;
