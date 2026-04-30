CREATE OR REPLACE FUNCTION public.admin_bulk_promote_content_deficient_packages(
  p_max_packages integer DEFAULT 20,
  p_wip_cap integer DEFAULT 60,
  p_min_approved integer DEFAULT 50,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eligible_ids uuid[];
  v_promoted integer := 0;
  v_skipped integer := 0;
  v_wip_current integer;
  v_pkg_id uuid;
BEGIN
  SELECT COUNT(*) INTO v_wip_current
  FROM course_packages
  WHERE status = 'building' AND archived = false;

  IF v_wip_current >= p_wip_cap THEN
    INSERT INTO auto_heal_log (action_type, target_kind, payload)
    VALUES (
      'staggered_bulk_promote_skipped','system',
      jsonb_build_object('reason','wip_cap_reached','wip_current',v_wip_current,'wip_cap',p_wip_cap)
    );
    RETURN jsonb_build_object('promoted',0,'skipped',0,'reason','wip_cap_reached','wip_current',v_wip_current);
  END IF;

  SELECT array_agg(id ORDER BY created_at ASC) INTO v_eligible_ids
  FROM (
    SELECT cp.id, cp.created_at
    FROM course_packages cp
    WHERE cp.status = 'queued'
      AND cp.archived = false
      AND cp.is_published = false
      AND (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') < p_min_approved
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = cp.id
          AND jq.status IN ('pending','processing','queued')
      )
    ORDER BY cp.created_at ASC
    LIMIT LEAST(p_max_packages, GREATEST(0, p_wip_cap - v_wip_current))
  ) t;

  IF v_eligible_ids IS NULL OR array_length(v_eligible_ids,1) IS NULL THEN
    INSERT INTO auto_heal_log (action_type, target_kind, payload)
    VALUES ('staggered_bulk_promote_run','system',
      jsonb_build_object('promoted',0,'skipped',0,'reason','no_eligible_packages','dry_run',p_dry_run));
    RETURN jsonb_build_object('promoted',0,'skipped',0,'reason','no_eligible_packages');
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('promoted',0,'skipped',0,'dry_run',true,'candidates',v_eligible_ids);
  END IF;

  FOREACH v_pkg_id IN ARRAY v_eligible_ids LOOP
    BEGIN
      PERFORM public.admin_nudge_atomic_trigger(v_pkg_id, false);
      v_promoted := v_promoted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_kind, payload)
  VALUES (
    'staggered_bulk_promote_run','system',
    jsonb_build_object(
      'promoted',v_promoted,'skipped',v_skipped,
      'wip_before',v_wip_current,'wip_cap',p_wip_cap,
      'min_approved',p_min_approved,'package_ids',v_eligible_ids
    )
  );

  RETURN jsonb_build_object(
    'promoted',v_promoted,'skipped',v_skipped,
    'wip_before',v_wip_current,'package_ids',v_eligible_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bulk_promote_content_deficient_packages(integer,integer,integer,boolean) TO authenticated, service_role;