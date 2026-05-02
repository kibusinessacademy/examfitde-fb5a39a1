-- ============================================================
-- Pattern X9 / X10 / X11 — Cancel-Loop Termination + Guards
-- ============================================================
-- X9: package_quality_council MAX_ATTEMPTS_EXHAUSTED loop (644 cancels/6h)
--     Root: step=done aber Atomic-Trigger/Coupling-Heal enqueuet weiter.
--     8 Pakete haben step=done, 20 step=failed, 17 step=queued.
-- X10: STEP_ALREADY_DONE_PHANTOM trotz X7-Fix (34 cancels/6h)
--     Root: Race zwischen Step-Transition done und atomic-trigger insert.
-- X11: OBSOLETE_TAIL_BLOCK_v4 Mass-Cancel (399 integrity_check, 710 quality_council)
--     Root: drift-detector cancelt, atomic-trigger enqueuet sofort wieder.

-- ============================================================
-- BULK HEAL X9: Pakete mit step=done aber laufenden quality_council jobs
-- ============================================================
DO $$
DECLARE v_cancelled int := 0;
BEGIN
  -- 1. Cancel alle pending/failed quality_council jobs für Pakete deren step=done/skipped
  WITH pkgs_done AS (
    SELECT DISTINCT package_id
    FROM package_steps
    WHERE step_key='quality_council' AND status IN ('done','skipped')
  ),
  cancel AS (
    UPDATE job_queue jq
    SET status='cancelled',
        last_error_code='PATTERN_X9_STEP_ALREADY_DONE',
        last_error='Pattern X9 heal: package_steps.quality_council=done — phantom job cancelled.',
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
          'cancel_reason','PATTERN_X9_HEAL: step finalized, job obsolete',
          'cancelled_at', now()
        ),
        updated_at = now()
    WHERE jq.job_type='package_quality_council'
      AND jq.status IN ('pending','queued','failed','batch_pending')
      AND jq.package_id IN (SELECT package_id FROM pkgs_done)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_cancelled FROM cancel;

  INSERT INTO auto_heal_log(action_type, trigger_source, result_status, result_detail, target_type)
  VALUES ('pattern_x9_quality_council_phantom_heal','manual_bypass','done',
          jsonb_build_object('cancelled_jobs', v_cancelled)::text, 'system');
END $$;

-- ============================================================
-- BULK HEAL X9b: Steps in status=failed → reset auf queued
-- (für jene 20 Pakete mit step=failed, damit DAG weiterläuft)
-- ============================================================
DO $$
DECLARE v_reset int := 0;
BEGIN
  WITH reset AS (
    UPDATE package_steps
    SET status='queued',
        last_error=NULL,
        meta = COALESCE(meta,'{}'::jsonb)
              - 'last_atomic_enqueue_at'
              || jsonb_build_object('pattern_x9_reset_at', now()),
        updated_at=now()
    WHERE step_key='quality_council'
      AND status='failed'
      AND package_id IN (
        SELECT DISTINCT package_id FROM job_queue
        WHERE job_type='package_quality_council'
          AND last_error_code='MAX_ATTEMPTS_EXHAUSTED'
          AND updated_at > now() - interval '12 hours'
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_reset FROM reset;

  -- Cancel die alten loop-jobs (failed mit MAX_ATTEMPTS_EXHAUSTED)
  UPDATE job_queue
  SET status='cancelled',
      last_error_code='PATTERN_X9_LOOP_TERMINATED',
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'cancel_reason','PATTERN_X9_HEAL: max_attempts loop terminated, step reset queued'
      ),
      updated_at=now()
  WHERE job_type='package_quality_council'
    AND last_error_code='MAX_ATTEMPTS_EXHAUSTED'
    AND status IN ('pending','failed')
    AND updated_at > now() - interval '12 hours';

  INSERT INTO auto_heal_log(action_type, trigger_source, result_status, result_detail, target_type)
  VALUES ('pattern_x9_step_reset','manual_bypass','done',
          jsonb_build_object('steps_reset', v_reset)::text, 'system');
END $$;

-- ============================================================
-- SYSTEMISCHER FIX X9/X10: Pre-Insert Guard im Atomic-Trigger
-- Verhindert Re-Enqueue wenn step in den letzten 60s done/skipped wurde
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_atomic_enqueue_on_step_queued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_job_type text;
  v_existing_active int;
  v_recent_done int;
  v_is_applicable boolean;
BEGIN
  -- Only fire on transition INTO queued
  IF NOT (NEW.status = 'queued'::step_status AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'queued'::step_status)) THEN
    RETURN NEW;
  END IF;

  -- Anti-thrash: skip wenn last_atomic_enqueue < 30s
  IF NEW.meta ? 'last_atomic_enqueue_at'
     AND (NEW.meta->>'last_atomic_enqueue_at')::timestamptz > now() - interval '30 seconds' THEN
    RETURN NEW;
  END IF;

  -- X10 GUARD: Wurde derselbe Step in den letzten 5 min schon mal als done/skipped abgeschlossen?
  -- → Phantom-Re-Enqueue verhindern (Race-Window absichern).
  SELECT COUNT(*) INTO v_recent_done
  FROM auto_heal_log
  WHERE action_type IN ('step_finalized_done','step_finalized_skipped')
    AND target_id = NEW.id::text
    AND created_at > now() - interval '5 minutes';
  IF v_recent_done > 0 THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id)
    VALUES ('pattern_x10_phantom_atomic_blocked','trg_atomic_enqueue_on_step_queued','blocked',
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key,
                               'reason','step recently finalized → phantom re-enqueue blocked')::text,
            'package_step', NEW.id::text);
    RETURN NEW;
  END IF;

  -- Track-Applicability (X7-Logik)
  v_is_applicable := public.fn_is_step_applicable_for_package(NEW.package_id, NEW.step_key);
  IF v_is_applicable IS FALSE THEN
    NEW.status := 'skipped'::step_status;
    NEW.meta := COALESCE(NEW.meta,'{}'::jsonb) || jsonb_build_object(
      'skipped_reason','TRACK_NOT_APPLICABLE',
      'pattern_x7_auto_skip_at', now()
    );
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id)
    VALUES ('pattern_x7_auto_reskip','trg_atomic_enqueue_on_step_queued','done',
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key)::text,
            'package_step', NEW.id::text);
    RETURN NEW;
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id=NEW.package_id;
  v_job_type := 'package_'||NEW.step_key::text;

  SELECT COUNT(*) INTO v_existing_active FROM job_queue
  WHERE package_id=NEW.package_id AND job_type=v_job_type
    AND status IN ('pending','queued','processing','running','batch_pending');
  IF v_existing_active > 0 THEN RETURN NEW; END IF;

  INSERT INTO job_queue(job_type,payload,status,max_attempts,priority,package_id,meta)
  VALUES(v_job_type,
    jsonb_build_object('package_id',NEW.package_id,'curriculum_id',v_curriculum_id,'enqueue_source','trg_atomic_enqueue'),
    'pending',8,50,NEW.package_id,
    jsonb_build_object('source','atomic_step_enqueue','enqueue_source','trg_atomic_enqueue','enqueued_at',now())
  );

  NEW.meta := COALESCE(NEW.meta,'{}'::jsonb) || jsonb_build_object('last_atomic_enqueue_at',now());
  RETURN NEW;
