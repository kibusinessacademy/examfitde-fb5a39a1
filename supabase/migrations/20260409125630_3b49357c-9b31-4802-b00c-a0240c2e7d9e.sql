
-- ==========================================
-- 1. SSO Connections
-- ==========================================
CREATE TABLE public.sso_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('azure_ad','okta','google_workspace','saml','oidc')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  domain text,
  auto_provision boolean DEFAULT true,
  auto_assign_seat boolean DEFAULT true,
  default_role text DEFAULT 'learner',
  role_mapping jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','error','disabled')),
  last_test_at timestamptz,
  last_test_result jsonb,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.sso_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage SSO connections"
  ON public.sso_connections FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==========================================
-- 2. SCIM Mappings
-- ==========================================
CREATE TABLE public.scim_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mapping_type text NOT NULL CHECK (mapping_type IN ('user','role','seat','department')),
  source_field text NOT NULL,
  target_field text NOT NULL,
  transform_rules jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  priority int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.scim_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage SCIM mappings"
  ON public.scim_mappings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==========================================
-- 3. SSO Login Events (Audit)
-- ==========================================
CREATE TABLE public.sso_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sso_connection_id uuid REFERENCES public.sso_connections(id) ON DELETE SET NULL,
  email text,
  provider text,
  org_id uuid,
  mapped_role text,
  was_provisioned boolean DEFAULT false,
  was_seat_assigned boolean DEFAULT false,
  success boolean DEFAULT true,
  error_message text,
  raw_claims jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.sso_login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read SSO events"
  ON public.sso_login_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert SSO events"
  ON public.sso_login_events FOR INSERT TO authenticated
  WITH CHECK (true);

-- ==========================================
-- 4. Pipeline Hardening: Auto-cancel terminal loop jobs
-- ==========================================
CREATE OR REPLACE FUNCTION public.fn_auto_cancel_terminal_loop_jobs()
RETURNS TABLE(job_id uuid, job_type text, reason text) 
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH terminal AS (
    SELECT j.id, j.job_type,
      CASE
        WHEN j.last_error ILIKE '%STALE_LOCK%' THEN 'STALE_LOCK_TERMINAL'
        WHEN j.last_error ILIKE '%LOOP_KILLED%' THEN 'LOOP_KILLED_TERMINAL'
        WHEN j.last_error ILIKE '%ZOMBIE_TERMINAL%' THEN 'ZOMBIE_TERMINAL'
        WHEN j.last_error ILIKE '%EXHAUSTED%' THEN 'ATTEMPTS_EXHAUSTED'
        ELSE 'TERMINAL_ERROR'
      END AS reason
    FROM job_queue j
    WHERE j.status IN ('failed','pending')
      AND (
        j.last_error ILIKE '%STALE_LOCK_EXHAUSTED%'
        OR j.last_error ILIKE '%LOOP_KILLED%'
        OR j.last_error ILIKE '%ZOMBIE_TERMINAL%'
        OR (j.status = 'failed' AND j.attempts >= j.max_attempts)
      )
  )
  UPDATE job_queue jq SET
    status = 'cancelled',
    last_error = jq.last_error || ' [AUTO_CANCELLED: ' || t.reason || ']',
    updated_at = now()
  FROM terminal t
  WHERE jq.id = t.id
  RETURNING jq.id AS job_id, jq.job_type, t.reason;
END;
$$;

-- ==========================================
-- 5. Pipeline Hardening: Auto-finalize ready steps
-- ==========================================
CREATE OR REPLACE FUNCTION public.fn_auto_finalize_ready_steps()
RETURNS TABLE(package_id uuid, step_key text, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT ps.package_id, ps.step_key,
      ps.metadata,
      (SELECT COUNT(*) FROM job_queue j 
       WHERE j.package_id = ps.package_id 
         AND j.job_type = ps.step_key 
         AND j.status IN ('pending','processing','running','batch_pending','enqueued')
      ) AS active_jobs,
      CASE
        WHEN (ps.metadata->>'completion_signal') IN ('batch_complete','ok') THEN true
        ELSE false
      END AS has_signal,
      CASE 
        WHEN ps.updated_at < now() - interval '10 minutes' THEN true
        ELSE false
      END AS is_old_enough
    FROM package_steps ps
    WHERE ps.status NOT IN ('done','skipped','not_started')
      AND ps.status IN ('running','processing','enqueued')
  )
  SELECT c.package_id, c.step_key,
    'AUTO_FINALIZED: signal=' || COALESCE(c.metadata->>'completion_signal','none') AS reason
  FROM candidates c
  WHERE c.has_signal = true
    AND c.active_jobs = 0
    AND c.is_old_enough = true;
END;
$$;
