-- SECURITY DEFINER RPC to expose pg_enum values for contract tests
CREATE OR REPLACE FUNCTION public.get_enum_values(enum_name text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(array_agg(e.enumlabel ORDER BY e.enumsortorder), ARRAY[]::text[])
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE t.typname = enum_name
    AND n.nspname = 'public';
$$;

REVOKE ALL ON FUNCTION public.get_enum_values(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_enum_values(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_enum_values(text) IS
  'Returns labels of a public-schema enum type. Used by CI contract guards (persona-enum-contract, enum-drift-guard).';