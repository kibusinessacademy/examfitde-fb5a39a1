-- ============================================================
-- 1) HARDEN trg_block_publish_without_product: INSERT *and* UPDATE,
--    safe UUID cast, no crash on bad payload
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_block_publish_without_product()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_pkg_id uuid;
  v_product_id uuid;
  v_payload_pid text;
BEGIN
  IF NEW.job_type IN ('package_auto_publish','package_publish') THEN
    v_payload_pid := NEW.payload->>'package_id';
    IF NEW.package_id IS NOT NULL THEN
      v_pkg_id := NEW.package_id;
    ELSIF v_payload_pid IS NOT NULL
      AND v_payload_pid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      v_pkg_id := v_payload_pid::uuid;
    END IF;

    IF v_pkg_id IS NOT NULL THEN
      SELECT product_id INTO v_product_id FROM public.course_packages WHERE id=v_pkg_id;
      IF v_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id=v_product_id) THEN
        RAISE EXCEPTION 'BLOCKED_PUBLISH_NO_PRODUCT: package % has no valid product_id (job_type=%)',
          v_pkg_id, NEW.job_type USING ERRCODE='check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_block_publish_without_product ON public.job_queue;
CREATE TRIGGER trg_block_publish_without_product
  BEFORE INSERT OR UPDATE OF status, job_type, payload, package_id ON public.job_queue
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_publish_without_product();

