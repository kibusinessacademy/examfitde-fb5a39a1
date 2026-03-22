DROP FUNCTION IF EXISTS public.heal_true_stall_steps(integer);

CREATE OR REPLACE FUNCTION public.heal_true_stall_steps(p_max_heal integer DEFAULT 10)
RETURNS TABLE(package_id uuid, step_key text, healed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT d.package_id, d.step_key, d.drift_signal, d.updated_at
    FROM ops_pipeline_step_drift d
    WHERE d.drift_signal = 'TRUE_STALL'
      AND d.updated_at < now() - interval '15 minutes'
    ORDER BY d.updated_at ASC
    LIMIT p_max_heal
  LOOP
    UPDATE package_steps ps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        updated_at = NOW(),
        meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
          'healed_true_stall', true,
          'healed_at', NOW()::text,
          'heal_reason', 'auto_heal_true_stall'
        )
    WHERE ps.package_id = r.package_id
      AND ps.step_key = r.step_key;

    package_id := r.package_id;
    step_key := r.step_key;
    healed := true;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$