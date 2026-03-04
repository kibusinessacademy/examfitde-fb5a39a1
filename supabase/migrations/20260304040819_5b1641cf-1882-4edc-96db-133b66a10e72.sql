
BEGIN;

-- ═══════════════════════════════════════════════════
-- 1) DDL Audit Log for auto-heal actions
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ops_ddl_audit (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ops_ddl_audit ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════
-- 2) Extend expected_trigger_bindings for deterministic rebind
-- ═══════════════════════════════════════════════════
ALTER TABLE public.expected_trigger_bindings
  ADD COLUMN IF NOT EXISTS trigger_timing text NOT NULL DEFAULT 'BEFORE',
  ADD COLUMN IF NOT EXISTS trigger_events text[] NOT NULL DEFAULT '{UPDATE}',
  ADD COLUMN IF NOT EXISTS function_schema text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS function_name text,
  ADD COLUMN IF NOT EXISTS for_each text NOT NULL DEFAULT 'ROW',
  ADD COLUMN IF NOT EXISTS enabled_auto_rebind boolean NOT NULL DEFAULT true;

-- ═══════════════════════════════════════════════════
-- 3) Backfill exact metadata from live pg_trigger
-- ═══════════════════════════════════════════════════

-- course_packages triggers
UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{UPDATE}', function_name='guard_publish_requires_questions'
WHERE expected_trigger='guard_publish_requires_questions';

UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{UPDATE}', function_name='guard_publish_requires_real_content'
WHERE expected_trigger='guard_publish_requires_real_content';

UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{INSERT,UPDATE}', function_name='guard_building_published_drift'
WHERE expected_trigger='trg_guard_building_published_drift';

UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{UPDATE}', function_name='guard_building_requires_enrichment'
WHERE expected_trigger='trg_guard_building_requires_enrichment';

UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{UPDATE}', function_name='guard_published_package_immutable'
WHERE expected_trigger='trg_guard_published_immutable';

UPDATE public.expected_trigger_bindings SET
  trigger_timing='AFTER', trigger_events='{UPDATE}', function_name='sync_course_status_on_package_change'
WHERE expected_trigger='trg_sync_course_status_on_package';

-- curricula
UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{UPDATE}', function_name='curriculum_freeze_guard'
WHERE expected_trigger='trg_curriculum_freeze_guard';

-- exam_questions
UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{INSERT,UPDATE}', function_name='trg_exam_questions_enforce_learning_field_id'
WHERE expected_trigger='trg_exam_questions_enforce_learning_field_id';

-- package_steps
UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{UPDATE}', function_name='guard_step_failed_requires_reason'
WHERE expected_trigger='trg_guard_step_failed_requires_reason';

UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{INSERT,UPDATE}', function_name='package_steps_sort_order_guard'
WHERE expected_trigger='trg_package_steps_sort_order_guard';

-- question_blueprints
UPDATE public.expected_trigger_bindings SET
  trigger_timing='BEFORE', trigger_events='{UPDATE}', function_name='blueprint_approval_guard'
WHERE expected_trigger='trg_blueprint_approval_guard';

-- ═══════════════════════════════════════════════════
-- 4) RPC: auto_rebind_missing_triggers (SECURITY DEFINER)
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.auto_rebind_missing_triggers(dry_run boolean DEFAULT true)
RETURNS TABLE (
  attempted int,
  rebound int,
  skipped int,
  actions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_actions jsonb := '[]'::jsonb;
  v_attempted int := 0;
  v_rebound int := 0;
  v_skipped int := 0;
  v_exists_fn boolean;
  v_sql text;
  v_events text;
  v_action_entry jsonb;
BEGIN
  FOR r IN
    SELECT e.*
    FROM public.expected_trigger_bindings e
    WHERE e.enabled = true
      AND e.enabled_auto_rebind = true
      AND e.function_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname = e.expected_trigger
          AND n.nspname = e.expected_schema
          AND c.relname = e.expected_table
          AND NOT t.tgisinternal
      )
  LOOP
    v_attempted := v_attempted + 1;

    -- Check function exists
    SELECT EXISTS(
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
      WHERE pn.nspname = r.function_schema
        AND p.proname  = r.function_name
    ) INTO v_exists_fn;

    IF NOT v_exists_fn THEN
      v_skipped := v_skipped + 1;
      v_action_entry := jsonb_build_object(
        'trigger', r.expected_trigger,
        'table', r.expected_schema || '.' || r.expected_table,
        'status', 'skipped_function_missing',
        'function', r.function_schema || '.' || r.function_name
      );
      v_actions := v_actions || jsonb_build_array(v_action_entry);
      CONTINUE;
    END IF;

    -- Build deterministic CREATE TRIGGER DDL
    v_events := array_to_string(r.trigger_events, ' OR ');

    v_sql :=
      'CREATE TRIGGER ' || quote_ident(r.expected_trigger) ||
      ' ' || r.trigger_timing || ' ' || v_events ||
      ' ON ' || quote_ident(r.expected_schema) || '.' || quote_ident(r.expected_table) ||
      ' FOR EACH ' || r.for_each ||
      ' EXECUTE FUNCTION ' || quote_ident(r.function_schema) || '.' || quote_ident(r.function_name) || '()';

    v_action_entry := jsonb_build_object(
      'trigger', r.expected_trigger,
      'table', r.expected_schema || '.' || r.expected_table,
      'function', r.function_schema || '.' || r.function_name,
      'sql', v_sql
    );

    IF dry_run THEN
      v_action_entry := v_action_entry || '{"status":"dry_run"}'::jsonb;
      v_actions := v_actions || jsonb_build_array(v_action_entry);
      CONTINUE;
    END IF;

    -- Execute: DROP IF EXISTS + CREATE
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.expected_trigger) ||
            ' ON ' || quote_ident(r.expected_schema) || '.' || quote_ident(r.expected_table);
    EXECUTE v_sql;

    v_rebound := v_rebound + 1;
    v_action_entry := v_action_entry || '{"status":"rebound"}'::jsonb;
    v_actions := v_actions || jsonb_build_array(v_action_entry);

    -- Audit log
    INSERT INTO public.ops_ddl_audit(action, details)
    VALUES ('auto_rebind_trigger', v_action_entry);
  END LOOP;

  attempted := v_attempted;
  rebound := v_rebound;
  skipped := v_skipped;
  actions := v_actions;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_rebind_missing_triggers(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_rebind_missing_triggers(boolean) TO service_role;

COMMIT;
