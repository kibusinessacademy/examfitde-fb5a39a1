
-- 1) RPC to record orphan-function audit row (called by scripts/edge-fn-audit.mjs)
CREATE OR REPLACE FUNCTION public.admin_record_orphan_function(
  p_function_name text,
  p_ref_count integer,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.audit_orphan_functions_snapshot(function_name, ref_count, notes)
  VALUES (p_function_name, p_ref_count, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;

REVOKE ALL ON FUNCTION public.admin_record_orphan_function(text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_orphan_function(text,integer,text) TO authenticated, service_role;

-- 2) Aggregate RPC for the AuditReportsPage
CREATE OR REPLACE FUNCTION public.admin_get_audit_reports_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  WITH
    coupling AS (
      SELECT jsonb_agg(jsonb_build_object(
        'proname', func,
        'args', '',
        'schema_name','public',
        'issue', concat_ws(',',
          CASE WHEN bad_payload THEN 'payload' END,
          CASE WHEN bad_triggered_by THEN 'triggered_by' END,
          CASE WHEN bad_action_col THEN 'action' END,
          CASE WHEN bad_package_id_col THEN 'package_id' END,
          CASE WHEN bad_details_col THEN 'details' END
        )
      )) AS j FROM public.v_auto_heal_log_legacy_producers
    ),
    orphans AS (
      SELECT count(*)::int AS c,
             coalesce(jsonb_agg(jsonb_build_object(
               'job_id', job_id, 'job_type', job_type, 'status', status,
               'package_id', package_id, 'created_at', created_at, 'last_error', last_error
             ) ORDER BY created_at DESC) FILTER (WHERE rn <= 50), '[]'::jsonb) AS sample
      FROM (
        SELECT *, row_number() OVER (ORDER BY created_at DESC) AS rn
        FROM public.v_audit_orphan_jobs
      ) s
    ),
    snap_fn AS (
      SELECT max(snapshot_at) AS ts FROM public.audit_orphan_functions_snapshot
    ),
    fns AS (
      SELECT jsonb_agg(jsonb_build_object(
        'function_name', function_name, 'ref_count', ref_count,
        'notes', notes, 'snapshot_at', snapshot_at
      ) ORDER BY ref_count ASC, function_name ASC) AS j
      FROM public.audit_orphan_functions_snapshot
      WHERE snapshot_at = (SELECT ts FROM snap_fn)
    ),
    snap_dc AS (
      SELECT max(snapshot_at) AS ts FROM public.audit_dead_columns_snapshot
    ),
    dc AS (
      SELECT jsonb_agg(jsonb_build_object(
        'table_name', table_name, 'column_name', column_name,
        'ref_count_db', ref_count_db, 'ref_count_edge', ref_count_edge,
        'ref_count_ui', ref_count_ui, 'safe_to_drop', safe_to_drop,
        'notes', notes, 'snapshot_at', snapshot_at
      ) ORDER BY safe_to_drop DESC, table_name, column_name) AS j
      FROM public.audit_dead_columns_snapshot
      WHERE snapshot_at = (SELECT ts FROM snap_dc)
    )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'coupling_legacy_producers', coalesce((SELECT j FROM coupling), '[]'::jsonb),
    'orphan_jobs', jsonb_build_object('count', coalesce((SELECT c FROM orphans),0),
                                      'sample', coalesce((SELECT sample FROM orphans),'[]'::jsonb)),
    'orphan_functions_latest', coalesce((SELECT j FROM fns), '[]'::jsonb),
    'dead_columns_latest', coalesce((SELECT j FROM dc), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END$$;

REVOKE ALL ON FUNCTION public.admin_get_audit_reports_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_audit_reports_summary() TO authenticated, service_role;
