-- Fix WIP-Cap drift: read from SSOT (ops_pipeline_config.wip_total_cap)
CREATE OR REPLACE FUNCTION public.auto_resume_blocked_with_progress(p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
  v_resumed int := 0;
  v_results jsonb := '[]'::jsonb;
  v_active_builds int;
  v_wip_cap int;
BEGIN
  -- SSOT: read from ops_pipeline_config (default 14 if missing)
  SELECT COALESCE(value::int, 14) INTO v_wip_cap
  FROM ops_pipeline_config WHERE key = 'wip_total_cap';
  IF v_wip_cap IS NULL THEN v_wip_cap := 14; END IF;

  SELECT count(*) INTO v_active_builds FROM course_packages WHERE status='building';
  IF v_active_builds >= v_wip_cap THEN
    RETURN jsonb_build_object('resumed', 0, 'reason', 'wip_full',
      'active_builds', v_active_builds, 'wip_cap', v_wip_cap);
  END IF;

  FOR v_rec IN
    SELECT vrc.package_id, vrc.release_class, vrc.approved_questions
    FROM v_package_release_classification vrc
    JOIN course_packages cp ON cp.id = vrc.package_id
    LEFT JOIN v_package_build_priority vbp ON vbp.package_id = vrc.package_id
    WHERE vrc.package_status = 'blocked'
      AND vrc.release_class IN ('release_ok','release_warn')
      AND coalesce(cp.blocked_reason,'') NOT IN ('content_gap','admin_hold','manual_review_required','compliance_hold')
    ORDER BY vbp.effective_priority DESC NULLS LAST, vrc.approved_questions DESC
    LIMIT LEAST(p_limit, v_wip_cap - v_active_builds)
  LOOP
    UPDATE course_packages
      SET status = CASE WHEN v_rec.release_class='release_ok' THEN 'published' ELSE 'building' END,
          published_at = CASE WHEN v_rec.release_class='release_ok' THEN now() ELSE published_at END,
          blocked_reason = NULL,
          updated_at = now()
      WHERE id = v_rec.package_id;
    v_resumed := v_resumed + 1;
    v_results := v_results || jsonb_build_object(
      'package_id', v_rec.package_id, 'release_class', v_rec.release_class,
      'new_status', CASE WHEN v_rec.release_class='release_ok' THEN 'published' ELSE 'building' END
    );
  END LOOP;

  IF v_resumed > 0 THEN
    INSERT INTO admin_actions(action, scope, payload)
    VALUES('auto_resume_blocked_with_progress', 'course_packages',
      jsonb_build_object('resumed', v_resumed, 'results', v_results, 'wip_cap', v_wip_cap));
  END IF;

  RETURN jsonb_build_object('resumed', v_resumed, 'wip', v_active_builds, 'wip_cap', v_wip_cap, 'details', v_results);
END
$function$;