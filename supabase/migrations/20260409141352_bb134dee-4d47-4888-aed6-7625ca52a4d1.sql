
-- ============================================================
-- 1. Cancel all failed jobs (they have active counterparts or 
--    will be re-created by the scheduler on next cycle)
-- ============================================================
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'HEALED: forensic cleanup — scheduler will re-create if still needed',
    completed_at = now()
WHERE status = 'failed';

-- ============================================================
-- 2. Add email column to profiles for Enterprise SSOT
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL AND u.email IS NOT NULL;

-- ============================================================
-- 3. Hardened org access guard
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_require_org_access(
  p_org_id uuid,
  p_roles text[] DEFAULT ARRAY['OWNER','ADMIN','IT_ADMIN','MANAGER','BILLING']
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = p_org_id
      AND om.user_id = auth.uid()
      AND om.role = ANY(p_roles)
      AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ORG_ACCESS';
  END IF;
END;
$$;

-- ============================================================
-- 4. RPC: get_org_audit_events (replaces direct client read)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_org_audit_events(
  p_org_id uuid,
  p_limit int DEFAULT 100
)
RETURNS SETOF org_audit_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_require_org_access(p_org_id, ARRAY['OWNER','ADMIN','IT_ADMIN','MANAGER','BILLING','REPORT_VIEWER']);
  RETURN QUERY
    SELECT * FROM public.org_audit_events
    WHERE org_id = p_org_id
    ORDER BY created_at DESC
    LIMIT p_limit;
END;
$$;

-- ============================================================
-- 5. Add external_id to org_memberships
-- ============================================================
ALTER TABLE public.org_memberships ADD COLUMN IF NOT EXISTS external_id text;
CREATE INDEX IF NOT EXISTS idx_org_memberships_external_id ON public.org_memberships(external_id) WHERE external_id IS NOT NULL;

-- ============================================================
-- 6. Email sync helper function
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_sync_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
