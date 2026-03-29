
-- ═══════════════════════════════════════════════════════════════
-- LTI Foundation: Tables, Indexes, RLS, Triggers, RPCs
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Tables ──────────────────────────────────────────────────

CREATE TABLE public.lti_platform_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id),
  issuer text NOT NULL,
  client_id text NOT NULL,
  auth_login_url text NOT NULL,
  auth_token_url text,
  keyset_url text NOT NULL,
  deployment_constraints_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  jwks_cache_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(issuer, client_id),
  CONSTRAINT lti_platform_registrations_status_check CHECK (status IN ('draft','active','disabled','revoked'))
);

CREATE TABLE public.lti_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_registration_id uuid NOT NULL REFERENCES public.lti_platform_registrations(id) ON DELETE CASCADE,
  deployment_id text NOT NULL,
  org_id uuid REFERENCES public.organizations(id),
  status text NOT NULL DEFAULT 'active',
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(platform_registration_id, deployment_id),
  CONSTRAINT lti_deployments_status_check CHECK (status IN ('active','disabled','revoked'))
);

CREATE TABLE public.lti_resource_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.lti_deployments(id) ON DELETE CASCADE,
  resource_link_id text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  launch_mode text NOT NULL,
  grade_return_policy text NOT NULL DEFAULT 'none',
  deep_link_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deployment_id, resource_link_id),
  CONSTRAINT lti_resource_mappings_launch_mode_check CHECK (launch_mode IN ('course','exam','oral','bundle','diagnostic')),
  CONSTRAINT lti_resource_mappings_grade_return_policy_check CHECK (grade_return_policy IN ('none','completion','score','best_score','latest_score'))
);

CREATE TABLE public.lti_launch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.lti_deployments(id),
  learner_identity_id uuid REFERENCES public.learner_identities(id),
  resource_link_id text NOT NULL,
  sub_hash text NOT NULL,
  launch_claims_json jsonb NOT NULL,
  session_status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT lti_launch_sessions_status_check CHECK (session_status IN ('active','expired','cancelled'))
);

CREATE TABLE public.lti_grade_passback_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_session_id uuid NOT NULL REFERENCES public.lti_launch_sessions(id) ON DELETE CASCADE,
  score_source_type text NOT NULL,
  score_source_ref uuid NOT NULL,
  normalized_score numeric(6,4),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  passback_status text NOT NULL DEFAULT 'queued',
  retry_count int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lti_grade_passback_queue_source_type_check CHECK (score_source_type IN ('minicheck','exam_attempt','oral_session','course_completion')),
  CONSTRAINT lti_grade_passback_queue_status_check CHECK (passback_status IN ('queued','processing','completed','failed','cancelled'))
);

-- ── 2. Indexes ─────────────────────────────────────────────────

