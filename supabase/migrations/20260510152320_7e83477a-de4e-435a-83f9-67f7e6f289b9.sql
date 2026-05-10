
-- Admin RPC: per (package, job_type) summary across job_queue + auto_heal_log
CREATE OR REPLACE FUNCTION public.admin_get_post_publish_growth_fanout(
  p_window_hours integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := now() - make_interval(hours => greatest(coalesce(p_window_hours, 24), 1));
  v_summary jsonb;
  v_per_pkg jsonb;
  v_per_type jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH job_types AS (
    SELECT unnest(ARRAY[
      'seo_indexnow_submit',
      'package_post_publish_blog',
      'package_distribution_plan',
      'package_campaign_assets_generate',
      'package_email_sequence_enroll',
      'package_og_image_generate'
    ]) AS jt
  ),
  jq AS (
    SELECT
      j.job_type,
      j.status,
      j.payload->>'package_id' AS package_id,
      j.created_at,
      j.completed_at,
      j.last_error,
      j.result
    FROM public.job_queue j
    JOIN job_types t ON t.jt = j.job_type
    WHERE j.created_at > v_start
  ),
  agg AS (
    SELECT
      job_type,
      status,
      count(*)::int AS cnt
    FROM jq
    GROUP BY 1,2
  )
  SELECT jsonb_agg(jsonb_build_object('job_type', job_type, 'status', status, 'count', cnt))
  INTO v_summary
  FROM agg;

  -- Per package
  WITH jq AS (
    SELECT
      (j.payload->>'package_id')::uuid AS package_id,
      j.job_type,
      j.status,
      j.completed_at,
      j.last_error
    FROM public.job_queue j
    WHERE j.created_at > v_start
      AND j.job_type IN (
        'seo_indexnow_submit','package_post_publish_blog','package_distribution_plan',
        'package_campaign_assets_generate','package_email_sequence_enroll','package_og_image_generate'
      )
      AND j.payload ? 'package_id'
  ),
  per_pkg AS (
    SELECT
      jq.package_id,
      cp.title,
      cp.package_key,
      jsonb_agg(jsonb_build_object(
        'job_type', jq.job_type,
        'status', jq.status,
        'completed_at', jq.completed_at,
        'last_error', jq.last_error
      ) ORDER BY jq.job_type) AS jobs,
      count(*) FILTER (WHERE jq.status='completed')::int AS completed,
      count(*) FILTER (WHERE jq.status='failed')::int AS failed,
      count(*) FILTER (WHERE jq.status IN ('pending','processing'))::int AS open
    FROM jq
    LEFT JOIN public.course_packages cp ON cp.id = jq.package_id
    GROUP BY jq.package_id, cp.title, cp.package_key
    ORDER BY count(*) FILTER (WHERE jq.status='failed') DESC, cp.title NULLS LAST
    LIMIT 100
  )
  SELECT jsonb_agg(to_jsonb(per_pkg)) INTO v_per_pkg FROM per_pkg;

  RETURN jsonb_build_object(
    'window_hours', p_window_hours,
    'generated_at', now(),
    'summary_by_type_status', coalesce(v_summary, '[]'::jsonb),
    'per_package', coalesce(v_per_pkg, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_post_publish_growth_fanout(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_post_publish_growth_fanout(integer) TO authenticated;

-- Admin RPC: recent auto_heal_log + job_queue entries for the 6 job_types, optionally filtered
CREATE OR REPLACE FUNCTION public.admin_get_post_publish_growth_log(
  p_package_id uuid DEFAULT NULL,
  p_job_type text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_logs jsonb;
  v_jobs jsonb;
  v_types text[] := ARRAY[
    'seo_indexnow_submit','package_post_publish_blog','package_distribution_plan',
    'package_campaign_assets_generate','package_email_sequence_enroll','package_og_image_generate'
  ];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(row_json ORDER BY created_at DESC) INTO v_logs FROM (
    SELECT
      l.id, l.action_type, l.result_status, l.trigger_source,
      l.target_id, l.metadata, l.created_at,
      to_jsonb(l) AS row_json
    FROM public.auto_heal_log l
    WHERE l.action_type LIKE 'post_publish_growth_worker:%'
      AND (p_package_id IS NULL OR l.target_id = p_package_id)
      AND (p_job_type IS NULL OR l.action_type = 'post_publish_growth_worker:'||p_job_type)
    ORDER BY l.created_at DESC
    LIMIT v_lim
  ) sub;

  SELECT jsonb_agg(row_json ORDER BY created_at DESC) INTO v_jobs FROM (
    SELECT
      j.id, j.job_type, j.status, j.created_at, j.completed_at,
      j.last_error, j.result, j.payload,
      to_jsonb(j) AS row_json
    FROM public.job_queue j
    WHERE j.job_type = ANY(v_types)
      AND (p_package_id IS NULL OR (j.payload->>'package_id')::uuid = p_package_id)
      AND (p_job_type IS NULL OR j.job_type = p_job_type)
    ORDER BY j.created_at DESC
    LIMIT v_lim
  ) sub;

  RETURN jsonb_build_object(
    'log_entries', coalesce(v_logs, '[]'::jsonb),
    'jobs', coalesce(v_jobs, '[]'::jsonb),
    'filter', jsonb_build_object('package_id', p_package_id, 'job_type', p_job_type, 'limit', v_lim)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_post_publish_growth_log(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_post_publish_growth_log(uuid, text, integer) TO authenticated;
