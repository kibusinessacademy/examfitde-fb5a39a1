
-- PHASE 1: Channel Architecture Foundation
-- 1. EXTEND products TABLE
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'course',
  ADD COLUMN IF NOT EXISTS curriculum_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS channel_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.products
  ADD CONSTRAINT products_product_type_check CHECK (
    product_type IN ('course','exam_trainer','oral_trainer','bundle','micro_course')
  ),
  ADD CONSTRAINT products_status_check CHECK (
    status IN ('draft','active','retired','archived')
  ),
  ADD CONSTRAINT products_visibility_check CHECK (
    visibility IN ('private','public','enterprise_only','invite_only')
  );

-- 2. CREATE product_versions
CREATE TABLE public.product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  version_tag text NOT NULL,
  source_snapshot_ref text,
  release_notes text,
  is_current boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft','frozen','released','deprecated')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, version_tag)
);

-- 3. CREATE product_artifact_mappings
CREATE TABLE public.product_artifact_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_version_id uuid NOT NULL REFERENCES public.product_versions(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (
    artifact_type IN (
      'lesson','lesson_set','minicheck_set','exam_pool',
      'exam_blueprint_set','oral_pack','handbook','tutor_context'
    )
  ),
  artifact_ref_id uuid NOT NULL,
  scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. CREATE product_channel_configs
CREATE TABLE public.product_channel_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (
    channel IN ('web','lti','scorm','ios_app','android_app')
  ),
  is_enabled boolean NOT NULL DEFAULT false,
  availability_mode text NOT NULL DEFAULT 'private' CHECK (
    availability_mode IN ('private','public','enterprise_only','invite_only')
  ),
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, channel)
);

-- 5. CREATE learner_identities
CREATE TABLE public.learner_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  org_id uuid REFERENCES public.organizations(id),
  identity_type text NOT NULL CHECK (
    identity_type IN ('native','lti','invited','anonymous_exam','mobile_only')
  ),
  external_subject_hash text,
  email_normalized text,
  display_name text,
  matching_confidence numeric(5,2),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. EXTEND entitlements TABLE (in-place)
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id),
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS learner_identity_id uuid REFERENCES public.learner_identities(id),
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'web_purchase',
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS seat_scope text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.entitlements
  ADD CONSTRAINT entitlements_source_type_check CHECK (
    source_type IS NULL OR source_type IN (
      'web_purchase','apple_iap','google_play','lti_deployment',
      'admin_grant','coupon','b2b_license','scorm_export_access'
    )
  ),
  ADD CONSTRAINT entitlements_seat_scope_check CHECK (
    seat_scope IN ('single','multi','org_pool')
  );

-- 7. CREATE org_licenses
CREATE TABLE public.org_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  seat_count int NOT NULL DEFAULT 1,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('draft','active','expired','revoked')
  ),
  contract_ref text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. CREATE org_license_assignments
CREATE TABLE public.org_license_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_license_id uuid NOT NULL REFERENCES public.org_licenses(id) ON DELETE CASCADE,
  learner_identity_id uuid NOT NULL REFERENCES public.learner_identities(id),
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','revoked','expired')
  ),
  UNIQUE(org_license_id, learner_identity_id)
);

-- 9. CENTRAL ACCESS CHECK
CREATE OR REPLACE FUNCTION public.can_access_product(
  p_user_id uuid,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.entitlements e
    WHERE e.product_id = p_product_id
      AND (e.source IS NULL OR e.source != 'revoked')
      AND (
        e.user_id = p_user_id
        OR e.learner_identity_id IN (
          SELECT li.id FROM public.learner_identities li WHERE li.user_id = p_user_id
        )
      )
      AND e.valid_from <= now()
      AND (e.valid_until IS NULL OR e.valid_until >= now())
  );
$$;

-- 10. INDEXES
CREATE INDEX IF NOT EXISTS idx_product_versions_product_current
  ON public.product_versions(product_id) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_product_artifact_mappings_version
  ON public.product_artifact_mappings(product_version_id);
CREATE INDEX IF NOT EXISTS idx_product_channel_configs_product_channel
  ON public.product_channel_configs(product_id, channel);
CREATE INDEX IF NOT EXISTS idx_learner_identities_user
  ON public.learner_identities(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entitlements_product
  ON public.entitlements(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_licenses_org_product
  ON public.org_licenses(org_id, product_id);

-- 11. RLS
ALTER TABLE public.product_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read product versions"
  ON public.product_versions FOR SELECT TO authenticated USING (true);

ALTER TABLE public.product_artifact_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read artifact mappings"
  ON public.product_artifact_mappings FOR SELECT TO authenticated USING (true);

ALTER TABLE public.product_channel_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read channel configs"
  ON public.product_channel_configs FOR SELECT TO authenticated USING (true);

ALTER TABLE public.learner_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own learner identity"
  ON public.learner_identities FOR SELECT TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.org_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can read licenses"
  ON public.org_licenses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.learner_identities li
      WHERE li.org_id = org_licenses.org_id AND li.user_id = auth.uid()
    )
  );

ALTER TABLE public.org_license_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own assignments"
  ON public.org_license_assignments FOR SELECT TO authenticated
  USING (
    learner_identity_id IN (
      SELECT id FROM public.learner_identities WHERE user_id = auth.uid()
    )
  );
