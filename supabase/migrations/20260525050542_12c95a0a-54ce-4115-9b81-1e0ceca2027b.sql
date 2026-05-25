
-- IndexNow Diagnostics RPC + Pending Index
CREATE INDEX IF NOT EXISTS idx_seo_submission_logs_pending
  ON public.seo_submission_logs (provider, status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_seo_submission_logs_url
  ON public.seo_submission_logs (url, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_get_indexnow_status_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  WITH base AS (
    SELECT * FROM seo_submission_logs WHERE provider = 'indexnow'
  ),
  totals AS (
    SELECT
      COUNT(*) FILTER (WHERE status='pending') AS total_pending,
      COUNT(*) FILTER (WHERE status='failed')  AS total_failed,
      COUNT(*) FILTER (WHERE status='success') AS total_success,
      COUNT(*) FILTER (WHERE status='success' AND submitted_at > now() - interval '24 hours') AS success_24h,
      COUNT(*) FILTER (WHERE status='success' AND submitted_at > now() - interval '7 days')  AS success_7d,
      COUNT(*) FILTER (WHERE status='success' AND submitted_at > now() - interval '30 days') AS success_30d,
      MAX(submitted_at) FILTER (WHERE status='success') AS last_success_at,
      MIN(created_at) FILTER (WHERE status='pending') AS oldest_pending_at,
      EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status='pending')))/60.0 AS oldest_pending_minutes
    FROM base
  ),
  by_source AS (
    SELECT jsonb_agg(jsonb_build_object(
      'source_type', source_type,
      'status', status,
      'count', cnt,
      'last_at', last_at
    ) ORDER BY source_type, status) AS rows
    FROM (
      SELECT source_type, status, COUNT(*) AS cnt, MAX(COALESCE(submitted_at, updated_at, created_at)) AS last_at
      FROM base
      GROUP BY source_type, status
    ) s
  ),
  by_path AS (
    SELECT jsonb_agg(jsonb_build_object(
      'path_prefix', prefix,
      'success_count', success_count,
      'pending_count', pending_count,
      'failed_count', failed_count,
      'last_success_at', last_success_at
    ) ORDER BY prefix) AS rows
    FROM (
      SELECT
        CASE
          WHEN url ~ '^https?://[^/]+/blog/'   THEN '/blog'
          WHEN url ~ '^https?://[^/]+/berufe/' THEN '/berufe'
          WHEN url ~ '^https?://[^/]+/paket/'  THEN '/paket'
          WHEN url ~ '^https?://[^/]+/wissen/' THEN '/wissen'
          WHEN url ~ '^https?://[^/]+/pruefungstraining' THEN '/pruefungstraining'
          WHEN url ~ '^https?://[^/]+/(sitemap\.xml|$|index|home)?$' THEN '/static'
          ELSE 'other'
        END AS prefix,
        COUNT(*) FILTER (WHERE status='success') AS success_count,
        COUNT(*) FILTER (WHERE status='pending') AS pending_count,
        COUNT(*) FILTER (WHERE status='failed')  AS failed_count,
        MAX(submitted_at) FILTER (WHERE status='success') AS last_success_at
      FROM base
      GROUP BY 1
    ) s
  ),
  recent_failures AS (
    SELECT jsonb_agg(jsonb_build_object(
      'url', url,
      'http_status', http_status,
      'error', LEFT(COALESCE(error_message, ''), 200),
      'retry_count', retry_count,
      'updated_at', updated_at
    ) ORDER BY updated_at DESC) AS rows
    FROM (
      SELECT url, http_status, error_message, retry_count, updated_at
      FROM base
      WHERE status='failed'
      ORDER BY updated_at DESC
      LIMIT 20
    ) s
  ),
  oldest_pending AS (
    SELECT jsonb_agg(jsonb_build_object(
      'url', url,
      'source_type', source_type,
      'created_at', created_at,
      'retry_count', retry_count
    ) ORDER BY created_at ASC) AS rows
    FROM (
      SELECT url, source_type, created_at, retry_count
      FROM base
      WHERE status='pending'
      ORDER BY created_at ASC
      LIMIT 20
    ) s
  )
  SELECT jsonb_build_object(
    'totals', to_jsonb(t.*),
    'by_source', COALESCE(bs.rows, '[]'::jsonb),
    'by_path_prefix', COALESCE(bp.rows, '[]'::jsonb),
    'recent_failures', COALESCE(rf.rows, '[]'::jsonb),
    'oldest_pending', COALESCE(op.rows, '[]'::jsonb),
    'generated_at', now()
  )
  INTO _result
  FROM totals t
  CROSS JOIN by_source bs
  CROSS JOIN by_path bp
  CROSS JOIN recent_failures rf
  CROSS JOIN oldest_pending op;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_indexnow_status_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_indexnow_status_summary() TO authenticated;

COMMENT ON FUNCTION public.admin_get_indexnow_status_summary IS
'Admin-gated IndexNow KPI snapshot: totals, by_source, by_path_prefix, recent_failures, oldest_pending. Used by /admin/seo/indexnow dashboard.';
