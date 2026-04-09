
-- Central org access guard function
CREATE OR REPLACE FUNCTION public.fn_require_org_access(
  p_org_id uuid,
  p_roles text[] DEFAULT ARRAY['OWNER','MANAGER','IT_ADMIN','BILLING']
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = auth.uid()
      AND om.role::text = ANY(p_roles)
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ORG_ACCESS';
  END IF;
END;
$$;

-- Org audit events table
CREATE TABLE IF NOT EXISTS public.org_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_audit_events_org ON public.org_audit_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_events_type ON public.org_audit_events(event_type);

ALTER TABLE public.org_audit_events ENABLE ROW LEVEL SECURITY;

-- Org members can view their own org's audit events
CREATE POLICY "Org members can view own org audit events"
ON public.org_audit_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = org_audit_events.org_id
      AND om.user_id = auth.uid()
      AND om.role::text IN ('OWNER','MANAGER','IT_ADMIN')
  )
);

-- Platform admins can view all
CREATE POLICY "Platform admins can view all org audit events"
ON public.org_audit_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'admin'
  )
);

-- Server-side only inserts
CREATE POLICY "No direct client inserts on org_audit_events"
ON public.org_audit_events
FOR INSERT
TO authenticated
WITH CHECK (false);
