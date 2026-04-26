-- 1) Graph-Konsistenz-View
CREATE OR REPLACE VIEW public.v_artifact_graph_consistency AS
SELECT
  o.table_name,
  o.artifact_id,
  o.curriculum_id,
  o.package_id,
  o.reason,
  o.severity,
  EXISTS (SELECT 1 FROM public.curricula c WHERE c.id = o.curriculum_id) AS curriculum_exists,
  EXISTS (SELECT 1 FROM public.course_packages p WHERE p.id = o.package_id) AS package_exists,
  (SELECT p.status FROM public.course_packages p WHERE p.id = o.package_id) AS package_status,
  -- backfillable wenn package_id fehlt aber Curriculum + ein course_package existiert
  CASE
    WHEN o.package_id IS NULL
     AND o.curriculum_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.curricula c WHERE c.id = o.curriculum_id)
     AND EXISTS (SELECT 1 FROM public.course_packages p WHERE p.curriculum_id = o.curriculum_id)
    THEN true ELSE false END AS backfill_possible,
  (SELECT p.id FROM public.course_packages p
    WHERE p.curriculum_id = o.curriculum_id
    ORDER BY p.created_at LIMIT 1) AS suggested_package_id
FROM public.v_artifact_orphans o;

-- 2) Cockpit-RPCs (admin-gated)
CREATE OR REPLACE FUNCTION public.admin_artifact_orphans_summary()
RETURNS TABLE(
  cluster_key TEXT, table_name TEXT, reason TEXT, severity TEXT,
  orphan_count BIGINT, distinct_curricula BIGINT, distinct_packages BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT s.cluster_key, s.table_name, s.reason, s.severity,
                      s.orphan_count::bigint, s.distinct_curricula::bigint, s.distinct_packages::bigint
               FROM public.v_artifact_orphans_summary s;
END $$;

CREATE OR REPLACE FUNCTION public.admin_artifact_orphans_detail(
  p_table TEXT DEFAULT NULL,
  p_severity TEXT DEFAULT NULL,
  p_limit INT DEFAULT 200
)
RETURNS TABLE(
  table_name TEXT, artifact_id UUID, curriculum_id UUID, package_id UUID,
  reason TEXT, severity TEXT, curriculum_exists BOOLEAN, package_exists BOOLEAN,
  package_status TEXT, backfill_possible BOOLEAN, suggested_package_id UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT g.table_name, g.artifact_id, g.curriculum_id, g.package_id,
         g.reason, g.severity, g.curriculum_exists, g.package_exists,
         g.package_status, g.backfill_possible, g.suggested_package_id
  FROM public.v_artifact_graph_consistency g
  WHERE (p_table IS NULL OR g.table_name = p_table)
    AND (p_severity IS NULL OR g.severity = p_severity)
  LIMIT GREATEST(1, LEAST(2000, p_limit));
END $$;

CREATE OR REPLACE FUNCTION public.admin_backfill_chunk_audit(p_limit INT DEFAULT 100)
RETURNS TABLE(
  id UUID, table_name TEXT, curriculum_id UUID, package_id UUID,
  chunk_size INT, rows_updated INT, duration_ms INT,
  triggers_disabled TEXT[], triggers_restored BOOLEAN,
  error_message TEXT, meta JSONB, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT a.id, a.table_name, a.curriculum_id, a.package_id,
         a.chunk_size, a.rows_updated, a.duration_ms,
         a.triggers_disabled, a.triggers_restored, a.error_message, a.meta, a.created_at
  FROM public.backfill_chunk_audit a
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(1000, p_limit));
END $$;

-- Grants: nur authenticated; has_role-Check in Body
REVOKE ALL ON FUNCTION public.admin_artifact_orphans_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_artifact_orphans_detail(TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_backfill_chunk_audit(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cleanup_artifact_orphans(TEXT, INT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_artifact_orphans_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_artifact_orphans_detail(TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backfill_chunk_audit(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_artifact_orphans(TEXT, INT, BOOLEAN) TO service_role;

-- admin_cleanup auch admin-gated für UI-Aufruf
CREATE OR REPLACE FUNCTION public.admin_cleanup_artifact_orphans(
  p_table TEXT DEFAULT NULL, p_max INT DEFAULT 500, p_dry_run BOOLEAN DEFAULT false
) RETURNS TABLE(table_name TEXT, deleted_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_tables TEXT[] := ARRAY['minicheck_questions','exam_questions','exam_blueprints',
                           'oral_exam_blueprints','blueprint_targets','question_blueprints'];
  v_t TEXT; v_n INT; v_sql TEXT;
BEGIN
  -- Allow service_role OR admin user
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOREACH v_t IN ARRAY v_tables LOOP
    IF p_table IS NOT NULL AND p_table <> v_t THEN CONTINUE; END IF;
    IF p_dry_run THEN
      EXECUTE format('SELECT COUNT(*)::int FROM (SELECT 1 FROM public.v_artifact_orphans WHERE table_name = %L AND severity = %L LIMIT %s) x',
                     v_t, 'hard_orphan', p_max) INTO v_n;
    ELSE
      v_sql := format($f$
        WITH cand AS (
          SELECT artifact_id, curriculum_id, package_id, reason
          FROM public.v_artifact_orphans
          WHERE table_name = %L AND severity = 'hard_orphan' LIMIT %s
        ), logged AS (
          INSERT INTO public.artifact_orphan_cleanup_log
            (table_name, artifact_id, curriculum_id, package_id, reason, deleted_by)
          SELECT %L, artifact_id, curriculum_id, package_id, reason,
                 COALESCE(auth.uid()::text, 'cleanup_sweep')
          FROM cand RETURNING artifact_id
        ), del AS (
          DELETE FROM public.%I WHERE id IN (SELECT artifact_id FROM logged) RETURNING 1
        ) SELECT COUNT(*)::int FROM del
      $f$, v_t, p_max, v_t, v_t);
      EXECUTE v_sql INTO v_n;
    END IF;
    table_name := v_t;
    deleted_count := COALESCE(v_n, 0);
    RETURN NEXT;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_artifact_orphans(TEXT, INT, BOOLEAN) TO authenticated, service_role;