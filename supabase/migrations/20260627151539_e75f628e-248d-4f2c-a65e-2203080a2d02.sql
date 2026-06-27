
CREATE TABLE IF NOT EXISTS public.store_release_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apple','google')),
  locale TEXT NOT NULL DEFAULT 'de',
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT, subtitle TEXT, short_description TEXT, long_description TEXT,
  keywords TEXT, promo_text TEXT, changelog TEXT,
  privacy_text TEXT, support_text TEXT,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review_ready','approved','published','superseded')),
  generated_by UUID, approved_by UUID, approved_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_srl_course_platform ON public.store_release_listings(course_id, platform, locale, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_srl_course_platform_locale_version ON public.store_release_listings(course_id, platform, locale, version);
GRANT SELECT, INSERT, UPDATE ON public.store_release_listings TO authenticated;
GRANT ALL ON public.store_release_listings TO service_role;
ALTER TABLE public.store_release_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY srl_admin_read ON public.store_release_listings FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY srl_admin_write ON public.store_release_listings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.store_release_screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apple','google')),
  device_profile TEXT NOT NULL,
  route TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'de',
  storage_bucket TEXT, storage_path TEXT, public_url TEXT,
  width INTEGER, height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rendering','ready','failed')),
  error TEXT, generated_at TIMESTAMPTZ, run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_srs_course_platform ON public.store_release_screenshots(course_id, platform);
GRANT SELECT, INSERT, UPDATE ON public.store_release_screenshots TO authenticated;
GRANT ALL ON public.store_release_screenshots TO service_role;
ALTER TABLE public.store_release_screenshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY srs_admin_read ON public.store_release_screenshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY srs_admin_write ON public.store_release_screenshots FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.store_release_screenshot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  requested_by UUID, github_run_id TEXT,
  routes JSONB, device_profiles JSONB, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.store_release_screenshot_runs TO authenticated;
GRANT ALL ON public.store_release_screenshot_runs TO service_role;
ALTER TABLE public.store_release_screenshot_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY srsr_admin_read ON public.store_release_screenshot_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY srsr_admin_write ON public.store_release_screenshot_runs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE VIEW public.v_admin_store_release_status AS
SELECT
  c.id AS course_id,
  c.title AS course_title,
  m.bundle_id, m.version_name,
  m.app_store_listing_status, m.google_play_listing_status,
  m.release_status, m.last_built_at, m.last_build_status,
  (SELECT status FROM public.store_release_listings l WHERE l.course_id=c.id AND l.platform='apple' ORDER BY version DESC LIMIT 1) AS apple_listing_status,
  (SELECT version FROM public.store_release_listings l WHERE l.course_id=c.id AND l.platform='apple' ORDER BY version DESC LIMIT 1) AS apple_listing_version,
  (SELECT status FROM public.store_release_listings l WHERE l.course_id=c.id AND l.platform='google' ORDER BY version DESC LIMIT 1) AS google_listing_status,
  (SELECT version FROM public.store_release_listings l WHERE l.course_id=c.id AND l.platform='google' ORDER BY version DESC LIMIT 1) AS google_listing_version,
  (SELECT count(*) FROM public.store_release_screenshots s WHERE s.course_id=c.id AND s.platform='apple' AND s.status='ready') AS apple_screenshots_ready,
  (SELECT count(*) FROM public.store_release_screenshots s WHERE s.course_id=c.id AND s.platform='google' AND s.status='ready') AS google_screenshots_ready
FROM public.courses c
JOIN public.mobile_course_app_manifest m ON m.course_id = c.id;
GRANT SELECT ON public.v_admin_store_release_status TO authenticated;

CREATE OR REPLACE TRIGGER trg_srl_updated_at BEFORE UPDATE ON public.store_release_listings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_srs_updated_at BEFORE UPDATE ON public.store_release_screenshots FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_srsr_updated_at BEFORE UPDATE ON public.store_release_screenshot_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
