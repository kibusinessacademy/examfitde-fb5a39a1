-- ============================================================
-- Sprint: Audit reports infra + tests + continuation cap
-- ============================================================

-- ---------- A) Continuation-Loop Cap (Industriefachwirt #4) ----------
-- Track how many "continuation"-style enqueues a single (package_id, job_type) gets in a rolling 1h window
-- and refuse new ones above cap. Single choke-point on job_queue BEFORE INSERT.
CREATE OR REPLACE FUNCTION public.fn_guard_continuation_enqueue_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origin text;
  v_recent int;
  v_cap int := 6;            -- hard cap per (pkg, job_type) per hour
  v_window interval := '1 hour';
BEGIN
  -- Bypass during replication / replay
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;
  IF NEW.payload IS NULL THEN RETURN NEW; END IF;

  v_origin := COALESCE(
    NEW.payload->>'_origin',
    NEW.payload->>'enqueue_source',
    NEW.payload->>'mode'
  );

  -- only police explicit continuation/recovery enqueues
  IF v_origin IS NULL OR v_origin NOT ILIKE ANY (ARRAY[
    '%continuation%','%targeted_fill%','%blueprint_recovery%',
    '%competency_fill%','%pending_enqueue_per_row%','%auto_continuation%'
  ]) THEN
    RETURN NEW;
  END IF;

  IF NEW.package_id IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_recent
  FROM public.job_queue jq
  WHERE jq.package_id = NEW.package_id
    AND jq.job_type   = NEW.job_type
    AND jq.created_at > now() - v_window
    AND COALESCE(
      jq.payload->>'_origin',
      jq.payload->>'enqueue_source',
      jq.payload->>'mode'
    ) ILIKE ANY (ARRAY[
      '%continuation%','%targeted_fill%','%blueprint_recovery%',
      '%competency_fill%','%pending_enqueue_per_row%','%auto_continuation%'
    ]);

  IF v_recent >= v_cap THEN
    -- Audit (best effort) and refuse insert
    BEGIN
      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('continuation_cap_blocked', 'fn_guard_continuation_enqueue_cap',
              'package', NEW.package_id::text, 'blocked',
              format('cap=%s window=1h job_type=%s origin=%s', v_cap, NEW.job_type, v_origin),
              jsonb_build_object('package_id', NEW.package_id, 'job_type', NEW.job_type,
                                 'origin', v_origin, 'recent_count', v_recent, 'cap', v_cap));
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RAISE EXCEPTION
      'CONTINUATION_LOOP_CAP: % continuation enqueues for package=% job_type=% origin=% within 1h (cap=%). Investigate root cause before retrying.',
      v_recent, NEW.package_id, NEW.job_type, v_origin, v_cap
      USING HINT='Use admin_continuation_cap_override(true) for emergency bypass or increase cap deliberately.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_continuation_enqueue_cap ON public.job_queue;
CREATE TRIGGER trg_guard_continuation_enqueue_cap
BEFORE INSERT ON public.job_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_continuation_enqueue_cap();

-- ---------- B) Building-zombie watchdog: lower min-age to 30min (was 2h) ----------
-- Re-schedule cron with shorter age + run every 15min (keeps existing fn signature).
DO $$
BEGIN
  PERFORM cron.unschedule('building-zombie-watchdog-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- (re)create using existing fn with 1h min age, every 15 minutes
SELECT cron.schedule(
  'building-zombie-watchdog-15min',
  '*/15 * * * *',
  $$ SELECT public.fn_detect_and_heal_building_zombies(false, 1); $$
);

-- ---------- C) Audit Reports SSOT views + RPCs ----------
-- C1) Coupling audit: legacy auto_heal_log producers
CREATE OR REPLACE VIEW public.v_audit_coupling_legacy_producers AS
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  CASE
    WHEN lower(prosrc) ~ '\minto\M[^;]*auto_heal_log[^;]*\(\s*[^)]*\m(payload|details|action)\M' THEN 'legacy_columns'
    WHEN lower(prosrc) ~ 'auto_heal_log' AND lower(prosrc) !~ 'action_type' THEN 'missing_action_type'
    ELSE 'unknown'
  END AS issue,
  n.nspname AS schema_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND lower(p.prosrc) LIKE '%auto_heal_log%'
  AND (
    lower(p.prosrc) ~ '\minto\M[^;]*auto_heal_log[^;]*\(\s*[^)]*\m(payload|details|action)\M'
    OR (lower(p.prosrc) ~ 'auto_heal_log' AND lower(p.prosrc) !~ 'action_type')
  );

