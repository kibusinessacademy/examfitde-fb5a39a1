DROP FUNCTION IF EXISTS public.fn_drain_conflict_type_backfill();

CREATE OR REPLACE FUNCTION public.fn_drain_conflict_type_backfill()
RETURNS TABLE(
  should_continue boolean,
  remaining_nulls bigint,
  recent_runs integer,
  recent_processed bigint,
  recent_updated bigint,
  recent_errors bigint,
  recent_update_rate numeric,
  stop_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining bigint;
  v_runs integer := 0;
  v_processed bigint := 0;
  v_updated bigint := 0;
  v_errors bigint := 0;
  v_rate numeric := 0;
  v_stop text := NULL;
  v_continue boolean := true;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM exam_questions
  WHERE status = 'approved' AND conflict_type IS NULL;

  WITH recent AS (
    SELECT
      COALESCE((metadata->>'processed')::int, 0) AS processed,
      COALESCE((metadata->>'updated')::int, 0)   AS updated,
      COALESCE(
        (metadata->>'error_count')::int,
        jsonb_array_length(COALESCE(metadata->'errors','[]'::jsonb))
      ) AS error_count
    FROM auto_heal_log
    WHERE action_type = 'backfill_conflict_type'
      AND created_at > now() - interval '15 minutes'
    ORDER BY created_at DESC
    LIMIT 3
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(processed), 0),
    COALESCE(SUM(updated),   0),
    COALESCE(SUM(error_count), 0)
  INTO v_runs, v_processed, v_updated, v_errors
  FROM recent;

  IF v_processed > 0 THEN
    v_rate := ROUND(100.0 * v_updated / v_processed, 2);
  END IF;

  IF v_remaining = 0 THEN
    v_stop := 'drain_complete';
    v_continue := false;
  ELSIF v_runs >= 3 AND v_errors > 50 THEN
    v_stop := 'error_spike';
    v_continue := false;
  ELSIF v_runs >= 3 AND v_processed > 0 AND v_rate < 10 THEN
    v_stop := 'low_efficiency';
    v_continue := false;
  END IF;

  should_continue := v_continue;
  remaining_nulls := v_remaining;
  recent_runs := v_runs;
  recent_processed := v_processed;
  recent_updated := v_updated;
  recent_errors := v_errors;
  recent_update_rate := v_rate;
  stop_reason := v_stop;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_drain_conflict_type_backfill() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_drain_conflict_type_backfill() TO service_role;