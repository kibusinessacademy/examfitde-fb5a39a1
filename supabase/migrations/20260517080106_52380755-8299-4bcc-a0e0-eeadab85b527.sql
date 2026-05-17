CREATE OR REPLACE FUNCTION public.fn_introspect_columns(_schema text, _table text)
RETURNS TABLE(column_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT c.column_name::text
  FROM information_schema.columns c
  WHERE c.table_schema = _schema
    AND c.table_name = _table
  ORDER BY c.ordinal_position;
$$;

REVOKE ALL ON FUNCTION public.fn_introspect_columns(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_introspect_columns(text, text) TO service_role;

COMMENT ON FUNCTION public.fn_introspect_columns(text, text) IS
  'Pfad C: introspection helper used by supabase/functions/_shared/test-fixtures to '
  'verify live table schemas before INSERTs (hard-fail on column drift). service_role only.';