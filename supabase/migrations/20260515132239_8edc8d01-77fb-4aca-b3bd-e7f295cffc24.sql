
-- ============================================================
-- Fix C: Manual Review Frontier (terminal park for chronic packages)
-- ============================================================

-- 1) SSOT helper
CREATE OR REPLACE FUNCTION public.fn_is_manual_review_frontier(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM course_packages
    WHERE id = p_package_id
      AND COALESCE((feature_flags->'manual_review_frontier'->>'active')::boolean, false) = true
      AND COALESCE((feature_flags->'manual_review_frontier'->>'manual_bypass')::boolean, false) = false
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_manual_review_frontier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_manual_review_frontier(uuid) TO service_role;

-- 2) Candidate view (chronic detection)
CREATE OR REPLACE VIEW public.v_manual_review_frontier_candidates AS
WITH skips AS (
  SELECT (target_id)::uuid AS package_id, COUNT(*)::int AS park_skips_24h
  FROM auto_heal_log
  WHERE action_type='requeue_skipped_park'
    AND created_at > now()-interval '24 hours'
    AND target_id IS NOT NULL
  GROUP BY 1
),
fails AS (
  SELECT package_id, COUNT(*)::int AS tail_fails_24h
  FROM job_queue
  WHERE status='failed'
    AND job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish')
    AND updated_at > now()-interval '24 hours'
  GROUP BY 1
)
SELECT
  cp.id AS package_id,
  cp.status,
  cp.package_key,
  COALESCE(s.park_skips_24h, 0)  AS park_skips_24h,
  COALESCE(f.tail_fails_24h, 0)  AS tail_fails_24h,
  fn_is_bronze_locked(cp.id)     AS bronze_locked,
  CASE
    WHEN COALESCE(f.tail_fails_24h,0) >= 20 THEN 'critical'
    WHEN COALESCE(f.tail_fails_24h,0) >= 5  THEN 'high'
    WHEN COALESCE(s.park_skips_24h,0) >= 5  THEN 'medium'
    ELSE 'low'
  END AS severity
FROM course_packages cp
LEFT JOIN skips s ON s.package_id = cp.id
LEFT JOIN fails f ON f.package_id = cp.id
WHERE (COALESCE(s.park_skips_24h,0) >= 5 OR COALESCE(f.tail_fails_24h,0) >= 5)
  AND COALESCE((cp.feature_flags->'manual_review_frontier'->>'active')::boolean, false) = false
  AND cp.status NOT IN ('archived','deleted');

REVOKE ALL ON public.v_manual_review_frontier_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_manual_review_frontier_candidates TO service_role;

-- 3) Read-only admin RPC
CREATE OR REPLACE FUNCTION public.admin_get_manual_review_frontier_candidates()
RETURNS TABLE(
  package_id uuid,
  status text,
  package_key text,
  park_skips_24h int,
  tail_fails_24h int,
  bronze_locked boolean,
  severity text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
    SELECT v.package_id, v.status, v.package_key,
           v.park_skips_24h, v.tail_fails_24h, v.bronze_locked, v.severity
    FROM public.v_manual_review_frontier_candidates v
    ORDER BY
      CASE v.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      v.tail_fails_24h DESC,
      v.park_skips_24h DESC;
END
$$;

REVOKE ALL ON FUNCTION public.admin_get_manual_review_frontier_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_manual_review_frontier_candidates() TO authenticated;

-- 4) Set frontier (admin-gated)
CREATE OR REPLACE FUNCTION public.admin_set_manual_review_frontier(
  p_package_id uuid,
  p_reason text,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing boolean;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason required (min 10 chars)';
  END IF;

  SELECT COALESCE((feature_flags->'manual_review_frontier'->>'active')::boolean,false)
    INTO v_existing
    FROM course_packages WHERE id = p_package_id;

  IF v_existing THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'reason', 'already_frontier');
  END IF;

  UPDATE course_packages
     SET feature_flags = COALESCE(feature_flags,'{}'::jsonb)
                          || jsonb_build_object(
                               'manual_review_frontier',
                               jsonb_build_object(
                                 'active', true,
                                 'manual_bypass', false,
                                 'set_at', now(),
                                 'set_by', auth.uid(),
                                 'reason', p_reason,
                                 'evidence', p_evidence
                               )
                             ),
         updated_at = now()
   WHERE id = p_package_id;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('manual_review_frontier_set', 'admin_rpc', 'package', p_package_id::text, 'success',
          jsonb_build_object('reason', p_reason, 'evidence', p_evidence, 'set_by', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id);
END
$$;

REVOKE ALL ON FUNCTION public.admin_set_manual_review_frontier(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_manual_review_frontier(uuid,text,jsonb) TO authenticated;

-- 5) Clear / bypass (admin-gated)
CREATE OR REPLACE FUNCTION public.admin_clear_manual_review_frontier(
  p_package_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason required (min 10 chars)';
  END IF;

  UPDATE course_packages
     SET feature_flags = jsonb_set(
                           COALESCE(feature_flags,'{}'::jsonb),
                           '{manual_review_frontier,manual_bypass}',
                           'true'::jsonb,
                           true
                         )
                         || jsonb_build_object(
                              'manual_review_frontier_cleared',
                              jsonb_build_object(
                                'cleared_at', now(),
                                'cleared_by', auth.uid(),
                                'reason', p_reason
                              )
                            ),
         updated_at = now()
   WHERE id = p_package_id;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('manual_review_frontier_cleared', 'admin_rpc', 'package', p_package_id::text, 'success',
          jsonb_build_object('reason', p_reason, 'cleared_by', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id);
END
$$;

REVOKE ALL ON FUNCTION public.admin_clear_manual_review_frontier(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_manual_review_frontier(uuid,text) TO authenticated;

-- 6) Guard-Trigger: block tail-job enqueue on frontier packages (audit-mirror pattern)
CREATE OR REPLACE FUNCTION public.fn_guard_manual_review_frontier_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg uuid;
BEGIN
  IF NEW.job_type NOT IN ('package_run_integrity_check','package_quality_council','package_auto_publish') THEN
    RETURN NEW;
  END IF;

  v_pkg := COALESCE(NEW.package_id, NULLIF(NEW.payload->>'package_id','')::uuid);
  IF v_pkg IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.fn_is_manual_review_frontier(v_pkg) THEN
    BEGIN
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('manual_review_frontier_enqueue_blocked',
              COALESCE(NEW.payload->>'enqueue_source','unknown'),
              'package', v_pkg::text, 'blocked',
              jsonb_build_object('job_type', NEW.job_type,
                                 'attempted_payload_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(COALESCE(NEW.payload,'{}'::jsonb)) k)));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;  -- silent drop with audit
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_manual_review_frontier_enqueue ON public.job_queue;
CREATE TRIGGER trg_guard_manual_review_frontier_enqueue
BEFORE INSERT ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_manual_review_frontier_enqueue();

-- 7) Audit: migration applied
INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
VALUES ('manual_review_frontier_installed','migration','system',NULL,'success',
        jsonb_build_object('version','fix-c-v1','date','2026-05-15'));
