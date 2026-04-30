
CREATE OR REPLACE FUNCTION public.auto_promote_status_drift(p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
  v_promoted int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_release_class text;
BEGIN
  FOR v_rec IN
    SELECT cp.id AS package_id,
           cp.status AS current_status,
           ps_total.total_steps,
           ps_done.done_steps
    FROM course_packages cp
    JOIN LATERAL (
      SELECT count(*) AS total_steps FROM package_steps WHERE package_id = cp.id
    ) ps_total ON TRUE
    JOIN LATERAL (
      SELECT count(*) AS done_steps FROM package_steps
      WHERE package_id = cp.id AND status IN ('done','skipped')
    ) ps_done ON TRUE
    WHERE cp.status = 'building'
      AND ps_total.total_steps > 0
      AND ps_total.total_steps = ps_done.done_steps
    ORDER BY cp.updated_at ASC
    LIMIT p_limit
  LOOP
    SELECT release_class INTO v_release_class
      FROM v_package_release_classification
      WHERE package_id = v_rec.package_id;

    IF v_release_class = 'release_ok' THEN
      UPDATE course_packages
        SET status='published', published_at = COALESCE(published_at, now()),
            updated_at = now()
        WHERE id = v_rec.package_id;
      v_promoted := v_promoted + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_rec.package_id, 'action', 'promoted_to_published',
        'release_class', v_release_class
      );
    ELSE
      -- Korrekte Klassifikation:
      -- release_block  → content_gap (echte Inhalts-Lücke, nicht Pipeline-Bug)
      -- release_warn   → pipeline_repair_required (Pipeline kann es richten)
      -- sonst (NULL etc.) → pipeline_repair_required (Klassifikation noch unbekannt)
      UPDATE course_packages
        SET status='blocked',
            blocked_reason = CASE
              WHEN v_release_class='release_block' THEN 'content_gap'
              WHEN v_release_class='release_warn'  THEN 'pipeline_repair_required'
              ELSE 'pipeline_repair_required'
            END,
            updated_at = now()
        WHERE id = v_rec.package_id;
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_rec.package_id, 'action', 'marked_blocked',
        'release_class', v_release_class,
        'blocked_reason', CASE
          WHEN v_release_class='release_block' THEN 'content_gap'
          ELSE 'pipeline_repair_required'
        END
      );
    END IF;
  END LOOP;

  IF v_promoted > 0 OR v_skipped > 0 THEN
    INSERT INTO admin_actions(action, scope, payload)
    VALUES('auto_promote_status_drift', 'course_packages',
      jsonb_build_object('promoted', v_promoted, 'skipped', v_skipped, 'results', v_results));
  END IF;

  RETURN jsonb_build_object('promoted', v_promoted, 'skipped', v_skipped, 'details', v_results);
END
$function$;