-- C2) Orphan jobs (no matching package)
CREATE OR REPLACE VIEW public.v_audit_orphan_jobs AS
SELECT jq.id AS job_id, jq.job_type, jq.status, jq.package_id, jq.created_at, jq.last_error
FROM public.job_queue jq
LEFT JOIN public.course_packages cp ON cp.id = jq.package_id
WHERE jq.package_id IS NOT NULL AND cp.id IS NULL;

-- C3) Orphan edge functions registered in supabase but never invoked anywhere
CREATE TABLE IF NOT EXISTS public.audit_orphan_functions_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  function_name text NOT NULL,
  ref_count int NOT NULL DEFAULT 0,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_audit_orphan_functions_snapshot_at ON public.audit_orphan_functions_snapshot(snapshot_at DESC);
ALTER TABLE public.audit_orphan_functions_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_read_orphan_funcs" ON public.audit_orphan_functions_snapshot;
CREATE POLICY "admin_read_orphan_funcs" ON public.audit_orphan_functions_snapshot
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- C4) Dead-column audit registry (populated by scripts/dead-column-audit.mjs)
CREATE TABLE IF NOT EXISTS public.audit_dead_columns_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  column_name text NOT NULL,
  ref_count_db int NOT NULL DEFAULT 0,
  ref_count_edge int NOT NULL DEFAULT 0,
  ref_count_ui int NOT NULL DEFAULT 0,
  safe_to_drop boolean GENERATED ALWAYS AS (ref_count_db = 0 AND ref_count_edge = 0 AND ref_count_ui = 0) STORED,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_audit_dead_cols_snapshot_at ON public.audit_dead_columns_snapshot(snapshot_at DESC);
ALTER TABLE public.audit_dead_columns_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_read_dead_cols" ON public.audit_dead_columns_snapshot;
CREATE POLICY "admin_read_dead_cols" ON public.audit_dead_columns_snapshot
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Hard-lock direct view access; expose via SECURITY DEFINER RPC
REVOKE ALL ON public.v_audit_coupling_legacy_producers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_audit_orphan_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_audit_coupling_legacy_producers TO service_role;
GRANT SELECT ON public.v_audit_orphan_jobs TO service_role;

-- C5) RPC: fetch all audit reports
CREATE OR REPLACE FUNCTION public.admin_get_audit_reports_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role text := auth.jwt() ->> 'role';
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR v_jwt_role = 'service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'coupling_legacy_producers', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.v_audit_coupling_legacy_producers t
    ),
    'orphan_jobs', (
      SELECT jsonb_build_object(
        'count', count(*),
        'sample', COALESCE(jsonb_agg(to_jsonb(t)) FILTER (WHERE rn <= 50), '[]'::jsonb)
      )
      FROM (
        SELECT v.*, row_number() OVER (ORDER BY created_at ASC) AS rn
        FROM public.v_audit_orphan_jobs v
      ) t
    ),
    'orphan_functions_latest', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.function_name), '[]'::jsonb)
      FROM (
        SELECT function_name, ref_count, notes, snapshot_at
        FROM public.audit_orphan_functions_snapshot
        WHERE snapshot_at = (SELECT max(snapshot_at) FROM public.audit_orphan_functions_snapshot)
      ) t
    ),
    'dead_columns_latest', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.table_name, t.column_name), '[]'::jsonb)
      FROM (
        SELECT table_name, column_name, ref_count_db, ref_count_edge, ref_count_ui, safe_to_drop, notes, snapshot_at
        FROM public.audit_dead_columns_snapshot
        WHERE snapshot_at = (SELECT max(snapshot_at) FROM public.audit_dead_columns_snapshot)
      ) t
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_audit_reports_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_audit_reports_summary() TO authenticated, service_role;

