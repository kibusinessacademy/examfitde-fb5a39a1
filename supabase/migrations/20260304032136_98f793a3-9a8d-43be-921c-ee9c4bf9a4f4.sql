-- Nightly Trigger-Binding Guard: verifies critical triggers are attached to their tables
-- Returns rows only if a trigger is MISSING (0 rows = all clear)
CREATE OR REPLACE FUNCTION public.check_trigger_bindings()
RETURNS TABLE(expected_trigger text, expected_table text, expected_schema text, is_missing boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH expected(tgname, relname, nspname) AS (
    VALUES
      ('guard_publish_requires_questions', 'course_packages', 'public'),
      ('guard_publish_requires_real_content', 'course_packages', 'public'),
      ('trg_guard_step_failed_requires_reason', 'package_steps', 'public'),
      ('trg_exam_questions_enforce_learning_field_id', 'exam_questions', 'public'),
      ('trg_guard_building_published_drift', 'course_packages', 'public'),
      ('trg_guard_building_requires_enrichment', 'course_packages', 'public'),
      ('trg_sync_course_status_on_package', 'course_packages', 'public')
  ),
  actual AS (
    SELECT t.tgname, c.relname, n.nspname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
  )
  SELECT 
    e.tgname::text AS expected_trigger,
    e.relname::text AS expected_table,
    e.nspname::text AS expected_schema,
    (a.tgname IS NULL) AS is_missing
  FROM expected e
  LEFT JOIN actual a ON a.tgname = e.tgname AND a.relname = e.relname AND a.nspname = e.nspname;
$$;