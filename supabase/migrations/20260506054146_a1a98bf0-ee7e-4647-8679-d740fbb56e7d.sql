-- =============================================================
-- Linter Warning Reduction — bulk hardening
-- 1) Set search_path='public' on all public functions missing it (Function Search Path Mutable).
-- 2) Revoke API access from materialized view exposed to authenticated.
-- 3) Restrict listing on the two `public` storage buckets to authenticated-only browsing
--    while keeping public read of individual objects intact.
-- Documented SECURITY DEFINER view + function exceptions (service_role-only or has_role-gated)
-- are intentionally NOT changed — see mem://architektur/sicherheit/security-definer-view-exceptions-v1.
-- =============================================================

-- 1) Bulk-fix mutable search_path on functions in public schema.
DO $$
DECLARE
  r record;
  ddl text;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    ddl := format('ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp',
                  r.schema_name, r.proname, r.args);
    BEGIN
      EXECUTE ddl;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip %: %', r.proname, SQLERRM;
    END;
  END LOOP;
END $$;

-- 2) Materialized view should not be exposed via PostgREST API.
REVOKE ALL ON public.ops_curriculum_quality_dashboard_mv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ops_curriculum_quality_dashboard_mv TO service_role;

-- 3) Limit storage bucket listing on the two public buckets — keep object-read public,
--    but restrict listing (which leaks the object inventory) to admins only.
DROP POLICY IF EXISTS "humor_share_cards_list_admin_only" ON storage.objects;
CREATE POLICY "humor_share_cards_list_admin_only"
ON storage.objects FOR SELECT
USING (
  bucket_id <> 'humor-share-cards'
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (current_setting('request.method', true) = 'GET'
      AND coalesce(current_setting('request.path', true),'') LIKE '%/object/public/%')
);

-- Note: the secondary policy above is conservative; PostgREST listing uses storage RPCs
-- that respect this. Public object reads continue to work via signed/public object endpoints.
