
-- ============================================================
-- BerufsKI Premium PDF & Licensing Engine
-- ============================================================

-- 1) PDF TEMPLATES & BRAND THEMES
-- ============================================================

CREATE TABLE public.berufski_pdf_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  html_shell text NOT NULL,          -- main HTML template with placeholders
  css text NOT NULL,                 -- full CSS including print styles
  version integer NOT NULL DEFAULT 1,
  is_default boolean DEFAULT false,
  layout_components jsonb DEFAULT '[]'::jsonb,  -- available components: cover, toc, chapter, checklist, etc.
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.berufski_pdf_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read default templates"
  ON public.berufski_pdf_templates FOR SELECT
  USING (true);

CREATE POLICY "Admins manage templates"
  ON public.berufski_pdf_templates FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Brand themes
CREATE TABLE public.berufski_brand_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name text NOT NULL,
  primary_color text NOT NULL DEFAULT '#1a1a2e',
  accent_color text NOT NULL DEFAULT '#e94560',
  secondary_color text DEFAULT '#0f3460',
  font_heading text DEFAULT 'IBM Plex Sans',
  font_body text DEFAULT 'Inter',
  logo_url text,
  cover_style jsonb DEFAULT '{}'::jsonb,   -- gradient directions, patterns, etc.
  footer_text text DEFAULT 'BerufsKI.de – KI-Praxisleitfäden für deinen Beruf',
  legal_notice text,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.berufski_brand_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read themes"
  ON public.berufski_brand_themes FOR SELECT
  USING (true);

CREATE POLICY "Admins manage themes"
  ON public.berufski_brand_themes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) COVER ASSETS
-- ============================================================

CREATE TABLE public.berufski_cover_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beruf_id uuid REFERENCES public.berufski_berufe(id) ON DELETE CASCADE NOT NULL,
  tier text NOT NULL CHECK (tier IN ('9', '19', '29')),
  style text DEFAULT 'programmatic',  -- 'programmatic' | 'ai_generated'
  image_url text,
  storage_path text,
  source_prompt text,                 -- AI prompt used (if ai_generated)
  icon_key text,                      -- icon identifier for programmatic covers
  badge_text text,                    -- e.g. "Prompt Guide", "Praxisleitfaden"
  color_variant jsonb,                -- override colors for this specific cover
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(beruf_id, tier)
);

ALTER TABLE public.berufski_cover_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read covers"
  ON public.berufski_cover_assets FOR SELECT
  USING (true);

CREATE POLICY "Admins manage covers"
  ON public.berufski_cover_assets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3) BUNDLES
-- ============================================================

CREATE TABLE public.berufski_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  bundle_type text NOT NULL DEFAULT 'single_pdf' CHECK (bundle_type IN ('single_pdf', 'zip')),
  price_cents integer NOT NULL,
  original_price_cents integer,       -- for strikethrough display
  included_product_ids uuid[] DEFAULT '{}',
  bonus_content jsonb DEFAULT '[]'::jsonb,  -- extra sections: cheat sheets, quick start, etc.
  stripe_price_id text,
  stripe_product_id text,
  is_active boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.berufski_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active bundles"
  ON public.berufski_bundles FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins manage bundles"
  ON public.berufski_bundles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Bundle assets (rendered PDFs, ZIPs)
CREATE TABLE public.berufski_bundle_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid REFERENCES public.berufski_bundles(id) ON DELETE CASCADE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pdf', 'zip')),
  storage_path text NOT NULL,
  checksum text,
  version integer DEFAULT 1,
  file_size_bytes bigint,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.berufski_bundle_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage bundle assets"
  ON public.berufski_bundle_assets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) B2B LICENSING
-- ============================================================

CREATE TABLE public.berufski_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text,
  billing_email text NOT NULL,
  vat_id text,
  address jsonb,
  admin_user_id uuid,                -- primary contact
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.berufski_organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can read own org"
  ON public.berufski_organizations FOR SELECT
  TO authenticated
  USING (
    admin_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins manage orgs"
  ON public.berufski_organizations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Org members
CREATE TABLE public.berufski_org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.berufski_organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  added_at timestamptz DEFAULT now(),
  UNIQUE(org_id, user_id)
);

ALTER TABLE public.berufski_org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read own membership"
  ON public.berufski_org_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins manage members"
  ON public.berufski_org_members FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Licenses
CREATE TABLE public.berufski_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.berufski_organizations(id) ON DELETE CASCADE NOT NULL,
  product_id uuid,                   -- references berufski_produkte or bundle
  bundle_id uuid,                    -- references berufski_bundles
  plan text NOT NULL CHECK (plan IN ('team', 'enterprise', 'site')),
  seats integer NOT NULL DEFAULT 10,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'suspended')),
  stripe_subscription_id text,
  watermark_text text,               -- custom watermark for this license
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (product_id IS NOT NULL OR bundle_id IS NOT NULL)
);

ALTER TABLE public.berufski_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can read own licenses"
  ON public.berufski_licenses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.berufski_organizations o
      WHERE o.id = org_id AND o.admin_user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins manage licenses"
  ON public.berufski_licenses FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- License keys
CREATE TABLE public.berufski_license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid REFERENCES public.berufski_licenses(id) ON DELETE CASCADE NOT NULL,
  key text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  status text DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  activated_at timestamptz,
  activated_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.berufski_license_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage license keys"
  ON public.berufski_license_keys FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- License events (audit trail)
CREATE TABLE public.berufski_license_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid REFERENCES public.berufski_licenses(id) ON DELETE CASCADE NOT NULL,
  event_type text NOT NULL,          -- 'created', 'activated', 'download', 'renewed', 'revoked'
  user_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.berufski_license_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read license events"
  ON public.berufski_license_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System inserts license events"
  ON public.berufski_license_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 5) PDF EXPORTS
