-- ══════════════════════════════════════════════════════════════════════
-- FIX 1: pick_next_package_to_start — remove queue_position filter, fix sort
-- FIX 2: Add check_wip_allows_build() guard function for systemwide use
-- ══════════════════════════════════════════════════════════════════════

-- FIX 1: Legacy function — remove queue_position IS NOT NULL, fix DESC→ASC
CREATE OR REPLACE FUNCTION public.pick_next_package_to_start(max_active integer DEFAULT 4)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE active_count integer; next_id uuid;
BEGIN
  SELECT count(*) INTO active_count FROM course_packages WHERE status = 'building';
  IF active_count >= max_active THEN RETURN NULL; END IF;
  SELECT id INTO next_id FROM course_packages
  WHERE status IN ('queued','planning')
    AND council_approved = true
  ORDER BY
    CASE WHEN is_rebuild THEN 0 ELSE 1 END,
    COALESCE(priority, 999999) ASC,
    created_at ASC
  LIMIT 1;
  RETURN next_id;
END;
$$;

-- FIX 2: Systemwide WIP guard — returns true if a new build is allowed
CREATE OR REPLACE FUNCTION public.check_wip_allows_build(p_package_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wip_limit int;
  v_building_count int;
  v_rebuild_count int;
  v_effective_wip int;
  v_raw_val text;
  v_is_rebuild boolean;
BEGIN
  -- Read WIP limit from config
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_limit';
    v_wip_limit := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_wip_limit := NULL; END;
  v_wip_limit := COALESCE(v_wip_limit, 1);

  -- Count current building packages
  SELECT count(*) INTO v_building_count FROM public.course_packages WHERE status = 'building';
  SELECT count(*) INTO v_rebuild_count FROM public.course_packages WHERE status = 'building' AND is_rebuild = true;

  -- Rebuilds get separate slots
  v_effective_wip := v_wip_limit + v_rebuild_count;

  -- If package is already building, always allow (re-bootstrap)
  IF p_package_id IS NOT NULL THEN
    PERFORM 1 FROM public.course_packages WHERE id = p_package_id AND status = 'building';
    IF FOUND THEN RETURN true; END IF;
    
    -- Check if this package is a rebuild (gets separate slot)
    SELECT COALESCE(is_rebuild, false) INTO v_is_rebuild FROM public.course_packages WHERE id = p_package_id;
    IF v_is_rebuild THEN RETURN true; END IF;
  END IF;

  RETURN v_building_count < v_effective_wip;
END;
$$;