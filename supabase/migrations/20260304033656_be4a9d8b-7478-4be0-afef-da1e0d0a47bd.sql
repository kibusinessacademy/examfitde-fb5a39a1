
-- Drop existing function with old signature
DROP FUNCTION IF EXISTS public.check_trigger_bindings();

-- Recreate expected_trigger_bindings table (idempotent)
CREATE TABLE IF NOT EXISTS public.expected_trigger_bindings (
  id bigserial PRIMARY KEY,
  expected_trigger text NOT NULL,
  expected_schema text NOT NULL DEFAULT 'public',
  expected_table text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expected_trigger, expected_schema, expected_table)
);

ALTER TABLE public.expected_trigger_bindings ENABLE ROW LEVEL SECURITY;

-- Only service_role should access this table
DO $$ BEGIN
  CREATE POLICY "Service role only" ON public.expected_trigger_bindings
    FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed: authoritative list of critical triggers
INSERT INTO public.expected_trigger_bindings (expected_trigger, expected_schema, expected_table)
VALUES
  ('guard_publish_requires_questions', 'public', 'course_packages'),
  ('guard_publish_requires_real_content', 'public', 'course_packages'),
  ('trg_guard_step_failed_requires_reason', 'public', 'package_steps'),
  ('trg_exam_questions_enforce_learning_field_id', 'public', 'exam_questions'),
  ('trg_curriculum_freeze_guard', 'public', 'curricula'),
  ('trg_blueprint_approval_guard', 'public', 'question_blueprints'),
  ('trg_package_steps_sort_order_guard', 'public', 'package_steps'),
  ('trg_guard_building_published_drift', 'public', 'course_packages'),
  ('trg_guard_published_immutable', 'public', 'course_packages'),
  ('trg_sync_course_status_on_package', 'public', 'course_packages'),
  ('trg_guard_building_requires_enrichment', 'public', 'course_packages')
ON CONFLICT DO NOTHING;

-- RPC: check_trigger_bindings (new clean signature)
CREATE OR REPLACE FUNCTION public.check_trigger_bindings()
RETURNS TABLE (
  all_clear boolean,
  missing_count int,
  missing jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing jsonb;
  v_cnt int;
BEGIN
  WITH expected AS (
    SELECT expected_trigger, expected_schema, expected_table
    FROM public.expected_trigger_bindings
    WHERE enabled = true
  ),
  actual AS (
    SELECT
      t.tgname::text AS trigger_name,
      n.nspname::text AS schema_name,
      c.relname::text AS table_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
  ),
  check_missing AS (
    SELECT
      e.expected_trigger,
      e.expected_schema,
      e.expected_table,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM pg_proc p 
          JOIN pg_namespace pn ON pn.oid = p.pronamespace
          WHERE pn.nspname = e.expected_schema 
            AND p.proname = e.expected_trigger
        )
        THEN true ELSE false
      END AS function_exists,
      true AS is_missing
    FROM expected e
    LEFT JOIN actual a
      ON a.trigger_name = e.expected_trigger
     AND a.schema_name = e.expected_schema
     AND a.table_name  = e.expected_table
    WHERE a.trigger_name IS NULL
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(check_missing)), '[]'::jsonb),
    COUNT(*)::int
  INTO v_missing, v_cnt
  FROM check_missing;

  all_clear := (v_cnt = 0);
  missing_count := v_cnt;
  missing := v_missing;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.check_trigger_bindings() FROM PUBLIC;
