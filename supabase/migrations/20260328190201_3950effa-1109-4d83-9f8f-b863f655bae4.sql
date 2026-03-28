
CREATE TABLE IF NOT EXISTS public.growth_content_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid,
  curriculum_id uuid,
  content_type text NOT NULL,
  audience text NOT NULL,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seo_content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid,
  curriculum_id uuid,
  page_type text NOT NULL,
  target_audience text,
  slug text NOT NULL,
  title text NOT NULL,
  meta_description text,
  content_md text,
  faq_json jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_magnets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid,
  title text NOT NULL,
  slug text NOT NULL,
  content_type text NOT NULL,
  content_json jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  curriculum_id uuid,
  source text,
  intent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_type text NOT NULL,
  audience text NOT NULL,
  step_number int NOT NULL,
  subject text NOT NULL,
  body_md text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_delivery_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  sequence_type text NOT NULL,
  step_number int NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.growth_content_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_content_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_magnets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on growth_content_jobs" ON public.growth_content_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on seo_content_pages" ON public.seo_content_pages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on lead_magnets" ON public.lead_magnets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on leads" ON public.leads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on email_sequences" ON public.email_sequences FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on email_delivery_queue" ON public.email_delivery_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.v_admin_growth_overview AS
SELECT
  (SELECT COUNT(*) FROM public.growth_content_jobs WHERE status = 'pending') AS social_pending,
  (SELECT COUNT(*) FROM public.growth_content_jobs WHERE status = 'done') AS social_done,
  (SELECT COUNT(*) FROM public.seo_content_pages WHERE status = 'draft') AS seo_draft,
  (SELECT COUNT(*) FROM public.seo_content_pages WHERE status = 'live') AS seo_live,
  (SELECT COUNT(*) FROM public.leads) AS total_leads,
  (SELECT COUNT(*) FROM public.conversion_events) AS total_conversion_events;

GRANT SELECT ON public.v_admin_growth_overview TO service_role;
