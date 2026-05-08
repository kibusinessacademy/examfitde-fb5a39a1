DROP FUNCTION IF EXISTS public.admin_get_release_snapshot_drift(boolean,integer);
DROP VIEW IF EXISTS public.v_release_snapshot_drift CASCADE;

CREATE VIEW public.v_release_snapshot_drift AS
WITH latest AS (
  SELECT DISTINCT ON (package_id) *
  FROM public.package_release_audit_snapshots
  ORDER BY package_id, snapshot_date DESC
),
base AS (
  SELECT
    vc.package_id,
    vc.course_title,
    vc.track::text AS track,
    vc.package_status,
    s.snapshot_date,
    s.deficiency_codes AS snapshot_codes,
    vc.deficiency_codes AS live_codes,
    ARRAY(SELECT unnest(s.deficiency_codes) EXCEPT SELECT unnest(vc.deficiency_codes)) AS stale_codes,
    ARRAY(SELECT unnest(vc.deficiency_codes) EXCEPT SELECT unnest(s.deficiency_codes)) AS new_codes,
    s.handbook_chapters AS snap_handbook,
    vc.handbook_chapters AS live_handbook,
    s.tutor_indices AS snap_tutor,
    vc.tutor_indices AS live_tutor,
    s.oral_blueprints AS snap_oral,
    vc.oral_blueprints AS live_oral,
    (s.deficiency_codes IS DISTINCT FROM vc.deficiency_codes) AS has_drift
  FROM public.v_package_release_classification vc
  LEFT JOIN latest s ON s.package_id = vc.package_id
)
SELECT
  b.*,
  CASE
    WHEN b.new_codes && ARRAY['NO_HANDBOOK','NO_TUTOR','NO_ORAL','LF_COVERAGE_GAP'] THEN 'critical'
    WHEN b.stale_codes && ARRAY['NO_HANDBOOK','NO_TUTOR','NO_ORAL','LF_COVERAGE_GAP'] THEN 'high'
    WHEN b.has_drift THEN 'low'
    ELSE 'none'
  END AS drift_priority,
  CASE
    WHEN NOT b.has_drift THEN 'none'
    WHEN COALESCE(array_length(b.new_codes,1),0) > 0 AND COALESCE(array_length(b.stale_codes,1),0) > 0 THEN 'mixed'
    WHEN COALESCE(array_length(b.new_codes,1),0) > 0 THEN 'regression'
    WHEN COALESCE(array_length(b.stale_codes,1),0) > 0 THEN 'stale_only'
    ELSE 'low'
  END AS drift_kind
FROM base b;

