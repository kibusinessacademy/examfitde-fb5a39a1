-- =========================================================================
-- Patch: ghost-completion healer (finished_at fix + producer-only invariant)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_heal_ghost_completions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row             record;
  v_healed          int := 0;
  v_blocked         int := 0;
  v_errors          int := 0;
  v_blocked_details jsonb := '[]'::jsonb;
  v_error_details   jsonb := '[]'::jsonb;
  v_has_producer    boolean;
  v_executed_flag   text;
BEGIN
  FOR v_row IN SELECT package_id, step_key FROM v_ghost_completion_candidates LIMIT 200
  LOOP
    BEGIN
      -- Producer-Invariante: prüfen, ob ein completed Job für diesen Step existiert
      SELECT EXISTS (
        SELECT 1
        FROM job_queue jq
        WHERE jq.package_id = v_row.package_id
          AND jq.status IN ('completed','done')
          AND jq.job_type IN (
            'package_' || v_row.step_key,                 -- e.g. package_validate_exam_pool
            'package_repair_exam_pool_quality'
          )
      ) INTO v_has_producer;

      v_executed_flag := CASE WHEN v_has_producer THEN 'true' ELSE 'false' END;

      UPDATE package_steps
         SET status = 'done',
             finished_at = COALESCE(finished_at, now()),
             updated_at = now(),
             meta = COALESCE(meta, '{}'::jsonb)
                     || jsonb_build_object(
                          'ok', 'true',
                          'executed', v_executed_flag,
                          'auto_healed', true,
                          'producer_evidence', v_has_producer,
                          'producer_evidence_note',
                            CASE WHEN v_has_producer
                                 THEN 'completed_producer_job_found'
                                 ELSE 'producer_evidence_missing'
                            END,
                          'ghost_healed_at', now(),
                          'healed_by', 'fn_heal_ghost_completions'
                        )
       WHERE package_id = v_row.package_id
         AND step_key = v_row.step_key
         AND status <> 'done';
      v_healed := v_healed + 1;
    EXCEPTION
      WHEN raise_exception OR check_violation OR integrity_constraint_violation THEN
        v_blocked := v_blocked + 1;
        v_blocked_details := v_blocked_details || jsonb_build_object(
          'package_id', v_row.package_id, 'step_key', v_row.step_key,
          'reason', SQLERRM);
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        v_error_details := v_error_details || jsonb_build_object(
          'package_id', v_row.package_id, 'step_key', v_row.step_key,
          'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'healed', v_healed,
    'blocked', v_blocked,
    'errors', v_errors,
    'blocked_details', v_blocked_details,
    'error_details', v_error_details,
    'ran_at', now()
  );
END;
$function$;

-- =========================================================================
-- Audit-RPC: liefert alle done-Schritte ohne meta.ok='true'
-- =========================================================================

CREATE OR REPLACE FUNCTION public.admin_validate_done_step_meta(p_limit int DEFAULT 200)
RETURNS TABLE (
  package_id   uuid,
  step_key     text,
  status       text,
  finished_at  timestamptz,
  meta_ok      text,
  meta_executed text,
  meta         jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ps.package_id,
         ps.step_key,
         ps.status::text,
         ps.finished_at,
         ps.meta->>'ok'        AS meta_ok,
         ps.meta->>'executed'  AS meta_executed,
         ps.meta
  FROM   public.package_steps ps
  WHERE  ps.status::text = 'done'
    AND  COALESCE(ps.meta->>'ok','false') <> 'true'
  ORDER  BY ps.finished_at DESC NULLS LAST
  LIMIT  GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.admin_validate_done_step_meta(int) TO authenticated;

-- =========================================================================
-- Audit-Tabelle: zusätzliche Indexe + Retention
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_sdma_source_fn
  ON public.step_done_meta_audit (source_fn, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sdma_step_key
  ON public.step_done_meta_audit (step_key, created_at DESC);

CREATE OR REPLACE FUNCTION public.prune_step_done_meta_audit(p_keep_days int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.step_done_meta_audit
  WHERE created_at < now() - make_interval(days => GREATEST(p_keep_days,1));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_step_done_meta_audit(int) TO authenticated;