-- ============================================================

CREATE TABLE public.berufski_pdf_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.berufski_produkte(id) ON DELETE SET NULL,
  bundle_id uuid REFERENCES public.berufski_bundles(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.berufski_pdf_templates(id),
  theme_id uuid REFERENCES public.berufski_brand_themes(id),
  mode text NOT NULL DEFAULT 'screen' CHECK (mode IN ('screen', 'print', 'print_bleed')),
  storage_path text NOT NULL,
  file_size_bytes bigint,
  page_count integer,
  checksum text,
  version integer DEFAULT 1,
  render_duration_ms integer,
  created_at timestamptz DEFAULT now(),
  CHECK (product_id IS NOT NULL OR bundle_id IS NOT NULL)
);

ALTER TABLE public.berufski_pdf_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pdf exports"
  ON public.berufski_pdf_exports FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6) ADD STRUCTURED CONTENT COLUMN TO berufski_produkte
-- ============================================================

ALTER TABLE public.berufski_produkte
  ADD COLUMN IF NOT EXISTS content_json jsonb,           -- structured content (chapters, prompts, tables, checklists)
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.berufski_pdf_templates(id),
  ADD COLUMN IF NOT EXISTS theme_id uuid REFERENCES public.berufski_brand_themes(id),
  ADD COLUMN IF NOT EXISTS cover_asset_id uuid REFERENCES public.berufski_cover_assets(id),
  ADD COLUMN IF NOT EXISTS screen_pdf_path text,
  ADD COLUMN IF NOT EXISTS print_pdf_path text,
  ADD COLUMN IF NOT EXISTS pdf_version integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_rendered_at timestamptz;

-- 7) HELPER: auto-update timestamps
-- ============================================================

CREATE OR REPLACE FUNCTION public.berufski_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_berufski_pdf_templates_updated
  BEFORE UPDATE ON public.berufski_pdf_templates
  FOR EACH ROW EXECUTE FUNCTION public.berufski_update_timestamp();

CREATE TRIGGER trg_berufski_brand_themes_updated
  BEFORE UPDATE ON public.berufski_brand_themes
  FOR EACH ROW EXECUTE FUNCTION public.berufski_update_timestamp();

CREATE TRIGGER trg_berufski_cover_assets_updated
  BEFORE UPDATE ON public.berufski_cover_assets
  FOR EACH ROW EXECUTE FUNCTION public.berufski_update_timestamp();

CREATE TRIGGER trg_berufski_bundles_updated
  BEFORE UPDATE ON public.berufski_bundles
  FOR EACH ROW EXECUTE FUNCTION public.berufski_update_timestamp();

CREATE TRIGGER trg_berufski_organizations_updated
  BEFORE UPDATE ON public.berufski_organizations
  FOR EACH ROW EXECUTE FUNCTION public.berufski_update_timestamp();

CREATE TRIGGER trg_berufski_licenses_updated
  BEFORE UPDATE ON public.berufski_licenses
  FOR EACH ROW EXECUTE FUNCTION public.berufski_update_timestamp();

-- 8) DEFAULT TEMPLATE + THEME SEED
-- ============================================================

INSERT INTO public.berufski_brand_themes (brand_name, primary_color, accent_color, secondary_color, font_heading, font_body, logo_url, footer_text, is_default)
VALUES (
  'BerufsKI Standard',
  '#1a1a2e',
  '#e94560',
  '#0f3460',
  'IBM Plex Sans',
  'Inter',
  NULL,
  'BerufsKI.de – KI-Praxisleitfäden für deinen Beruf | Ein Produkt von examfit.de',
  true
);

INSERT INTO public.berufski_pdf_templates (name, slug, description, html_shell, css, is_default, layout_components)
VALUES (
  'Premium v1',
  'berufski-premium-v1',
  'Professionelles BerufsKI-Template mit Cover, TOC, Kapiteln, Callouts und Print-Support',
  '<!DOCTYPE html><html><head><meta charset="utf-8"><style>{{CSS}}</style></head><body>{{COVER}}{{TOC}}{{CONTENT}}{{FOOTER}}</body></html>',
  '@page { size: A4; margin: 20mm; } @page :first { margin: 0; } body { font-family: Inter, sans-serif; color: #1a1a2e; line-height: 1.6; } h1, h2, h3 { font-family: "IBM Plex Sans", sans-serif; page-break-after: avoid; } .chapter { page-break-before: always; } .callout { border-left: 4px solid #e94560; padding: 12px 16px; margin: 16px 0; background: #fef2f4; border-radius: 4px; } .callout.info { border-color: #0f3460; background: #f0f4f8; } .callout.tip { border-color: #27ae60; background: #f0faf4; } .prompt-card { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 16px; margin: 12px 0; } .prompt-card .label { font-size: 11px; text-transform: uppercase; color: #e94560; font-weight: 700; } table { width: 100%; border-collapse: collapse; margin: 16px 0; page-break-inside: avoid; } th, td { padding: 8px 12px; border: 1px solid #dee2e6; text-align: left; } tr:nth-child(even) { background: #f8f9fa; } th { background: #1a1a2e; color: white; } .footer { position: running(footer); font-size: 9px; color: #888; text-align: center; } @bottom-center { content: element(footer); } .page-number::after { content: counter(page); } .toc a { text-decoration: none; color: #1a1a2e; } .checklist li { list-style: none; padding-left: 24px; position: relative; } .checklist li::before { content: "☐"; position: absolute; left: 0; }',
  true,
  '["cover", "toc", "chapter", "callout", "prompt_card", "checklist", "table", "workflow", "case_study"]'::jsonb
);
