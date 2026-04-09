-- ============================================================
-- 1. Add source_type to org_memberships if missing
-- ============================================================
ALTER TABLE public.org_memberships ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'manual';

-- ============================================================
-- 2. Add structured result columns to org_import_jobs
-- ============================================================
ALTER TABLE public.org_import_jobs ADD COLUMN IF NOT EXISTS created_count int DEFAULT 0;
ALTER TABLE public.org_import_jobs ADD COLUMN IF NOT EXISTS updated_count int DEFAULT 0;
ALTER TABLE public.org_import_jobs ADD COLUMN IF NOT EXISTS assigned_seats int DEFAULT 0;
ALTER TABLE public.org_import_jobs ADD COLUMN IF NOT EXISTS skipped_count int DEFAULT 0;
ALTER TABLE public.org_import_jobs ADD COLUMN IF NOT EXISTS error_rows jsonb DEFAULT '[]'::jsonb;

-- ============================================================
-- 3. Add user_id to org_import_job_rows
-- ============================================================
ALTER TABLE public.org_import_job_rows ADD COLUMN IF NOT EXISTS user_id uuid;

-- ============================================================
-- 4. Bridge view: organization_members → org_memberships
--    Allows legacy RLS policies / RPCs that reference organization_members 
--    to keep working during transition
-- ============================================================
CREATE OR REPLACE VIEW public.v_org_members_bridge AS
SELECT
  om.id,
  om.org_id AS organization_id,
  om.user_id,
  om.role,
  om.status,
  om.external_id,
  om.source_type,
  om.created_at
FROM public.org_memberships om;

COMMENT ON VIEW public.v_org_members_bridge IS 'DEPRECATED: Bridge view for legacy organization_members references. Use org_memberships directly.';