-- C6) RPC: write a snapshot row (used by CI / audit scripts)
CREATE OR REPLACE FUNCTION public.admin_record_orphan_function(
  p_function_name text, p_ref_count int, p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.audit_orphan_functions_snapshot(function_name, ref_count, notes)
  VALUES (p_function_name, p_ref_count, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_record_orphan_function(text,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_orphan_function(text,int,text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_record_dead_column(
  p_table text, p_column text, p_ref_db int, p_ref_edge int, p_ref_ui int, p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.audit_dead_columns_snapshot(table_name, column_name, ref_count_db, ref_count_edge, ref_count_ui, notes)
  VALUES (p_table, p_column, p_ref_db, p_ref_edge, p_ref_ui, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_record_dead_column(text,text,int,int,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_dead_column(text,text,int,int,int,text) TO service_role;

-- ---------- D) Self-test for trg_guard_auto_heal_log_schema ----------
CREATE OR REPLACE FUNCTION public.admin_test_auto_heal_log_schema_guard()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_caught boolean;
  v_msg text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Test 1: NULL action_type -> must raise
  v_caught := false; v_msg := NULL;
  BEGIN
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status) VALUES (NULL, 'system', 'ok');
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  v_results := v_results || jsonb_build_object('test','null_action_type','expected_error',true,'caught',v_caught,'msg',v_msg);

  -- Test 2: Empty action_type -> should also raise (defaults trigger fills target_type/result_status, but action_type is required)
  v_caught := false; v_msg := NULL;
  BEGIN
    INSERT INTO public.auto_heal_log(action_type, metadata) VALUES (NULL, jsonb_build_object('test',true));
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  v_results := v_results || jsonb_build_object('test','null_action_type_with_metadata','expected_error',true,'caught',v_caught,'msg',v_msg);

  -- Test 3: Canonical insert -> must succeed (and we clean it up)
  v_caught := false; v_msg := NULL;
  BEGIN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES ('guard_self_test_ok','admin_test_auto_heal_log_schema_guard','system','self_test','ok', jsonb_build_object('ts',now()));
    DELETE FROM public.auto_heal_log WHERE action_type='guard_self_test_ok' AND target_id='self_test';
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  v_results := v_results || jsonb_build_object('test','canonical_insert','expected_error',false,'caught',v_caught,'msg',v_msg);

  RETURN jsonb_build_object('ran_at', now(), 'results', v_results);
END; $$;
REVOKE ALL ON FUNCTION public.admin_test_auto_heal_log_schema_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_test_auto_heal_log_schema_guard() TO authenticated, service_role;

-- ---------- E) Continuation cap override (emergency bypass) ----------
CREATE OR REPLACE FUNCTION public.admin_continuation_cap_override(p_disable boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_disable THEN
    EXECUTE 'ALTER TABLE public.job_queue DISABLE TRIGGER trg_guard_continuation_enqueue_cap';
  ELSE
    EXECUTE 'ALTER TABLE public.job_queue ENABLE TRIGGER trg_guard_continuation_enqueue_cap';
  END IF;
  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('continuation_cap_override','admin_continuation_cap_override','system','trigger',
          CASE WHEN p_disable THEN 'disabled' ELSE 'enabled' END,
          jsonb_build_object('disabled', p_disable));
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.admin_continuation_cap_override(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_continuation_cap_override(boolean) TO authenticated;