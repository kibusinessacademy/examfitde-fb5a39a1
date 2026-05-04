--==========================================================
-- 1. SOFORTHEILUNG: queued → building + Re-Enqueue
--==========================================================
DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    '737b0880-dff2-4251-9df5-41cfe666e6fe'::uuid, -- Bootsbauer
    'c08cd3ce-1fbc-47fa-ac9a-a90a5f4f941b'::uuid, -- Fischwirt
    '8418d7c6-d708-4733-bf83-b598eee64a15'::uuid, -- Gärtner
    'c142cef2-5efa-438e-a11c-88e387241e65'::uuid, -- Hafenschiffer
    '861ddde2-7427-43ab-869a-0c9f98a2ea11'::uuid, -- Maurer
    '9d96a0ad-4a32-4fa1-8ab6-da89856211f7'::uuid, -- Mikrotechnologe
    '7163501c-98f4-4863-8240-467a84953465'::uuid, -- Raumausstatter
    '8d66ce11-396d-4519-8cf4-5a2e91bf1ceb'::uuid, -- Servicefachkraft
    '7c36f3a0-8a1a-4766-a6ad-bfa7221f09dd'::uuid  -- Spielzeughersteller
  ];
  v_pkg uuid;
  v_curr uuid;
  v_job_id uuid;
  v_reason text := 'one_time_sql_bypass: bronze_manual_approve_re_enqueue_after_ops_guard_cancel';
BEGIN
  FOREACH v_pkg IN ARRAY v_pkg_ids LOOP
    SELECT curriculum_id INTO v_curr FROM public.course_packages WHERE id = v_pkg FOR UPDATE;

    -- Force queued → building (mit Audit-Tag)
    UPDATE public.course_packages
    SET status = 'building',
        feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object(
          'admin_force_building_reason', 'bronze_manual_approve_status_promotion',
          'admin_force_building_at', now()
        ),
        updated_at = now()
    WHERE id = v_pkg AND status = 'queued';

    -- Re-Enqueue
    IF NOT EXISTS (
      SELECT 1 FROM public.job_queue
      WHERE package_id = v_pkg AND job_type = 'package_auto_publish'
        AND status IN ('pending','processing')
    ) THEN
      INSERT INTO public.job_queue (package_id, job_type, status, priority, payload, meta, created_at)
      VALUES (
        v_pkg, 'package_auto_publish', 'pending', 5,
        jsonb_build_object(
          'bronze_lock_override', true,
          'reason', v_reason,
          'enqueue_source', 'bronze_manual_approve_sql_bypass_v2',
          'package_id', v_pkg,
          'curriculum_id', v_curr,
          'step_key', 'auto_publish'
        ),
        jsonb_build_object('enqueue_source', 'bronze_manual_approve_sql_bypass_v2', 'step_key', 'auto_publish'),
        now()
      )
      RETURNING id INTO v_job_id;

      INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
      VALUES (
        'bronze_manual_approve_re_enqueue', 'one_time_sql_bypass', 'package', v_pkg, 'success',
        jsonb_build_object('package_id', v_pkg, 'job_id', v_job_id, 'reason', v_reason)
      );
    END IF;
  END LOOP;
END $$;

--==========================================================
-- 2. RPC FIX: admin_bronze_manual_approve_for_publish
--==========================================================
CREATE OR REPLACE FUNCTION public.admin_bronze_manual_approve_for_publish(
  p_package_id uuid,
  p_reason text DEFAULT 'admin_manual_review'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record;
  v_curr uuid;
  v_score numeric;
  v_badge text;
  v_pricing_ready boolean;
  v_active_publish boolean;
  v_status_promoted boolean := false;
  v_new_flags jsonb;
  v_job_id uuid;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'access_denied: admin or service_role required';
  END IF;

  SELECT id, status, feature_flags, integrity_passed, council_approved, curriculum_id
    INTO v_pkg
  FROM public.course_packages
  WHERE id = p_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_not_found: %', p_package_id;
  END IF;

  v_curr := v_pkg.curriculum_id;

  -- Guards
  IF NOT public.fn_is_bronze_locked(p_package_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_BRONZE_LOCKED');
  END IF;

  v_score := NULLIF(v_pkg.feature_flags->'bronze'->>'score','')::numeric;
  v_badge := v_pkg.feature_flags->'bronze'->>'badge';
  IF v_score IS NULL OR v_score < 75 OR v_score >= 85 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SCORE_OUT_OF_BRONZE_WINDOW', 'score', v_score);
  END IF;

  IF NOT COALESCE(v_pkg.integrity_passed, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INTEGRITY_NOT_PASSED');
  END IF;

  v_pricing_ready := COALESCE((public.fn_package_pricing_ready(p_package_id)->>'ready')::boolean, false);
  IF NOT v_pricing_ready THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PRICING_NOT_READY');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.job_queue
    WHERE package_id = p_package_id
      AND job_type = 'package_auto_publish'
      AND status IN ('pending','processing')
  ) INTO v_active_publish;
  IF v_active_publish THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACTIVE_PUBLISH_JOB_EXISTS');
  END IF;

  -- Status-Promotion: queued → building (sonst kommt OPS_GUARD-Cancel)
  IF v_pkg.status = 'queued' THEN
    UPDATE public.course_packages
    SET status = 'building',
        feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object(
          'admin_force_building_reason', 'bronze_manual_approve_status_promotion',
          'admin_force_building_at', now(),
          'admin_force_building_by', v_uid
        ),
        updated_at = now()
    WHERE id = p_package_id;
    v_status_promoted := true;
  END IF;

  -- Bronze-Block aktualisieren
  v_new_flags := COALESCE(v_pkg.feature_flags, '{}'::jsonb) || jsonb_build_object(
    'bronze',
    COALESCE(v_pkg.feature_flags->'bronze', '{}'::jsonb) || jsonb_build_object(
      'final_state', 'manual_approved',
      'requires_review', false,
      'repair_active', false,
      'manual_approved_at', now(),
      'manual_approved_by', v_uid,
      'manual_approved_reason', p_reason
    )
  );

  UPDATE public.course_packages
  SET feature_flags = v_new_flags, updated_at = now()
  WHERE id = p_package_id;

  -- Enqueue korrekt: status='pending', vollständiges payload
  INSERT INTO public.job_queue (package_id, job_type, status, priority, payload, meta, created_at)
  VALUES (
    p_package_id, 'package_auto_publish', 'pending', 5,
    jsonb_build_object(
      'bronze_lock_override', true,
      'manual_approved_by', v_uid,
      'reason', p_reason,
      'enqueue_source', 'bronze_manual_approve',
      'package_id', p_package_id,
      'curriculum_id', v_curr,
      'step_key', 'auto_publish'
    ),
    jsonb_build_object('enqueue_source', 'bronze_manual_approve', 'step_key', 'auto_publish'),
    now()
  )
  RETURNING id INTO v_job_id;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
  VALUES (
    'bronze_manual_approved_for_publish', 'admin_rpc', 'package', p_package_id, 'success',
    jsonb_build_object(
      'package_id', p_package_id, 'curriculum_id', v_curr,
      'approved_by', v_uid, 'reason', p_reason,
      'score', v_score, 'badge', v_badge,
      'job_id', v_job_id, 'status_promoted', v_status_promoted
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'job_id', v_job_id,
    'score', v_score,
    'badge', v_badge,
    'final_state', 'manual_approved',
    'status_promoted', v_status_promoted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_bronze_manual_approve_for_publish(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bronze_manual_approve_for_publish(uuid, text) TO authenticated, service_role;

--==========================================================
-- 3. AUTO-GUARD RPC
--==========================================================
CREATE OR REPLACE FUNCTION public.admin_auto_bronze_approve_eligible_packages(
  p_dry_run boolean DEFAULT false,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record;
  v_result jsonb;
  v_processed jsonb := '[]'::jsonb;
  v_ok_count int := 0;
  v_skip_count int := 0;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'access_denied: admin or service_role required';
  END IF;

  FOR v_pkg IN
    SELECT cp.id, cp.title,
           NULLIF(cp.feature_flags->'bronze'->>'score','')::numeric AS score
    FROM public.course_packages cp
    WHERE cp.feature_flags ? 'bronze'
      AND COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean, false) = true
      AND cp.feature_flags->'bronze'->>'final_state' IS DISTINCT FROM 'manual_approved'
      AND COALESCE(cp.integrity_passed, false) = true
      AND NULLIF(cp.feature_flags->'bronze'->>'score','')::numeric BETWEEN 75 AND 84.99
      AND COALESCE((public.fn_package_pricing_ready(cp.id)->>'ready')::boolean, false) = true
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.package_id = cp.id
          AND jq.job_type = 'package_auto_publish'
          AND jq.status IN ('pending','processing')
      )
    ORDER BY cp.updated_at ASC
    LIMIT p_limit
  LOOP
    IF p_dry_run THEN
      v_processed := v_processed || jsonb_build_object(
        'package_id', v_pkg.id, 'title', v_pkg.title, 'score', v_pkg.score, 'action', 'would_approve'
      );
      v_ok_count := v_ok_count + 1;
    ELSE
      v_result := public.admin_bronze_manual_approve_for_publish(v_pkg.id, 'auto_bronze_approve_cron');
      v_processed := v_processed || jsonb_build_object(
        'package_id', v_pkg.id, 'title', v_pkg.title, 'score', v_pkg.score, 'result', v_result
      );
      IF COALESCE((v_result->>'ok')::boolean, false) THEN
        v_ok_count := v_ok_count + 1;
      ELSE
        v_skip_count := v_skip_count + 1;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
  VALUES (
    'auto_bronze_approve_eligible_run',
    CASE WHEN p_dry_run THEN 'manual_dry_run' ELSE 'cron' END,
    'system', NULL, CASE WHEN v_ok_count>0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object('ok_count', v_ok_count, 'skip_count', v_skip_count, 'dry_run', p_dry_run, 'processed', v_processed)
  );

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run,
    'ok_count', v_ok_count, 'skip_count', v_skip_count,
    'processed', v_processed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_auto_bronze_approve_eligible_packages(boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auto_bronze_approve_eligible_packages(boolean, int) TO authenticated, service_role;

--==========================================================
-- 4. CRON: alle 30 Min
--==========================================================
DO $$
BEGIN
  -- Drop existing if any
  PERFORM cron.unschedule('auto-bronze-approve-eligible-30min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-bronze-approve-eligible-30min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-bronze-approve-eligible-30min',
  '*/30 * * * *',
  $$SELECT public.admin_auto_bronze_approve_eligible_packages(false, 20);$$
);

--==========================================================
-- 5. SSOT Validator Failure Log
--==========================================================
CREATE TABLE IF NOT EXISTS public.ssot_validator_failure_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  job_type text NOT NULL,
  enqueue_source text,
  missing_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  violations text[] NOT NULL DEFAULT ARRAY[]::text[],
  auto_derived jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_snapshot jsonb,
  was_critical boolean NOT NULL DEFAULT false,
  job_id uuid,
  package_id uuid
);

CREATE INDEX IF NOT EXISTS idx_ssot_validator_failure_log_created
  ON public.ssot_validator_failure_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssot_validator_failure_log_job_type
  ON public.ssot_validator_failure_log (job_type, created_at DESC);

ALTER TABLE public.ssot_validator_failure_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ssot_validator_failure_log_admin_read ON public.ssot_validator_failure_log;
CREATE POLICY ssot_validator_failure_log_admin_read
  ON public.ssot_validator_failure_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

--==========================================================
-- 6. View + RPC für Monitoring
--==========================================================
CREATE OR REPLACE VIEW public.v_ssot_validator_failures_24h AS
SELECT
  job_type,
  COALESCE(enqueue_source, 'unknown') AS enqueue_source,
  unnest(missing_fields) AS missing_field,
  count(*) AS n,
  count(*) FILTER (WHERE was_critical) AS n_critical,
  min(created_at) AS first_seen,
  max(created_at) AS last_seen
FROM public.ssot_validator_failure_log
WHERE created_at > now() - interval '24 hours'
GROUP BY job_type, COALESCE(enqueue_source, 'unknown'), missing_field;

REVOKE ALL ON public.v_ssot_validator_failures_24h FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ssot_validator_failures_24h TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_ssot_validator_failures(p_window_hours int DEFAULT 24)
RETURNS TABLE(
  job_type text,
  enqueue_source text,
  missing_field text,
  n bigint,
  n_critical bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    s.job_type,
    COALESCE(s.enqueue_source, 'unknown'),
    mf,
    count(*),
    count(*) FILTER (WHERE s.was_critical),
    min(s.created_at),
    max(s.created_at)
  FROM public.ssot_validator_failure_log s
  CROSS JOIN LATERAL unnest(s.missing_fields) AS mf
  WHERE s.created_at > now() - make_interval(hours => p_window_hours)
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    )
  GROUP BY s.job_type, COALESCE(s.enqueue_source, 'unknown'), mf
  ORDER BY count(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_ssot_validator_failures(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_ssot_validator_failures(int) TO authenticated, service_role;

--==========================================================
-- 7. SMOKE-TEST Function
--==========================================================
CREATE OR REPLACE FUNCTION public.fn_test_payload_validator()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg uuid;
  v_curr uuid;
  v_job_id uuid;
  v_payload_after jsonb;
  v_results jsonb := '{}'::jsonb;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- Pick any building package for smoke
  SELECT id, curriculum_id INTO v_pkg, v_curr
  FROM public.course_packages
  WHERE status = 'building' AND curriculum_id IS NOT NULL
  LIMIT 1;

  IF v_pkg IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_BUILDING_PACKAGE_FOR_SMOKE');
  END IF;

  -- Test 1: full payload — should pass without violations
  BEGIN
    INSERT INTO public.job_queue (package_id, job_type, status, priority, payload, meta)
    VALUES (
      v_pkg, 'package_auto_publish', 'pending', 9,
      jsonb_build_object(
        'package_id', v_pkg, 'curriculum_id', v_curr,
        'step_key', 'auto_publish',
        'enqueue_source', 'fn_test_payload_validator_smoke',
        '__smoke__', true
      ),
      jsonb_build_object('enqueue_source', 'fn_test_payload_validator_smoke', 'step_key', 'auto_publish')
    )
    RETURNING id, payload INTO v_job_id, v_payload_after;
    v_results := v_results || jsonb_build_object('test_full_payload', jsonb_build_object('ok', true, 'job_id', v_job_id));
    DELETE FROM public.job_queue WHERE id = v_job_id;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test_full_payload', jsonb_build_object('ok', false, 'error', SQLERRM));
  END;

  -- Test 2: missing step_key — validator should auto-derive (NOT raise)
  BEGIN
    INSERT INTO public.job_queue (package_id, job_type, status, priority, payload)
    VALUES (
      v_pkg, 'package_auto_publish', 'pending', 9,
      jsonb_build_object(
        'package_id', v_pkg, 'curriculum_id', v_curr,
        'enqueue_source', 'fn_test_payload_validator_smoke_no_step',
        '__smoke__', true
      )
    )
    RETURNING id, payload INTO v_job_id, v_payload_after;
    v_results := v_results || jsonb_build_object(
      'test_missing_step_key',
      jsonb_build_object('ok', true, 'auto_filled_step_key', v_payload_after->>'step_key')
    );
    DELETE FROM public.job_queue WHERE id = v_job_id;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test_missing_step_key', jsonb_build_object('ok', false, 'error', SQLERRM));
  END;

  -- Test 3: missing curriculum_id — should fail when enforcement active OR be flagged
  BEGIN
    INSERT INTO public.job_queue (package_id, job_type, status, priority, payload)
    VALUES (
      v_pkg, 'package_auto_publish', 'pending', 9,
      jsonb_build_object(
        'package_id', v_pkg,
        'step_key', 'auto_publish',
        'enqueue_source', 'fn_test_payload_validator_smoke_no_curr',
        '__smoke__', true
      )
    )
    RETURNING id INTO v_job_id;
    v_results := v_results || jsonb_build_object(
      'test_missing_curriculum_id',
      jsonb_build_object('inserted', true, 'note', 'enforcement_pre_2026-05-09', 'job_id', v_job_id)
    );
    DELETE FROM public.job_queue WHERE id = v_job_id;
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object(
      'test_missing_curriculum_id',
      jsonb_build_object('blocked', true, 'error', SQLERRM, 'expected_after', '2026-05-09')
    );
  END;

  RETURN jsonb_build_object('ok', true, 'tested_at', now(), 'tested_with_package', v_pkg, 'results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_test_payload_validator() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_test_payload_validator() TO authenticated, service_role;