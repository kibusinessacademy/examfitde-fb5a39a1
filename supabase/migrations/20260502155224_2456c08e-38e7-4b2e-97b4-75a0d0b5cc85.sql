-- =====================================================
-- DATEN-LOCH SSOT v1
-- =====================================================

-- 1) Helper: Ist User ein E2E-Smoke-Test-Account?
CREATE OR REPLACE FUNCTION public.is_e2e_smoke_user(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users 
    WHERE id = p_user_id 
      AND email LIKE '%@examfit-smoke.local'
  );
$$;

-- 2) SSOT-View
CREATE OR REPLACE VIEW public.v_data_holes_ssot AS
WITH
l1 AS (
  SELECT 'L1_jobs_pending_no_job_name'::text AS hole_key, 'HIGH'::text AS severity,
    COUNT(*)::int AS n, 'Identity-Contract-Drift: Producer schreibt job_type ohne job_name'::text AS detail
  FROM public.job_queue WHERE status='pending' AND (job_name IS NULL OR job_name='')
),
l2 AS (
  SELECT 'L2_steps_queued_no_job'::text, 'HIGH'::text,
    COUNT(*)::int, 'Phantom-Steps in queued/planning/building Paketen ohne aktiven Job'::text
  FROM public.package_steps ps JOIN public.course_packages cp ON cp.id=ps.package_id
  WHERE ps.status='queued' AND cp.status IN ('queued','planning','building','blocked')
    AND NOT EXISTS (SELECT 1 FROM public.job_queue jq WHERE jq.package_id=ps.package_id 
      AND jq.job_type='package_'||ps.step_key AND jq.status IN ('pending','processing','queued'))
),
l3 AS (
  SELECT 'L3_orders_paid_no_grant'::text, 'CRITICAL'::text,
    COUNT(*)::int, 'Echte paid Orders (non-test) ohne aktiven learner_course_grant'::text
  FROM public.orders o
  WHERE o.status='paid' AND o.created_at > now()-interval '30 days'
    AND NOT public.is_e2e_smoke_user(COALESCE(o.learner_user_id,o.buyer_user_id))
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
      JOIN public.learner_course_grants lcg ON lcg.user_id=COALESCE(o.learner_user_id,o.buyer_user_id) 
        AND lcg.curriculum_id=p.curriculum_id
      WHERE oi.order_id=o.id AND lcg.status='active'
    )
),
l4 AS (
  SELECT 'L4_jobs_processing_stale_2h'::text, 'MEDIUM'::text,
    COUNT(*)::int, 'Processing-Jobs >2h (Reap-Loop-Guard sollte greifen)'::text
  FROM public.job_queue WHERE status='processing' AND started_at < now()-interval '2 hours'
),
l5 AS (
  SELECT 'L5_active_products_no_curriculum'::text, 'MEDIUM'::text,
    COUNT(*)::int, 'Aktive Products ohne curriculum_id - Käufe können keine Grants auslösen'::text
  FROM public.products WHERE curriculum_id IS NULL AND status='active'
),
l6 AS (
  SELECT 'L6_products_curriculum_orphan_fk'::text, 'MEDIUM'::text,
    COUNT(*)::int, 'Products mit curriculum_id, aber Curriculum existiert nicht (FK-Loch)'::text
  FROM public.products p WHERE p.curriculum_id IS NOT NULL 
    AND NOT EXISTS (SELECT 1 FROM public.curricula c WHERE c.id=p.curriculum_id)
),
l7 AS (
  SELECT 'L7_e2e_test_orders_30d'::text, 'INFO'::text,
    COUNT(*)::int, 'E2E-Smoke-Test Orders der letzten 30 Tage (kein echtes Loch)'::text
  FROM public.orders o WHERE o.status='paid' AND o.created_at > now()-interval '30 days'
    AND public.is_e2e_smoke_user(COALESCE(o.learner_user_id,o.buyer_user_id))
)
SELECT * FROM l1 UNION ALL SELECT * FROM l2 UNION ALL SELECT * FROM l3 
UNION ALL SELECT * FROM l4 UNION ALL SELECT * FROM l5 UNION ALL SELECT * FROM l6 
UNION ALL SELECT * FROM l7;

REVOKE ALL ON public.v_data_holes_ssot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_data_holes_ssot TO service_role;

-- 3) Admin-RPC
CREATE OR REPLACE FUNCTION public.admin_get_data_holes_summary()
RETURNS TABLE(hole_key text, severity text, n int, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT v.hole_key, v.severity, v.n, v.detail
  FROM public.v_data_holes_ssot v
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY CASE v.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'INFO' THEN 4 ELSE 5 END, v.n DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_data_holes_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_data_holes_summary() TO authenticated, service_role;