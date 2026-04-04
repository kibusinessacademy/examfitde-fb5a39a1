
-- Product Landing Profiles
CREATE TABLE IF NOT EXISTS public.product_landing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL REFERENCES public.certifications(id) ON DELETE CASCADE,
  landing_type text NOT NULL CHECK (landing_type IN ('AZUBI','FORTBILDUNG','ZERTIFIKAT','BETRIEB','INSTITUTION')),
  primary_goal text NOT NULL,
  target_pain_points text[] NOT NULL DEFAULT '{}',
  primary_cta text NOT NULL,
  secondary_cta text,
  hero_headline text NOT NULL,
  hero_subline text NOT NULL,
  usp_items text[] NOT NULL DEFAULT '{}',
  proof_items text[] NOT NULL DEFAULT '{}',
  faq_seed jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_title text,
  seo_description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(certification_id, landing_type)
);

ALTER TABLE public.product_landing_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Landing profiles are publicly readable"
  ON public.product_landing_profiles FOR SELECT
  USING (true);

-- Product Module Configs
CREATE TABLE IF NOT EXISTS public.product_module_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL REFERENCES public.certifications(id) ON DELETE CASCADE,
  exam_trainer boolean NOT NULL DEFAULT true,
  exam_simulation boolean NOT NULL DEFAULT true,
  mini_checks boolean NOT NULL DEFAULT true,
  ai_tutor boolean NOT NULL DEFAULT true,
  oral_exam boolean NOT NULL DEFAULT false,
  handbook boolean NOT NULL DEFAULT false,
  module_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(certification_id)
);

ALTER TABLE public.product_module_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Module configs are publicly readable"
  ON public.product_module_configs FOR SELECT
  USING (true);

-- Product Pricing Configs
CREATE TABLE IF NOT EXISTS public.product_pricing_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL REFERENCES public.certifications(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'EUR',
  one_time_price numeric NOT NULL,
  access_months int NOT NULL DEFAULT 12,
  compare_at_price numeric,
  b2b_price_10 numeric,
  b2b_price_50 numeric,
  b2b_price_200 numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(certification_id)
);

ALTER TABLE public.product_pricing_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pricing configs are publicly readable"
  ON public.product_pricing_configs FOR SELECT
  USING (true);

-- Timestamp triggers
CREATE TRIGGER update_product_landing_profiles_updated_at
  BEFORE UPDATE ON public.product_landing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_product_module_configs_updated_at
  BEFORE UPDATE ON public.product_module_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_product_pricing_configs_updated_at
  BEFORE UPDATE ON public.product_pricing_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
