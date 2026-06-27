
ALTER TABLE public.mobile_course_app_manifest
  ADD COLUMN IF NOT EXISTS curriculum_id uuid,
  ADD COLUMN IF NOT EXISTS product_id uuid,
  ADD COLUMN IF NOT EXISTS android_package_id text,
  ADD COLUMN IF NOT EXISTS ios_bundle_id text,
  ADD COLUMN IF NOT EXISTS build_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_locale text NOT NULL DEFAULT 'de-DE',
  ADD COLUMN IF NOT EXISTS supported_locales text[] NOT NULL DEFAULT ARRAY['de-DE','en-US']::text[],
  ADD COLUMN IF NOT EXISTS store_skus jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS support_url text NOT NULL DEFAULT 'https://berufos.com/support',
  ADD COLUMN IF NOT EXISTS marketing_url text NOT NULL DEFAULT 'https://berufos.com',
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT 'support@berufos.com',
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'EDUCATION',
  ADD COLUMN IF NOT EXISTS age_rating_hint text NOT NULL DEFAULT '4+',
  ADD COLUMN IF NOT EXISTS app_store_listing_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS google_play_listing_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS release_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS content_export_id uuid;
