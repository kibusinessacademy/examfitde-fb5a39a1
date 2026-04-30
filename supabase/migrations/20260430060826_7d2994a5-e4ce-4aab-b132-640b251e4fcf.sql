-- v_admin_exam_pool_drift_log: 7-Tage-Log der Drift-Detection-Läufe
-- Eine Zeile pro Lauf, mit KPIs aus metadata.summary + JSON-Detail
CREATE OR REPLACE VIEW public.v_admin_exam_pool_drift_log AS
SELECT
  l.id AS run_id,
  l.created_at AS run_at,
  l.result_status,
  COALESCE((l.metadata->'summary'->>'total_candidates')::int, 0) AS total_candidates,
  COALESCE((l.metadata->'summary'->>'healed')::int, 0) AS healed,
  COALESCE((l.metadata->'summary'->>'nudged')::int, 0) AS nudged,
  COALESCE((l.metadata->'summary'->>'skipped')::int, 0) AS skipped,
  COALESCE((l.metadata->'summary'->>'cooldown_skips')::int, 0) AS cooldown_skips,
  COALESCE((l.metadata->'summary'->>'update_failed')::int, 0) AS update_failed,
  COALESCE((l.metadata->'summary'->>'already_done_or_running')::int, 0) AS already_done_or_running,
  COALESCE((l.metadata->'summary'->>'dry_run')::boolean, false) AS dry_run,
  COALESCE((l.metadata->>'cooldown_minutes')::int, 30) AS cooldown_minutes,
  COALESCE((l.metadata->>'max_per_run')::int, 25) AS max_per_run,
  l.metadata->'candidates' AS candidates_json,
  l.metadata->'summary'->'nudged_ids' AS nudged_ids,
  l.metadata->'summary'->'healed_ids' AS healed_ids,
  l.metadata->'skip_details' AS skip_details_json,
  l.duration_ms
FROM public.auto_heal_log l
WHERE l.action_type = 'exam_pool_drift_detection'
  AND l.created_at > NOW() - INTERVAL '7 days'
ORDER BY l.created_at DESC;

GRANT SELECT ON public.v_admin_exam_pool_drift_log TO authenticated;

-- Per-Paket Drilldown RPC (admin-only)
CREATE OR REPLACE FUNCTION public.get_exam_pool_drift_log_for_package(p_package_id uuid)
RETURNS TABLE (
  run_at timestamptz,
  result_status text,
  was_candidate boolean,
  was_nudged boolean,
  was_healed boolean,
  was_skipped boolean,
  skip_reason text,
  approved_q int,
  in_cooldown boolean,
  step_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      l.created_at,
      l.result_status,
      l.metadata
    FROM public.auto_heal_log l
    WHERE l.action_type = 'exam_pool_drift_detection'
      AND l.created_at > NOW() - INTERVAL '7 days'
      AND (l.metadata->'candidates') @> jsonb_build_array(jsonb_build_object('package_id', p_package_id::text))
  )
  SELECT
    b.created_at AS run_at,
    b.result_status,
    true AS was_candidate,
    (b.metadata->'summary'->'nudged_ids') ? p_package_id::text AS was_nudged,
    (b.metadata->'summary'->'healed_ids') ? p_package_id::text AS was_healed,
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(b.metadata->'skip_details','[]'::jsonb)) sd
      WHERE sd->>'package_id' = p_package_id::text
    ) AS was_skipped,
    (
      SELECT sd->>'reason'
      FROM jsonb_array_elements(COALESCE(b.metadata->'skip_details','[]'::jsonb)) sd
      WHERE sd->>'package_id' = p_package_id::text
      LIMIT 1
    ) AS skip_reason,
    (
      SELECT (c->>'approved_q')::int
      FROM jsonb_array_elements(COALESCE(b.metadata->'candidates','[]'::jsonb)) c
      WHERE c->>'package_id' = p_package_id::text
      LIMIT 1
    ) AS approved_q,
    (
      SELECT (c->>'in_cooldown')::boolean
      FROM jsonb_array_elements(COALESCE(b.metadata->'candidates','[]'::jsonb)) c
      WHERE c->>'package_id' = p_package_id::text
      LIMIT 1
    ) AS in_cooldown,
    (
      SELECT c->>'step_status'
      FROM jsonb_array_elements(COALESCE(b.metadata->'candidates','[]'::jsonb)) c
      WHERE c->>'package_id' = p_package_id::text
      LIMIT 1
    ) AS step_status
  FROM base b
  ORDER BY b.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_exam_pool_drift_log_for_package(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_pool_drift_log_for_package(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';