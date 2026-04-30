-- ============================================================
-- FIX 1: NO_PROGRESS_TERMINAL — Repair-Loop endgültig beenden
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_check_repair_no_progress_and_block(
  p_package_id uuid,
  p_step_key text DEFAULT 'repair_exam_pool_quality',
  p_action_type text DEFAULT 'repair_exam_pool_quality',
  p_window interval DEFAULT '4 hours'::interval,
  p_min_runs int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_runs int;
  v_no_progress int;
BEGIN
  -- Count last N runs for this package + step
  SELECT COUNT(*),
    COUNT(*) FILTER (
      WHERE COALESCE((metadata->>'promoted_to_approved')::int,0) = 0
        AND COALESCE((metadata->>'difficulty_rebalanced')::int,0) = 0
        AND COALESCE((metadata->>'traps_tagged')::int,0) = 0
        AND COALESCE((metadata->>'bloom_repaired')::int,0) = 0
        AND COALESCE((metadata->>'qc_reconciled')::int,0) = 0
    )
  INTO v_runs, v_no_progress
  FROM (
    SELECT metadata FROM auto_heal_log
    WHERE action_type = p_action_type
      AND target_id = p_package_id::text
      AND created_at > now() - p_window
    ORDER BY created_at DESC
    LIMIT p_min_runs
  ) t;

  IF v_runs >= p_min_runs AND v_no_progress = v_runs THEN
    -- Terminal block
    UPDATE package_steps
    SET status = 'blocked'::step_status,
        last_error = 'NO_PROGRESS_TERMINAL: ' || v_runs || ' consecutive runs with zero progress',
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'no_progress_terminal', true,
          'runs_evaluated', v_runs,
          'detected_at', now()
        )
    WHERE package_id = p_package_id AND step_key = p_step_key
      AND status::text NOT IN ('blocked','done','skipped');

    UPDATE course_packages
    SET blocked_reason = COALESCE(blocked_reason,'') || ' | NO_PROGRESS_TERMINAL@' || p_step_key
    WHERE id = p_package_id AND COALESCE(blocked_reason,'') NOT ILIKE '%NO_PROGRESS_TERMINAL@'||p_step_key||'%';

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES ('no_progress_terminal_block','fn_check_repair_no_progress_and_block','course_package', p_package_id::text,
      'blocked', jsonb_build_object('step_key',p_step_key,'runs',v_runs,'no_progress',v_no_progress));

    RETURN jsonb_build_object('blocked',true,'runs',v_runs,'no_progress',v_no_progress);
  END IF;

  RETURN jsonb_build_object('blocked',false,'runs',v_runs,'no_progress',v_no_progress);
END $$;

-- Trigger: nach jedem 'repair_exam_pool_quality' Audit-Insert prüfen
CREATE OR REPLACE FUNCTION public.trg_after_repair_audit_check_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pkg uuid;
BEGIN
  IF NEW.action_type <> 'repair_exam_pool_quality' THEN RETURN NEW; END IF;
  IF NEW.result_status NOT IN ('blocked_no_effect','success') THEN RETURN NEW; END IF;
  BEGIN
    v_pkg := (NEW.metadata->>'package_id')::uuid;
  EXCEPTION WHEN OTHERS THEN RETURN NEW; END;
  IF v_pkg IS NULL THEN RETURN NEW; END IF;
  PERFORM public.fn_check_repair_no_progress_and_block(v_pkg);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_after_repair_audit_check_progress ON public.auto_heal_log;
CREATE TRIGGER trg_after_repair_audit_check_progress
AFTER INSERT ON public.auto_heal_log
FOR EACH ROW
WHEN (NEW.action_type = 'repair_exam_pool_quality')
EXECUTE FUNCTION public.trg_after_repair_audit_check_progress();

-- ============================================================
-- FIX 2: DAG-Guard mit Signature-Memory
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_guard_dag_prerequisites()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_step_key text;
  v_missing text;
  v_signature text;
  v_recent_blocks int;
  v_loop_threshold int := 50;
  v_loop_window interval := '1 hour';
