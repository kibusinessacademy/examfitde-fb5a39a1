
CREATE OR REPLACE FUNCTION fn_rebalance_wip_priority(
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
    v_demotion_count INT := 0;
    v_rec RECORD;
BEGIN
    -- Get WIP cap
    SELECT COALESCE(value::int, 14) INTO v_wip_cap
    FROM ops_pipeline_config WHERE key = 'wip_total_cap';

    -- Current building count
    SELECT count(*) INTO v_current_building
    FROM course_packages WHERE status = 'building';

    -- Best (lowest) priority waiting in queue
    SELECT min(priority) INTO v_best_queued_priority
    FROM course_packages WHERE status = 'queued' AND priority IS NOT NULL;

    -- Nothing to do if no queued packages or queue has worse priority than all building
    IF v_best_queued_priority IS NULL THEN
        RETURN;
    END IF;

    -- Find building packages with WORSE priority than the best queued
    -- Only demote if WIP is at or above threshold (cap - 1) to leave room
    IF v_current_building < v_wip_cap - 1 THEN
        -- Enough room, no need to demote
        RETURN;
    END IF;

    FOR v_rec IN
        SELECT cp.id, c.title, cp.priority, cp.build_progress
        FROM course_packages cp
        JOIN courses c ON c.id = cp.course_id
        WHERE cp.status = 'building'
          AND cp.priority > v_best_queued_priority
        ORDER BY 
            cp.priority DESC,          -- worst priority first
            cp.build_progress ASC,     -- least progress first
            cp.updated_at ASC          -- least recent activity first
        LIMIT p_max_demotions
    LOOP
        -- Cancel pending/processing jobs
        UPDATE job_queue 
        SET status = 'cancelled', updated_at = now()
        WHERE package_id = v_rec.id
          AND status IN ('pending', 'processing');

        -- Demote to queued
        UPDATE course_packages 
        SET status = 'queued', updated_at = now()
        WHERE id = v_rec.id;

        -- Audit log
        INSERT INTO admin_actions (action, scope, affected_ids, payload)
        VALUES (
            'wip_priority_rebalance',
            'pipeline',
            ARRAY[v_rec.id::text],
            jsonb_build_object(
                'demoted_package', v_rec.id,
                'demoted_title', v_rec.title,
                'demoted_priority', v_rec.priority,
                'demoted_progress', v_rec.build_progress,
                'best_queued_priority', v_best_queued_priority,
                'wip_before', v_current_building,
                'wip_cap', v_wip_cap
            )
        );

        v_demotion_count := v_demotion_count + 1;
        v_current_building := v_current_building - 1;

        demoted_package_id := v_rec.id;
        demoted_title := v_rec.title;
        demoted_priority := v_rec.priority;
        freed_for_priority := v_best_queued_priority;
        RETURN NEXT;

        -- Stop if we've freed enough slots
        IF v_current_building < v_wip_cap - 1 THEN
            EXIT;
        END IF;
    END LOOP;

    RETURN;
END;
$$;

COMMENT ON FUNCTION fn_rebalance_wip_priority IS 
'Priority Rebalancer: Automatically demotes building packages with worse priority when better-priority packages are queued and WIP is near capacity. Called by watchdog/cron.';