END $$;

-- ============================================================
-- BULK HEAL X11: Stoppe drift-detector OBSOLETE_TAIL_BLOCK Cancel-Bursts
-- für Pakete deren upstream-step (run_integrity_check) noch nicht done ist
-- ============================================================
DO $$
DECLARE v_terminated int := 0;
BEGIN
  -- Pause: setze Cooldown-Flag für Pakete mit ≥10 OBSOLETE_TAIL_BLOCK in 1h
  WITH loopers AS (
    SELECT package_id, COUNT(*) AS cnt
    FROM job_queue
    WHERE meta->>'cancel_reason' ILIKE '%OBSOLETE_TAIL_BLOCK%'
      AND updated_at > now() - interval '1 hour'
    GROUP BY package_id
    HAVING COUNT(*) >= 10
  ),
  -- Cancel pending tail-jobs (integrity/quality/auto_publish) der Looper
  cancel AS (
    UPDATE job_queue jq
    SET status='cancelled',
        last_error_code='PATTERN_X11_DRIFT_LOOP_TERMINATED',
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
          'cancel_reason','PATTERN_X11_HEAL: drift-cancel-loop terminated, awaiting predecessor',
          'cancelled_at', now()
        ),
        updated_at = now()
    WHERE jq.package_id IN (SELECT package_id FROM loopers)
      AND jq.job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish')
      AND jq.status IN ('pending','queued','batch_pending')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_terminated FROM cancel;

  INSERT INTO auto_heal_log(action_type, trigger_source, result_status, result_detail, target_type)
  VALUES ('pattern_x11_drift_loop_termination','manual_bypass','done',
          jsonb_build_object('cancelled_jobs', v_terminated)::text, 'system');
END $$;

-- ============================================================
-- SYSTEMISCHER FIX X11: Drift-Detector Cooldown
-- Verhindert OBSOLETE_TAIL_BLOCK auf Pakete die in 1h schon ≥10x betroffen waren.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_drift_cancel_cooldown_check(
  p_package_id uuid,
  p_job_type text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM job_queue
    WHERE package_id = p_package_id
      AND job_type = p_job_type
      AND meta->>'cancel_reason' ILIKE '%OBSOLETE_TAIL_BLOCK%'
      AND updated_at > now() - interval '30 minutes'
    HAVING COUNT(*) >= 5
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_drift_cancel_cooldown_check(uuid,text) TO service_role, authenticated;

COMMENT ON FUNCTION public.fn_drift_cancel_cooldown_check IS
'Pattern X11 Cooldown: Returns false wenn ≥5 OBSOLETE_TAIL_BLOCK in 30min für (pkg,job_type). Drift-Detector MUSS das prüfen vor Cancel.';