REVOKE ALL ON public.v_release_snapshot_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_release_snapshot_drift TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_release_snapshot_drift(p_only_drift boolean DEFAULT true, p_limit integer DEFAULT 200)
RETURNS TABLE(
  package_id uuid, course_title text, track text, package_status text,
  snapshot_date date, snapshot_codes text[], live_codes text[],
  stale_codes text[], new_codes text[],
  snap_handbook integer, live_handbook integer,
  snap_tutor integer, live_tutor integer,
  snap_oral integer, live_oral integer,
  has_drift boolean, drift_priority text, drift_kind text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT package_id, course_title, track, package_status, snapshot_date,
         snapshot_codes, live_codes, stale_codes, new_codes,
         snap_handbook, live_handbook, snap_tutor, live_tutor, snap_oral, live_oral,
         has_drift, drift_priority, drift_kind
    FROM public.v_release_snapshot_drift
   WHERE ((NOT p_only_drift) OR has_drift)
     AND (public.has_role(auth.uid(),'admin') OR auth.role() = 'service_role')
   ORDER BY CASE drift_priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
            course_title
   LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.admin_get_release_snapshot_drift(boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_release_snapshot_drift(boolean,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_release_snapshot_drift_summary()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.v_release_snapshot_drift),
    'with_drift', (SELECT count(*) FROM public.v_release_snapshot_drift WHERE has_drift),
    'by_priority', (SELECT jsonb_object_agg(drift_priority, c) FROM (
      SELECT drift_priority, count(*) AS c FROM public.v_release_snapshot_drift WHERE has_drift GROUP BY 1
    ) x),
    'by_kind', (SELECT jsonb_object_agg(drift_kind, c) FROM (
      SELECT drift_kind, count(*) AS c FROM public.v_release_snapshot_drift WHERE has_drift GROUP BY 1
    ) x),
    'stale_no_handbook', (SELECT count(*) FROM public.v_release_snapshot_drift WHERE 'NO_HANDBOOK' = ANY(stale_codes)),
    'stale_no_tutor',    (SELECT count(*) FROM public.v_release_snapshot_drift WHERE 'NO_TUTOR' = ANY(stale_codes)),
    'stale_no_oral',     (SELECT count(*) FROM public.v_release_snapshot_drift WHERE 'NO_ORAL' = ANY(stale_codes)),
    'latest_snapshot', (SELECT max(snapshot_date) FROM public.package_release_audit_snapshots),
    'generated_at', now()
  );
$$;
REVOKE ALL ON FUNCTION public.admin_get_release_snapshot_drift_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_release_snapshot_drift_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_revalidate_package_drift(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := current_date;
  v_row jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'admin_revalidate_package_drift: forbidden';
  END IF;

  INSERT INTO public.package_release_audit_snapshots (
    snapshot_date, package_id, course_title, track, package_status,
    release_class, deficiency_codes,
    approved_questions, exam_relevant_questions,
    total_learning_fields, covered_learning_fields,
    tutor_indices, oral_blueprints, handbook_chapters, minicheck_questions,
    metrics
  )
  SELECT
    v_today, package_id, course_title, track::text, package_status,
    release_class, COALESCE(deficiency_codes,'{}'::text[]),
    approved_questions, exam_relevant_questions,
    total_learning_fields, covered_learning_fields,
    tutor_indices, oral_blueprints, handbook_chapters, minicheck_questions,
    jsonb_build_object('snapshot_at', now(),'source','admin_revalidate_package_drift')
  FROM public.v_package_release_classification
  WHERE package_id = p_package_id
  ON CONFLICT (snapshot_date, package_id) DO UPDATE
    SET release_class=EXCLUDED.release_class,
        deficiency_codes=EXCLUDED.deficiency_codes,
        approved_questions=EXCLUDED.approved_questions,
        exam_relevant_questions=EXCLUDED.exam_relevant_questions,
        total_learning_fields=EXCLUDED.total_learning_fields,
        covered_learning_fields=EXCLUDED.covered_learning_fields,
        tutor_indices=EXCLUDED.tutor_indices,
        oral_blueprints=EXCLUDED.oral_blueprints,
        handbook_chapters=EXCLUDED.handbook_chapters,
        minicheck_questions=EXCLUDED.minicheck_questions,
        package_status=EXCLUDED.package_status,
        metrics=EXCLUDED.metrics;

  SELECT to_jsonb(d.*) INTO v_row
    FROM public.v_release_snapshot_drift d
   WHERE d.package_id = p_package_id;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('drift_revalidation','admin_revalidate_package_drift','package',p_package_id::text,'ok',
          'Re-snapshot of package release classification', v_row);

  RETURN jsonb_build_object('ok',true,'package_id',p_package_id,'drift', v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revalidate_package_drift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revalidate_package_drift(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_auto_reconcile_drift(p_dry_run boolean DEFAULT false, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_results jsonb := '[]'::jsonb;
  v_repair_count int := 0;
  v_resnapshot_count int := 0;
  v_skipped int := 0;
  v_workflow jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'admin_auto_reconcile_drift: forbidden';
  END IF;

  FOR r IN
    SELECT package_id, drift_kind, drift_priority, stale_codes, new_codes
      FROM public.v_release_snapshot_drift
     WHERE has_drift = true
     ORDER BY CASE drift_priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 2 ELSE 3 END
     LIMIT p_limit
  LOOP
    IF r.drift_kind IN ('regression','mixed') AND r.drift_priority = 'critical' THEN
      IF NOT p_dry_run THEN
        SELECT public.admin_content_repair_workflow(r.package_id, false) INTO v_workflow;
        PERFORM public.admin_revalidate_package_drift(r.package_id);
      ELSE
        v_workflow := jsonb_build_object('dry_run', true);
      END IF;
      v_repair_count := v_repair_count + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id, 'action','content_repair',
        'drift_kind', r.drift_kind, 'priority', r.drift_priority,
        'new_codes', r.new_codes, 'stale_codes', r.stale_codes,
        'workflow', v_workflow);
    ELSIF r.drift_kind = 'stale_only' OR r.drift_priority IN ('high','low') THEN
      IF NOT p_dry_run THEN
        PERFORM public.admin_revalidate_package_drift(r.package_id);
      END IF;
      v_resnapshot_count := v_resnapshot_count + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id, 'action','resnapshot_only',
        'drift_kind', r.drift_kind, 'priority', r.drift_priority,
        'stale_codes', r.stale_codes, 'new_codes', r.new_codes);
    ELSE
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id, 'action','skipped',
        'drift_kind', r.drift_kind, 'priority', r.drift_priority);
    END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('drift_auto_reconcile_run','admin_auto_reconcile_drift','system',NULL,
          CASE WHEN (v_repair_count + v_resnapshot_count) = 0 THEN 'noop' ELSE 'ok' END,
          'Repairs='||v_repair_count||' Resnapshots='||v_resnapshot_count||' Skipped='||v_skipped,
          jsonb_build_object('dry_run',p_dry_run,'limit',p_limit,'repairs',v_repair_count,
            'resnapshots',v_resnapshot_count,'skipped',v_skipped,'results',v_results));

  RETURN jsonb_build_object('ok',true,'dry_run',p_dry_run,
    'repairs',v_repair_count,'resnapshots',v_resnapshot_count,'skipped',v_skipped,
    'results',v_results);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_auto_reconcile_drift(boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_auto_reconcile_drift(boolean,integer) TO authenticated, service_role;