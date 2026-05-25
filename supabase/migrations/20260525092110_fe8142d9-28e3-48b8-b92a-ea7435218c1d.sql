
ALTER TABLE public.document_agent_profiles
  ADD COLUMN IF NOT EXISTS vat_id text,
  ADD COLUMN IF NOT EXISTS disclaimer_text text,
  ADD COLUMN IF NOT EXISTS layout_template text NOT NULL DEFAULT 'modern_corporate',
  ADD COLUMN IF NOT EXISTS font_family text NOT NULL DEFAULT 'Helvetica',
  ADD COLUMN IF NOT EXISTS header_layout text NOT NULL DEFAULT 'logo_left',
  ADD COLUMN IF NOT EXISTS footer_layout text NOT NULL DEFAULT 'contact_centered';

DO $$ BEGIN
  ALTER TABLE public.document_agent_profiles
    ADD CONSTRAINT dap_layout_template_check
    CHECK (layout_template IN ('modern_corporate','minimal_professional','legal_style','enterprise_clean','friendly_business'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.document_agent_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.document_agent_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  branding_profile_id uuid REFERENCES public.document_agent_profiles(id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES public.document_agent_templates(id) ON DELETE RESTRICT,
  template_version integer NOT NULL DEFAULT 1,
  export_format text NOT NULL CHECK (export_format IN ('pdf','docx')),
  layout_template text NOT NULL DEFAULT 'modern_corporate',
  compliance_level text NOT NULL DEFAULT 'standard',
  review_required boolean NOT NULL DEFAULT false,
  storage_path text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,
  export_hash text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dae_run ON public.document_agent_exports(run_id);
CREATE INDEX IF NOT EXISTS idx_dae_user ON public.document_agent_exports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dae_org ON public.document_agent_exports(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;

ALTER TABLE public.document_agent_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dae_select ON public.document_agent_exports;
CREATE POLICY dae_select ON public.document_agent_exports
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.org_memberships m
       WHERE m.org_id = document_agent_exports.organization_id
         AND m.user_id = auth.uid()
         AND m.role IN ('owner','admin')
         AND m.status = 'active'
    ))
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('document-exports', 'document-exports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "doc_exports_read_own" ON storage.objects;
CREATE POLICY "doc_exports_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'document-exports'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );
