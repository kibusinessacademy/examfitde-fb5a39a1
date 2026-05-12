
-- ============================================================
-- 1) Helper: classify publish last_error into groups
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_classify_publish_last_error(p_last_error text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_last_error IS NULL OR length(trim(p_last_error)) = 0 THEN NULL
    WHEN p_last_error ILIKE '%COURSE_PUBLISH_READINESS_BLOCKED%'
      OR p_last_error ILIKE '%missing {modules%'
      OR p_last_error ILIKE '%missing {lessons%'
      OR p_last_error ILIKE '%track_aware%'                                  THEN 'TRACK_GUARD'
    WHEN p_last_error ILIKE '%PRICING_%'
      OR p_last_error ILIKE '%stripe_price_id%'
      OR p_last_error ILIKE '%product_id%'
      OR p_last_error ILIKE '%active price%'
      OR p_last_error ILIKE '%pricing_ready%'                                THEN 'PRICING_PRODUCT'
    WHEN p_last_error ILIKE '%council_approved%'
      OR p_last_error ILIKE '%integrity_report%'
      OR p_last_error ILIKE '%must produce artifact%'
      OR p_last_error ILIKE '%COUNCIL_GATE%'
      OR p_last_error ILIKE '%LESSON_QC_GATE%'
      OR p_last_error ILIKE '%COURSE_READY%'                                 THEN 'PUBLISH_ARTIFACT'
    WHEN p_last_error ILIKE '%BRONZE_LOCKED%'
      OR p_last_error ILIKE '%bronze_lock%'                                  THEN 'BRONZE_LOCK'
    WHEN p_last_error LIKE 'PARKED_AWAITING_PRECONDITION%'
      OR p_last_error ILIKE '%PARKED_PREREQ%'                                THEN 'PARKED_PREREQ'
    WHEN p_last_error ILIKE '%REQUEUE_LOOP%'
      OR p_last_error ILIKE '%ROOT_CAUSE_HEALED%'
      OR p_last_error ILIKE '%STEP_ALREADY_DONE%'                            THEN 'NOOP_LOOP'
    ELSE 'OTHER'
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_classify_publish_last_error(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_classify_publish_last_error(text) TO service_role, authenticated;

-- ============================================================
-- 2) Backfill RPC: council_approved aus quality_council.meta
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_backfill_council_approved(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eligible int := 0;
  v_updated int := 0;
  v_packages jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  WITH cand AS (
    SELECT cp.id, cp.title,
           (ps.meta->>'score')::numeric AS score,
           ps.meta->>'status' AS verdict,
           ps.meta->>'badge'  AS badge
    FROM course_packages cp
    JOIN package_steps ps
      ON ps.package_id = cp.id AND ps.step_key = 'quality_council'
    WHERE ps.status = 'done'
      AND cp.council_approved = false
      AND (ps.meta->>'score') IS NOT NULL
      AND (ps.meta->>'score')::numeric >= 75
      AND COALESCE(ps.meta->>'status','') IN ('PASS','REVIEW_REQUIRED','APPROVED')
  )
  SELECT count(*),
         jsonb_agg(jsonb_build_object('id', id, 'title', title,
                                       'score', score, 'verdict', verdict, 'badge', badge))
  INTO v_eligible, v_packages FROM cand;

  IF NOT p_dry_run AND v_eligible > 0 THEN
    UPDATE course_packages cp
    SET council_approved = true,
        council_approved_at = COALESCE(cp.council_approved_at, now())
    FROM package_steps ps
    WHERE ps.package_id = cp.id
      AND ps.step_key = 'quality_council'
      AND ps.status = 'done'
      AND cp.council_approved = false
      AND (ps.meta->>'score') IS NOT NULL
      AND (ps.meta->>'score')::numeric >= 75
      AND COALESCE(ps.meta->>'status','') IN ('PASS','REVIEW_REQUIRED','APPROVED');
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('council_approved_artifact_backfill','system','success',
      jsonb_build_object('updated', v_updated, 'eligible', v_eligible,
                         'triggered_by', auth.uid()::text));
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'eligible', v_eligible,
    'updated', v_updated,
    'packages', COALESCE(v_packages, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_council_approved(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_backfill_council_approved(boolean) TO authenticated, service_role;

-- ============================================================
-- 3) Producer-Trigger: quality_council done -> council_approved=true
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_sync_council_approved_on_step_done()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score numeric;
  v_verdict text;
BEGIN
  IF NEW.step_key <> 'quality_council' OR NEW.status <> 'done' THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'UPDATE' AND OLD.status = 'done') THEN
    RETURN NEW; -- no-op
  END IF;

  v_score := NULLIF(NEW.meta->>'score','')::numeric;
  v_verdict := COALESCE(NEW.meta->>'status','');

  IF v_score IS NOT NULL AND v_score >= 75
     AND v_verdict IN ('PASS','REVIEW_REQUIRED','APPROVED') THEN
    UPDATE course_packages
    SET council_approved = true,
        council_approved_at = COALESCE(council_approved_at, now())
    WHERE id = NEW.package_id AND council_approved = false;

    IF FOUND THEN
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('council_approved_artifact_autoset','package', NEW.package_id::text,'success',
        jsonb_build_object('score', v_score, 'verdict', v_verdict, 'source','step_done_trigger'));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_council_approved_on_step_done ON public.package_steps;
CREATE TRIGGER trg_sync_council_approved_on_step_done
AFTER INSERT OR UPDATE OF status, meta ON public.package_steps
FOR EACH ROW
WHEN (NEW.step_key = 'quality_council' AND NEW.status = 'done')
EXECUTE FUNCTION public.fn_sync_council_approved_on_step_done();

-- ============================================================
-- 4) RPC: targeted auto_publish retry für ausgewählte Pakete
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_retry_auto_publish_for_packages(p_package_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_resets int := 0;
  v_jobs_inserted int := 0;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_package_ids IS NULL OR array_length(p_package_ids,1) IS NULL THEN
    RAISE EXCEPTION 'p_package_ids must not be empty';
  END IF;

  -- Failed steps -> queued
  UPDATE package_steps ps
  SET status = 'queued',
      updated_at = now(),
      meta = COALESCE(meta,'{}'::jsonb)
        || jsonb_build_object(
          'manual_retry_reason','admin_targeted_auto_publish_retry',
          'manual_retry_at', now(),
          'manual_retry_by', auth.uid()::text
        )
  WHERE ps.package_id = ANY(p_package_ids)
    AND ps.step_key = 'auto_publish'
    AND ps.status = 'failed';
  GET DIAGNOSTICS v_step_resets = ROW_COUNT;

  -- Enqueue fehlende Jobs (idempotent: nur wenn aktuell kein aktiver job)
  WITH ins AS (
    INSERT INTO job_queue (
      job_type, status, package_id, payload, priority, worker_pool, job_name,
      run_after, created_at, updated_at
    )
    SELECT
      'package_auto_publish','pending', cp.id,
      jsonb_build_object(
        'package_id', cp.id,
        'curriculum_id', cp.curriculum_id,
        'step_key','auto_publish',
        'enqueue_source','admin_targeted_retry',
        'bronze_lock_override', true,
        'reason','admin_targeted_auto_publish_retry'
      ),
      5,'core','package_auto_publish', now(), now(), now()
    FROM course_packages cp
    JOIN package_steps ps
      ON ps.package_id = cp.id AND ps.step_key = 'auto_publish'
    WHERE cp.id = ANY(p_package_ids)
      AND ps.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = cp.id
          AND jq.job_type = 'package_auto_publish'
          AND jq.status IN ('pending','queued','processing')
      )
    RETURNING id
  )
  SELECT count(*) INTO v_jobs_inserted FROM ins;

  -- Skipped-Liste (Diagnose)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'package_id', cp.id, 'title', cp.title,
           'reason', CASE
             WHEN ps.id IS NULL THEN 'no_auto_publish_step'
             WHEN ps.status NOT IN ('queued','failed') THEN 'step_status_'||ps.status::text
             WHEN EXISTS (
               SELECT 1 FROM job_queue jq
               WHERE jq.package_id=cp.id
                 AND jq.job_type='package_auto_publish'
                 AND jq.status IN ('pending','queued','processing'))
               THEN 'active_job_present'
             ELSE 'unknown' END)),'[]'::jsonb)
  INTO v_skipped
  FROM course_packages cp
  LEFT JOIN package_steps ps
    ON ps.package_id=cp.id AND ps.step_key='auto_publish'
  WHERE cp.id = ANY(p_package_ids)
    AND (
      ps.id IS NULL
      OR ps.status NOT IN ('queued','failed')
      OR EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id=cp.id
          AND jq.job_type='package_auto_publish'
          AND jq.status IN ('pending','queued','processing')
          AND jq.created_at < now() - interval '5 seconds'
      )
    );

  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('manual_targeted_auto_publish_retry','system','success',
    jsonb_build_object(
      'package_ids', to_jsonb(p_package_ids),
      'step_resets', v_step_resets,
      'jobs_inserted', v_jobs_inserted,
      'bronze_lock_override', true,
      'triggered_by', auth.uid()::text,
      'reason', 'admin_targeted_auto_publish_retry'));

  RETURN jsonb_build_object(
    'package_ids', to_jsonb(p_package_ids),
    'step_resets', v_step_resets,
    'jobs_inserted', v_jobs_inserted,
    'skipped', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retry_auto_publish_for_packages(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_retry_auto_publish_for_packages(uuid[]) TO authenticated, service_role;

-- ============================================================
-- 5) RPC: Status-Rescan + Klassifizierung nach Retry
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_auto_publish_retry_status(p_package_ids uuid[])
RETURNS TABLE (
  package_id uuid,
  title text,
  pkg_status text,
  auto_publish_step text,
  latest_job_status text,
  latest_job_updated_at timestamptz,
  last_error text,
  error_group text,
  council_approved boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    cp.id,
    cp.title,
    cp.status::text,
    ps.status::text,
    jq.status::text,
    jq.updated_at,
    jq.last_error,
    public.fn_classify_publish_last_error(jq.last_error),
    cp.council_approved
  FROM course_packages cp
  LEFT JOIN package_steps ps
    ON ps.package_id = cp.id AND ps.step_key = 'auto_publish'
  LEFT JOIN LATERAL (
    SELECT j.status, j.updated_at, j.last_error
    FROM job_queue j
    WHERE j.package_id = cp.id AND j.job_type = 'package_auto_publish'
    ORDER BY j.updated_at DESC
    LIMIT 1
  ) jq ON true
  WHERE cp.id = ANY(p_package_ids)
    AND public.has_role(auth.uid(), 'admin');
$$;

REVOKE ALL ON FUNCTION public.admin_get_auto_publish_retry_status(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_auto_publish_retry_status(uuid[]) TO authenticated, service_role;

-- ============================================================
-- 6) RPC: Manual-Retry Audit-View mit Filtern
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_manual_retry_audit(
  p_action_types text[] DEFAULT NULL,
  p_package_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT (now() - interval '24 hours'),
  p_until timestamptz DEFAULT now(),
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action_type text,
  result_status text,
  target_type text,
  target_id text,
  metadata jsonb,
  package_ids text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    l.id,
    l.created_at,
    l.action_type,
    COALESCE(l.result_status,'unknown') AS result_status,
    COALESCE(l.target_type,'system') AS target_type,
    l.target_id,
    l.metadata,
    CASE
      WHEN jsonb_typeof(l.metadata->'package_ids') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(l.metadata->'package_ids'))
      WHEN l.target_id IS NOT NULL
        THEN ARRAY[l.target_id]
      ELSE ARRAY[]::text[]
    END AS package_ids
  FROM auto_heal_log l
  WHERE public.has_role(auth.uid(),'admin')
    AND l.created_at BETWEEN COALESCE(p_since, now() - interval '24 hours')
                         AND COALESCE(p_until, now())
    AND (
      p_action_types IS NULL
      OR l.action_type = ANY(p_action_types)
      OR (
        cardinality(p_action_types) = 1 AND p_action_types[1] = '__manual__'
        AND l.action_type IN (
          'manual_targeted_auto_publish_retry',
          'manual_cluster_b_c_auto_publish_retry',
          'council_approved_artifact_backfill',
          'council_approved_artifact_autoset',
          'bronze_tail_auto_unlock_inline'
        )
      )
    )
    AND (
      p_package_id IS NULL
      OR l.target_id = p_package_id::text
      OR l.metadata->>'package_id' = p_package_id::text
      OR (jsonb_typeof(l.metadata->'package_ids') = 'array'
          AND l.metadata->'package_ids' @> to_jsonb(p_package_id::text))
    )
  ORDER BY l.created_at DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit,200), 1000), 1);