-- ============================================================
-- 2) Lane classification test RPC (admin-only, deterministic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_test_lane_classification(p_cases jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_case record;
  v_db_lane text;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role',true),'') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;
  FOR v_case IN SELECT key AS job_type, value::text AS expected FROM jsonb_each_text(p_cases) LOOP
    v_db_lane := public.derive_job_lane(v_case.job_type);
    v_results := v_results || jsonb_build_object(
      'job_type', v_case.job_type,
      'expected', trim(both '"' from v_case.expected),
      'actual', v_db_lane,
      'ok', (v_db_lane = trim(both '"' from v_case.expected))
    );
  END LOOP;
  RETURN jsonb_build_object('cases', v_results);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_test_lane_classification(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_test_lane_classification(jsonb) TO service_role;

-- ============================================================
-- 3) RPC contract introspection (lists pg_proc + grants + secdef)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_rpc_contracts(p_name_pattern text DEFAULT '%')
RETURNS TABLE (
  proname text, args text, return_type text, security_definer boolean,
  granted_to_anon boolean, granted_to_authenticated boolean, granted_to_service_role boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT
    p.proname::text,
    pg_get_function_arguments(p.oid),
    pg_get_function_result(p.oid),
    p.prosecdef,
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    has_function_privilege('service_role', p.oid, 'EXECUTE')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE p_name_pattern;
$fn$;
REVOKE ALL ON FUNCTION public.admin_list_rpc_contracts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_rpc_contracts(text) TO service_role;

-- ============================================================
-- 4) RPC leak detection (admin_*, claim_*, ops_*, _internal_* exposed to anon/authenticated)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_rpc_leaks()
RETURNS TABLE (proname text, grantee text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT p.proname::text, g.grantee::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace,
       LATERAL (VALUES ('anon'::text), ('authenticated')) AS g(grantee)
  WHERE n.nspname='public'
    AND (p.proname LIKE 'admin\_%' ESCAPE '\'
      OR p.proname LIKE 'claim\_%' ESCAPE '\'
      OR p.proname LIKE 'ops\_%' ESCAPE '\'
      OR p.proname LIKE '\_internal\_%' ESCAPE '\')
    AND has_function_privilege(g.grantee, p.oid, 'EXECUTE');
$fn$;
REVOKE ALL ON FUNCTION public.admin_list_rpc_leaks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_rpc_leaks() TO service_role;

-- ============================================================
-- 5) Live-Drift summary RPC (5 KPIs for Admin UI)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_drift_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_summary jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role',true),'') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  SELECT jsonb_build_object(
    'queue_claimability', (
      SELECT jsonb_object_agg(claimability_status, c) FROM (
        SELECT claimability_status, COUNT(*) AS c FROM public.v_ops_queue_claimability GROUP BY 1
      ) q
    ),
    'pricing_blocked_publish', (
      SELECT COUNT(*) FROM public.course_packages
      WHERE status IN ('queued','building','blocked')
        AND (product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=course_packages.product_id))
    ),
    'governance_ghost_steps', (
      SELECT COUNT(*) FROM public.package_steps
      WHERE step_key='quality_council' AND status='done'
        AND (meta->'verdict'->>'status') IS NULL
    ),
    'step_job_gap', (
      SELECT COUNT(*) FROM public.ops_queued_step_without_job
    ),
    'schema_drift_recent', (
      SELECT COUNT(*) FROM public.v_ops_queue_claimability WHERE claimability_status='schema_drift_blocked'
    ),
    'generated_at', now()
  ) INTO v_summary;

  RETURN v_summary;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_get_drift_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_drift_overview() TO service_role;

-- ============================================================
-- 6) Per-package drift detail RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_drift_detail(p_kind text)
RETURNS TABLE (package_id uuid, title text, detail jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role',true),'') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  IF p_kind = 'pricing_blocked' THEN
    RETURN QUERY
      SELECT cp.id, cp.title,
        jsonb_build_object('product_id', cp.product_id, 'status', cp.status) AS detail
      FROM public.course_packages cp
      WHERE cp.status IN ('queued','building','blocked')
        AND (cp.product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=cp.product_id))
      ORDER BY cp.title;
  ELSIF p_kind = 'dag_blocked' THEN
    RETURN QUERY
      SELECT v.resolved_package_id, cp.title,
        jsonb_agg(jsonb_build_object('step_key', v.step_key, 'job_type', v.job_type, 'last_error', v.last_error)) AS detail
      FROM public.v_ops_queue_claimability v
      LEFT JOIN public.course_packages cp ON cp.id = v.resolved_package_id
      WHERE v.claimability_status='dag_blocked'
      GROUP BY v.resolved_package_id, cp.title
      ORDER BY cp.title;
  ELSIF p_kind = 'governance_ghost' THEN
    RETURN QUERY
      SELECT ps.package_id, cp.title,
        jsonb_build_object('step_key', ps.step_key, 'meta', ps.meta) AS detail
      FROM public.package_steps ps
      LEFT JOIN public.course_packages cp ON cp.id=ps.package_id
      WHERE ps.step_key='quality_council' AND ps.status='done'
        AND (ps.meta->'verdict'->>'status') IS NULL
      ORDER BY cp.title;
  ELSIF p_kind = 'step_job_gap' THEN
    RETURN QUERY
      SELECT o.package_id, cp.title,
        jsonb_build_object('step_key', o.step_key) AS detail
      FROM public.ops_queued_step_without_job o
      LEFT JOIN public.course_packages cp ON cp.id=o.package_id
      ORDER BY cp.title;
  ELSE
    RETURN;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_get_drift_detail(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_drift_detail(text) TO service_role;

-- ============================================================
-- 7) Widen seed-pkg backlog (building/blocked too)
-- ============================================================
INSERT INTO public.heal_permanent_fix_tasks (pattern_key, cluster, package_id, priority, title, description, status, notes, created_by)
SELECT 'PRICING_NO_PRODUCT_LINK','pricing_governance', cp.id,'high',
  'Seed-Paket ohne Produkt: '|| cp.title,
  'Paket '||cp.title||' ('||cp.id||') hat keinen product_id-Link.','open',
  'In products Zeile anlegen (slug=package_key), course_packages.product_id setzen, dann fn_backfill_default_pricing_for_building.',
  '00000000-0000-0000-0000-000000000000'::uuid
FROM public.course_packages cp
WHERE cp.product_id IS NULL AND cp.status IN ('queued','building','blocked')
  AND NOT EXISTS (
    SELECT 1 FROM public.heal_permanent_fix_tasks t
    WHERE t.pattern_key='PRICING_NO_PRODUCT_LINK' AND t.package_id=cp.id AND t.status IN ('open','in_progress')
  );