CREATE INDEX idx_lti_platform_registrations_issuer_client ON public.lti_platform_registrations(issuer, client_id);
CREATE INDEX idx_lti_deployments_platform ON public.lti_deployments(platform_registration_id);
CREATE INDEX idx_lti_deployments_org ON public.lti_deployments(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX idx_lti_resource_mappings_deployment_resource ON public.lti_resource_mappings(deployment_id, resource_link_id);
CREATE INDEX idx_lti_resource_mappings_product ON public.lti_resource_mappings(product_id);
CREATE INDEX idx_lti_launch_sessions_deployment ON public.lti_launch_sessions(deployment_id);
CREATE INDEX idx_lti_launch_sessions_learner_identity ON public.lti_launch_sessions(learner_identity_id) WHERE learner_identity_id IS NOT NULL;
CREATE INDEX idx_lti_launch_sessions_sub_hash ON public.lti_launch_sessions(sub_hash);
CREATE INDEX idx_lti_grade_passback_queue_status ON public.lti_grade_passback_queue(passback_status);
CREATE INDEX idx_lti_grade_passback_queue_launch_session ON public.lti_grade_passback_queue(launch_session_id);

-- ── 3. RLS ─────────────────────────────────────────────────────

ALTER TABLE public.lti_platform_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lti_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lti_resource_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lti_launch_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lti_grade_passback_queue ENABLE ROW LEVEL SECURITY;

-- Platform registrations: service_role only
CREATE POLICY "service_role_full_access" ON public.lti_platform_registrations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Deployments: service_role only
CREATE POLICY "service_role_full_access" ON public.lti_deployments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Resource mappings: service_role only
CREATE POLICY "service_role_full_access" ON public.lti_resource_mappings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Launch sessions: service_role full, authenticated user can read own sessions via learner_identity
CREATE POLICY "service_role_full_access" ON public.lti_launch_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "user_read_own_sessions" ON public.lti_launch_sessions FOR SELECT TO authenticated
  USING (
    learner_identity_id IN (
      SELECT id FROM public.learner_identities WHERE user_id = auth.uid()
    )
  );

-- Grade passback queue: service_role only
CREATE POLICY "service_role_full_access" ON public.lti_grade_passback_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. Updated_at triggers ─────────────────────────────────────

CREATE TRIGGER trg_lti_platform_registrations_updated_at
  BEFORE UPDATE ON public.lti_platform_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_lti_deployments_updated_at
  BEFORE UPDATE ON public.lti_deployments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_lti_resource_mappings_updated_at
  BEFORE UPDATE ON public.lti_resource_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_lti_grade_passback_queue_updated_at
  BEFORE UPDATE ON public.lti_grade_passback_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. RPCs ────────────────────────────────────────────────────

-- A) resolve_lti_registration
CREATE OR REPLACE FUNCTION public.resolve_lti_registration(
  p_issuer text,
  p_client_id text,
  p_deployment_id text
)
RETURNS TABLE (
  platform_registration_id uuid,
  deployment_row_id uuid,
  org_id uuid,
  registration_status text,
  deployment_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pr.id AS platform_registration_id,
    d.id AS deployment_row_id,
    d.org_id,
    pr.status AS registration_status,
    d.status AS deployment_status
  FROM public.lti_platform_registrations pr
  JOIN public.lti_deployments d
    ON d.platform_registration_id = pr.id
   AND d.deployment_id = p_deployment_id
  WHERE pr.issuer = p_issuer
    AND pr.client_id = p_client_id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_lti_registration(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_lti_registration(text, text, text) TO service_role;

-- B) resolve_lti_resource_mapping
CREATE OR REPLACE FUNCTION public.resolve_lti_resource_mapping(
  p_deployment_row_id uuid,
  p_resource_link_id text
)
RETURNS TABLE (
  mapping_id uuid,
  product_id uuid,
  launch_mode text,
  grade_return_policy text,
  config_json jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rm.id AS mapping_id,
    rm.product_id,
    rm.launch_mode,
    rm.grade_return_policy,
    rm.config_json
  FROM public.lti_resource_mappings rm
  WHERE rm.deployment_id = p_deployment_row_id
    AND rm.resource_link_id = p_resource_link_id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_lti_resource_mapping(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_lti_resource_mapping(uuid, text) TO service_role;

-- C) ensure_lti_learner_identity
CREATE OR REPLACE FUNCTION public.ensure_lti_learner_identity(
  p_org_id uuid,
  p_external_subject_hash text,
  p_display_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Try to find existing
  SELECT id INTO v_id
  FROM public.learner_identities
  WHERE identity_type = 'lti'
    AND external_subject_hash = p_external_subject_hash
    AND (org_id = p_org_id OR (org_id IS NULL AND p_org_id IS NULL))
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Update display name if changed
    IF p_display_name IS NOT NULL THEN
      UPDATE public.learner_identities
      SET display_name = p_display_name, updated_at = now()
      WHERE id = v_id AND (display_name IS DISTINCT FROM p_display_name);
    END IF;
    RETURN v_id;
  END IF;

  -- Create new
  INSERT INTO public.learner_identities (identity_type, org_id, external_subject_hash, display_name)
  VALUES ('lti', p_org_id, p_external_subject_hash, p_display_name)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_lti_learner_identity(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_lti_learner_identity(uuid, text, text) TO service_role;

-- ── 6. Register job type ───────────────────────────────────────

INSERT INTO public.ops_job_type_registry (job_type, description, pool)
VALUES ('process_lti_grade_passback', 'Process LTI grade passback queue items', 'ops')
ON CONFLICT (job_type) DO NOTHING;
