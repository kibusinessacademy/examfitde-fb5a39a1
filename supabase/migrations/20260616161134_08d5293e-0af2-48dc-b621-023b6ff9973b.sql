
CREATE OR REPLACE FUNCTION public.exec_security_audit_query()
RETURNS TABLE(table_name text, issue text, severity text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  -- RLS enabled but no policies
  SELECT c.relname::text,
         'rls_enabled_no_policy'::text,
         'high'::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
  UNION ALL
  -- Fully permissive (USING true) policies
  SELECT c.relname::text,
         'rls_policy_permissive_true'::text,
         'high'::text
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND pg_get_expr(p.polqual, p.polrelid) = 'true'
  UNION ALL
  -- Tables with no RLS at all
  SELECT c.relname::text,
         'rls_disabled'::text,
         'critical'::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    AND c.relname NOT LIKE 'pg_%';
$$;

REVOKE ALL ON FUNCTION public.exec_security_audit_query() FROM public;
GRANT EXECUTE ON FUNCTION public.exec_security_audit_query() TO service_role;
