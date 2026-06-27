CREATE TABLE IF NOT EXISTS public.mobile_course_app_manifest (
  course_id uuid PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,
  bundle_id text NOT NULL UNIQUE CHECK (bundle_id ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  app_name text NOT NULL CHECK (length(app_name) BETWEEN 2 AND 30),
  short_name text NOT NULL CHECK (length(short_name) BETWEEN 2 AND 12),
  version_name text NOT NULL DEFAULT '1.0.0',
  version_code int NOT NULL DEFAULT 1 CHECK (version_code > 0),
  primary_color text NOT NULL DEFAULT '#0F3D3E' CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  icon_url text,
  feature_graphic_url text,
  ios_iap_product_id text,
  android_iap_product_id text,
  iap_price_tier text,
  store_listing_de jsonb NOT NULL DEFAULT '{}'::jsonb,
  store_listing_en jsonb NOT NULL DEFAULT '{}'::jsonb,
  copyright_holder text NOT NULL DEFAULT 'ExamFit / Berufos GmbH',
  license_text text NOT NULL DEFAULT 'Proprietary — All rights reserved. Inhalte lizenziert ausschließlich für Käufer mit gültiger Lizenz.',
  privacy_url text NOT NULL DEFAULT 'https://berufos.com/datenschutz',
  imprint_url text NOT NULL DEFAULT 'https://berufos.com/impressum',
  last_built_at timestamptz,
  last_build_status text CHECK (last_build_status IN ('pending','building','ready','failed') OR last_build_status IS NULL),
  last_build_output_url text,
  last_build_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_course_app_manifest TO authenticated;
GRANT ALL ON public.mobile_course_app_manifest TO service_role;

ALTER TABLE public.mobile_course_app_manifest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage mobile manifests"
  ON public.mobile_course_app_manifest
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_mobile_manifest_status ON public.mobile_course_app_manifest(last_build_status);

CREATE OR REPLACE FUNCTION public.set_mobile_manifest_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_mobile_manifest_updated_at
  BEFORE UPDATE ON public.mobile_course_app_manifest
  FOR EACH ROW EXECUTE FUNCTION public.set_mobile_manifest_updated_at();

COMMENT ON TABLE public.mobile_course_app_manifest IS 'Per-course mobile app (Capacitor) build manifest. SSOT: 1 row per Store-listable course. Content stays in courses/lessons tables — NO duplication.';