BEGIN
  IF NEW.status NOT IN ('pending', 'queued') THEN RETURN NEW; END IF;
  IF (NEW.meta->>'dag_bypass')::boolean IS TRUE THEN RETURN NEW; END IF;
  IF NEW.job_type NOT LIKE 'package_%' THEN RETURN NEW; END IF;
  v_step_key := substring(NEW.job_type FROM 9);

  SELECT string_agg(dag.depends_on, ', ' ORDER BY dag.depends_on)
  INTO v_missing
  FROM step_dag_edges dag
  JOIN package_steps dep ON dep.package_id = NEW.package_id AND dep.step_key = dag.depends_on
  WHERE dag.step_key = v_step_key AND dep.status NOT IN ('done','skipped');

  IF v_missing IS NULL THEN RETURN NEW; END IF;

  -- Signature
  v_signature := encode(digest(NEW.package_id::text || ':' || v_step_key || ':' || v_missing, 'sha256'),'hex');

  -- Count same signature in window
  SELECT COUNT(*) INTO v_recent_blocks
  FROM auto_heal_log
  WHERE action_type = 'dag_guard_block'
    AND target_id = NEW.package_id::text
    AND metadata->>'signature' = v_signature
    AND created_at > now() - v_loop_window;

  IF v_recent_blocks >= v_loop_threshold THEN
    -- LOOP DETECTED — terminal block on the step itself
    UPDATE package_steps
    SET status = 'blocked'::step_status,
        last_error = 'DAG_GUARD_LOOP_DETECTED: ' || v_recent_blocks || ' identical blocks for missing deps [' || v_missing || ']',
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'dag_guard_loop_detected', true,
          'block_signature', v_signature,
          'missing_deps', v_missing,
          'recent_blocks', v_recent_blocks,
          'detected_at', now()
        )
    WHERE package_id = NEW.package_id AND step_key = v_step_key
      AND status::text NOT IN ('blocked','done','skipped');

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES ('dag_guard_loop_detected','trg_guard_dag_prerequisites','course_package', NEW.package_id::text,
      'blocked', jsonb_build_object('step_key',v_step_key,'missing_deps',v_missing,
        'signature',v_signature,'recent_blocks',v_recent_blocks));
    RETURN NULL;
  END IF;

  -- Normal block — but log signature for memory
  INSERT INTO auto_heal_log (
    action_type, trigger_source, target_type, target_id,
    result_status, result_detail, metadata
  ) VALUES (
    'dag_guard_block', 'trg_guard_dag_prerequisites', 'job',
    COALESCE(NEW.package_id::text, 'unknown'),
    'blocked',
    'Blocked ' || NEW.job_type || ': unmet deps = ' || v_missing,
    jsonb_build_object(
      'job_type', NEW.job_type, 'package_id', NEW.package_id,
      'missing_deps', v_missing, 'signature', v_signature,
      'recent_blocks_in_hour', v_recent_blocks
    )
  );
  RETURN NULL;
END $$;

-- Index für Signature-Lookup (das ist hot-path bei jedem Job-Insert)
CREATE INDEX IF NOT EXISTS idx_auto_heal_log_dag_signature
ON public.auto_heal_log ((metadata->>'signature'), created_at)
WHERE action_type = 'dag_guard_block';

-- ============================================================
-- FIX 3: system_intents — leichter Routing-Layer für Crons
-- ============================================================
CREATE TABLE IF NOT EXISTS public.system_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_type text NOT NULL,
  package_id uuid,
  priority int NOT NULL DEFAULT 100,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature text NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  consumed_at timestamptz,
  result jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_intents_open_signature
ON public.system_intents (signature)
WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_system_intents_pending
ON public.system_intents (priority DESC, created_at ASC)
WHERE claimed_at IS NULL AND consumed_at IS NULL;

ALTER TABLE public.system_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_system_intents" ON public.system_intents;
CREATE POLICY "service_role_full_access_system_intents"
ON public.system_intents AS PERMISSIVE FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Idempotent recorder for crons
CREATE OR REPLACE FUNCTION public.system_intent_record(
  p_intent_type text,
  p_package_id uuid DEFAULT NULL,
  p_priority int DEFAULT 100,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sig text; v_id uuid;
BEGIN
  v_sig := encode(digest(p_intent_type || ':' || COALESCE(p_package_id::text,'-') || ':' || p_payload::text,'sha256'),'hex');
  INSERT INTO system_intents(intent_type, package_id, priority, payload, signature, source)
  VALUES (p_intent_type, p_package_id, p_priority, p_payload, v_sig, p_source)
  ON CONFLICT (signature) WHERE consumed_at IS NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('recorded', v_id IS NOT NULL, 'id', v_id, 'signature', v_sig);
END $$;

-- Worker claim (atomic)
CREATE OR REPLACE FUNCTION public.system_intent_claim_next(
  p_worker_id text,
  p_intent_types text[] DEFAULT NULL
) RETURNS public.system_intents
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row public.system_intents;
BEGIN
  WITH next_intent AS (
    SELECT id FROM system_intents
    WHERE claimed_at IS NULL AND consumed_at IS NULL
      AND (p_intent_types IS NULL OR intent_type = ANY(p_intent_types))
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE system_intents si
  SET claimed_at = now(), claimed_by = p_worker_id
  FROM next_intent ni
  WHERE si.id = ni.id
  RETURNING si.* INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.system_intent_complete(
  p_intent_id uuid, p_result jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE system_intents SET consumed_at = now(), result = p_result WHERE id = p_intent_id;
END $$;

GRANT EXECUTE ON FUNCTION public.system_intent_record(text,uuid,int,jsonb,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.system_intent_claim_next(text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.system_intent_complete(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_repair_no_progress_and_block(uuid,text,text,interval,int) TO authenticated, service_role;