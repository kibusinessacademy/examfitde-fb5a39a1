-- 1) Cooldown guard in admin_pull_deferred_jobs_forward (10 min)
CREATE OR REPLACE FUNCTION public.admin_pull_deferred_jobs_forward(
  p_job_type text DEFAULT NULL::text,
  p_worker_pool text DEFAULT NULL::text,
  p_max_jobs integer DEFAULT 50,
  p_reason text DEFAULT NULL::text,
  p_dry_run boolean DEFAULT false,
  p_new_run_after timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_target_ts timestamptz := COALESCE(p_new_run_after, now());
  v_caller uuid := auth.uid();
  v_eligible_ids uuid[];
  v_updated_ids uuid[] := '{}';
  v_skipped_bronze int := 0;
  v_total_eligible int := 0;
  v_cap int := LEAST(GREATEST(COALESCE(p_max_jobs, 50), 1), 200);
BEGIN
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required (min 5 chars)';
  END IF;

  -- Cooldown: 10 minutes between successful pulls (per actor; dry_run not counted)
  IF NOT p_dry_run AND EXISTS (
    SELECT 1
    FROM public.auto_heal_log
    WHERE action_type = 'admin_pull_deferred_jobs_forward'
      AND result_status = 'ok'
      AND created_at > now() - interval '10 minutes'
      AND COALESCE((metadata->>'actor')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) = v_caller
  ) THEN
    RAISE EXCEPTION 'deferred_pull_cooldown_active (10 min between pulls)';
  END IF;

  SELECT array_agg(id ORDER BY run_after ASC)
    INTO v_eligible_ids
  FROM public.job_queue
  WHERE status IN ('pending','queued')
    AND run_after IS NOT NULL
    AND run_after > now()
    AND COALESCE((meta->>'admin_terminal')::boolean, false) = false
    AND (p_job_type IS NULL OR job_type = p_job_type)
    AND (p_worker_pool IS NULL OR COALESCE(worker_pool,'default') = p_worker_pool);

  v_total_eligible := COALESCE(array_length(v_eligible_ids, 1), 0);

  IF v_total_eligible > v_cap THEN
    v_eligible_ids := v_eligible_ids[1:v_cap];
  END IF;

  IF v_eligible_ids IS NOT NULL AND array_length(v_eligible_ids,1) > 0 THEN
    WITH cand AS (
      SELECT j.id, j.payload->>'package_id' AS pkg_id
      FROM public.job_queue j
      WHERE j.id = ANY(v_eligible_ids)
    ),
    bronze AS (
      SELECT DISTINCT cp.id AS pkg_id
      FROM public.course_packages cp
      WHERE cp.id::text IN (SELECT pkg_id FROM cand WHERE pkg_id IS NOT NULL)
        AND public.fn_is_bronze_locked(cp.id)
    ),
    keep AS (
      SELECT c.id FROM cand c
      WHERE c.pkg_id IS NULL OR c.pkg_id NOT IN (SELECT pkg_id::text FROM bronze)
    )
    SELECT array_agg(id) INTO v_eligible_ids FROM keep;

    v_skipped_bronze := COALESCE(v_cap, v_total_eligible) - COALESCE(array_length(v_eligible_ids,1), 0);
  END IF;

  IF NOT p_dry_run AND v_eligible_ids IS NOT NULL AND array_length(v_eligible_ids,1) > 0 THEN
    UPDATE public.job_queue
       SET run_after = v_target_ts,
           updated_at = now(),
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'admin_pull_forward', jsonb_build_object(
               'run_id', v_run_id,
               'previous_run_after', run_after,
               'pulled_at', now(),
               'actor', v_caller,
               'reason', p_reason
             )
           )
     WHERE id = ANY(v_eligible_ids)
    RETURNING id INTO v_updated_ids;
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'admin_pull_deferred_jobs_forward',
    'job_queue',
    v_run_id::text,
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'ok' END,
    format('pulled %s of %s eligible (cap %s, bronze-skipped %s)',
      COALESCE(array_length(v_updated_ids,1),0),
      v_total_eligible, v_cap, v_skipped_bronze),
    jsonb_build_object(
      'run_id', v_run_id,
      'job_type', p_job_type,
      'worker_pool', p_worker_pool,
      'reason', p_reason,
      'dry_run', p_dry_run,
      'target_run_after', v_target_ts,
      'total_eligible', v_total_eligible,
      'cap', v_cap,
      'bronze_skipped', v_skipped_bronze,
      'updated_count', COALESCE(array_length(v_updated_ids,1),0),
      'updated_ids', COALESCE(to_jsonb(v_updated_ids), '[]'::jsonb),
      'actor', v_caller
    )
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'dry_run', p_dry_run,
    'total_eligible', v_total_eligible,
    'cap_applied', v_cap,
    'bronze_skipped', v_skipped_bronze,
    'updated_count', COALESCE(array_length(v_updated_ids,1),0),
    'updated_ids', COALESCE(to_jsonb(v_updated_ids), '[]'::jsonb),
    'target_run_after', v_target_ts
  );
END;
$function$;

-- 2) Preview RPC: list affected jobs with run_after spans + flags
CREATE OR REPLACE FUNCTION public.admin_preview_deferred_jobs_pull(
  p_job_type text DEFAULT NULL,
  p_worker_pool text DEFAULT NULL,
  p_max_jobs integer DEFAULT 50
)
RETURNS TABLE(
  job_id uuid,
  job_type text,
  worker_pool text,
  package_id uuid,
  run_after timestamptz,
  in_seconds bigint,
  attempts integer,
  is_admin_terminal boolean,
  is_bronze_locked boolean,
  would_pull boolean,
  skip_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cap int := LEAST(GREATEST(COALESCE(p_max_jobs, 50), 1), 200);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      j.id AS job_id,
      j.job_type,
      COALESCE(j.worker_pool,'default') AS worker_pool,
      NULLIF(j.payload->>'package_id','')::uuid AS package_id,
      j.run_after,
      EXTRACT(EPOCH FROM (j.run_after - now()))::bigint AS in_seconds,
      COALESCE(j.attempts, 0) AS attempts,
      COALESCE((j.meta->>'admin_terminal')::boolean, false) AS is_admin_terminal
    FROM public.job_queue j
    WHERE j.status IN ('pending','queued')
      AND j.run_after IS NOT NULL
      AND j.run_after > now()
      AND (p_job_type IS NULL OR j.job_type = p_job_type)
      AND (p_worker_pool IS NULL OR COALESCE(j.worker_pool,'default') = p_worker_pool)
    ORDER BY j.run_after ASC
    LIMIT v_cap
  ),
  enriched AS (
    SELECT b.*,
      CASE
        WHEN b.package_id IS NOT NULL AND public.fn_is_bronze_locked(b.package_id) THEN true
        ELSE false
      END AS is_bronze_locked
    FROM base b
  )
  SELECT
    e.job_id,
    e.job_type,
    e.worker_pool,
    e.package_id,
    e.run_after,
    e.in_seconds,
    e.attempts,
    e.is_admin_terminal,
    e.is_bronze_locked,
    (NOT e.is_admin_terminal AND NOT e.is_bronze_locked) AS would_pull,
    CASE
      WHEN e.is_admin_terminal THEN 'admin_terminal'
      WHEN e.is_bronze_locked THEN 'bronze_locked'
      ELSE NULL
    END AS skip_reason
  FROM enriched e
  ORDER BY e.run_after ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_preview_deferred_jobs_pull(text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_preview_deferred_jobs_pull(text,text,integer) TO authenticated;