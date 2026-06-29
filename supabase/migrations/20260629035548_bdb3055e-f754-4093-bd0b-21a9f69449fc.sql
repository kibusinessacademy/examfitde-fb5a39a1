
CREATE OR REPLACE FUNCTION public.fn_autoskip_repair_on_upstream_ok()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool_ok boolean;
BEGIN
  IF NEW.step_key <> 'generate_exam_pool' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done'::step_status THEN RETURN NEW; END IF;
  IF OLD.status = 'done'::step_status THEN RETURN NEW; END IF;

  v_pool_ok := COALESCE(
    (NEW.meta->'pool_quality'->>'ok')::boolean,
    (NEW.meta->>'ok')::boolean,
    false
  );
  IF NOT v_pool_ok THEN RETURN NEW; END IF;

  WITH skipped AS (
    UPDATE package_steps ps
       SET status = 'skipped'::step_status,
           finished_at = now(),
           updated_at  = now(),
           last_error  = NULL,
           meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
             'skip_reason', 'upstream_ok_no_repair_needed',
             'autoskip_source', 'fn_autoskip_repair_on_upstream_ok',
             'autoskip_at', now(),
             'upstream_step_id', NEW.id
           )
     WHERE ps.package_id = NEW.package_id
       AND ps.step_key   = 'repair_exam_pool_quality'
       AND ps.status     = 'queued'::step_status
       AND ps.attempts   = 0
       AND ps.job_id     IS NULL
    RETURNING ps.id, ps.package_id
  )
  INSERT INTO public.auto_heal_log (
    action_type, target_id, target_type, trigger_source,
    result_status, input_params, metadata
  )
  SELECT 'upstream_done_autoskip_conditional',
         s.id::text,
         'package_step',
         'trigger',
         'success',
         jsonb_build_object(
           'package_id', s.package_id,
           'step_key', 'repair_exam_pool_quality',
           'upstream_step_id', NEW.id
         ),
         jsonb_build_object(
           'reason', 'upstream_ok_no_repair_needed',
           'cut', 'UPSTREAM.DONE.AUTOSKIP.CONDITIONAL.1'
         )
  FROM skipped s;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autoskip_repair_on_upstream_ok ON public.package_steps;
CREATE TRIGGER trg_autoskip_repair_on_upstream_ok
AFTER UPDATE OF status ON public.package_steps
FOR EACH ROW
WHEN (NEW.step_key = 'generate_exam_pool' AND NEW.status = 'done'::step_status)
EXECUTE FUNCTION public.fn_autoskip_repair_on_upstream_ok();

-- One-shot backfill: only the confirmed phantoms (upstream done + ok + attempts=0 + no job_id)
DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT ps.id, ps.package_id, up.id AS upstream_id
    FROM package_steps ps
    JOIN package_steps up
      ON up.package_id = ps.package_id
     AND up.step_key   = 'generate_exam_pool'
    WHERE ps.step_key  = 'repair_exam_pool_quality'
      AND ps.status    = 'queued'::step_status
      AND ps.attempts  = 0
      AND ps.job_id    IS NULL
      AND up.status    = 'done'::step_status
      AND COALESCE(
            (up.meta->'pool_quality'->>'ok')::boolean,
            (up.meta->>'ok')::boolean,
            false
          ) = true
  LOOP
    UPDATE package_steps
       SET status = 'skipped'::step_status,
           finished_at = now(),
           updated_at  = now(),
           last_error  = NULL,
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'skip_reason', 'upstream_ok_no_repair_needed',
             'autoskip_source', 'backfill_cut_b',
             'autoskip_at', now(),
             'upstream_step_id', r.upstream_id
           )
     WHERE id = r.id;

    INSERT INTO public.auto_heal_log (
      action_type, target_id, target_type, trigger_source,
      result_status, input_params, metadata
    ) VALUES (
      'upstream_done_autoskip_conditional',
      r.id::text,
      'package_step',
      'backfill',
      'success',
      jsonb_build_object(
        'package_id', r.package_id,
        'step_key', 'repair_exam_pool_quality',
        'upstream_step_id', r.upstream_id
      ),
      jsonb_build_object(
        'reason', 'upstream_ok_no_repair_needed',
        'source', 'backfill',
        'cut', 'UPSTREAM.DONE.AUTOSKIP.CONDITIONAL.1'
      )
    );

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Cut B backfill: % phantom repair steps auto-skipped', v_count;
END $$;