$$;

REVOKE ALL ON FUNCTION public.admin_get_manual_retry_audit(text[], uuid, timestamptz, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_manual_retry_audit(text[], uuid, timestamptz, timestamptz, int) TO authenticated, service_role;

-- ============================================================
-- 7) Smoke-Test
-- ============================================================
DO $$
DECLARE
  v_classify text;
BEGIN
  v_classify := public.fn_classify_publish_last_error('COURSE_PUBLISH_READINESS_BLOCKED: missing {modules,lessons}');
  IF v_classify <> 'TRACK_GUARD' THEN
    RAISE EXCEPTION 'Smoke fail: TRACK_GUARD classifier expected, got %', v_classify;
  END IF;
  v_classify := public.fn_classify_publish_last_error('PRICING_NO_ACTIVE_PRICE');
  IF v_classify <> 'PRICING_PRODUCT' THEN
    RAISE EXCEPTION 'Smoke fail: PRICING_PRODUCT classifier expected, got %', v_classify;
  END IF;
  v_classify := public.fn_classify_publish_last_error('PARKED_AWAITING_PRECONDITION: quality_council must produce artifacts');
  IF v_classify NOT IN ('PARKED_PREREQ','PUBLISH_ARTIFACT') THEN
    RAISE EXCEPTION 'Smoke fail: PARKED_PREREQ classifier expected, got %', v_classify;
  END IF;
END $$;

INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('manual_retry_toolkit_migration_smoke','system','success',
  jsonb_build_object('migration','manual_retry_toolkit_v1','smoke','classifier_pass'));
