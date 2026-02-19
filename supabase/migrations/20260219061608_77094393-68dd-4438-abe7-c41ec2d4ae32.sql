
-- Enable trigram extension for search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1) course_pipeline_events (append-only event stream)
-- ============================================================
CREATE TABLE public.course_pipeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  package_id uuid,
  run_id uuid,
  step_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('started','progress','completed','failed','retry_scheduled','skipped')),
  progress smallint CHECK (progress >= 0 AND progress <= 100),
  message text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cpe_course ON public.course_pipeline_events(course_id, created_at DESC);
CREATE INDEX idx_cpe_package ON public.course_pipeline_events(package_id, created_at DESC);
ALTER TABLE public.course_pipeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cpe_service_all" ON public.course_pipeline_events FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 2) admin_pins
-- ============================================================
CREATE TABLE public.admin_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  label text NOT NULL,
  url text NOT NULL,
  position smallint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_pins" ON public.admin_pins FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3) admin_recent_pages
-- ============================================================
CREATE TABLE public.admin_recent_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url text NOT NULL,
  label text NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_arp_user ON public.admin_recent_pages(user_id, visited_at DESC);
ALTER TABLE public.admin_recent_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_recents" ON public.admin_recent_pages FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 4) admin_search_index (full-text)
-- ============================================================
CREATE TABLE public.admin_search_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  subtitle text,
  keywords tsvector,
  url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id)
);
CREATE INDEX idx_asi_fts ON public.admin_search_index USING gin(keywords);
CREATE INDEX idx_asi_title ON public.admin_search_index USING gin(title gin_trgm_ops);
ALTER TABLE public.admin_search_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_search" ON public.admin_search_index FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service_write_search" ON public.admin_search_index FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 5) ui_content_blocks (CMS-light)
-- ============================================================
CREATE TABLE public.ui_content_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  placement text NOT NULL,
  locale text NOT NULL DEFAULT 'de',
  audience text NOT NULL DEFAULT 'all',
  generated_copy text,
  manual_copy text,
  generated_image_id uuid,
  manual_image_id uuid,
  cta_label text,
  cta_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ui_content_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pub_read_blocks" ON public.ui_content_blocks FOR SELECT USING (status = 'published');
CREATE POLICY "admin_all_blocks" ON public.ui_content_blocks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 6) media_assets
-- ============================================================
CREATE TABLE public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL,
  width int,
  height int,
  mime text,
  primary_keyword text,
  generated_alt text,
  manual_alt text,
  generated_caption text,
  manual_caption text,
  context text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pub_read_media" ON public.media_assets FOR SELECT USING (true);
CREATE POLICY "admin_all_media" ON public.media_assets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 7) VIEWS
-- ============================================================

CREATE OR REPLACE VIEW public.kpi_admin_nav_badges WITH (security_invoker = on) AS
SELECT
  (SELECT count(*) FROM public.job_queue WHERE status = 'failed' AND created_at > now() - interval '24 hours')::int AS failed_jobs_24h,
  (SELECT count(*) FROM public.competency_performance_stats WHERE fragility_level IN ('critical','fragile'))::int AS critical_competencies,
  0::int AS seo_errors,
  (SELECT count(*) FROM public.ops_alerts WHERE acknowledged_at IS NULL)::int AS open_alerts;

CREATE OR REPLACE VIEW public.kpi_course_pipeline_status WITH (security_invoker = on) AS
SELECT DISTINCT ON (e.package_id)
  e.package_id,
  cp.title AS package_title,
  e.step_key AS current_step,
  e.event_type AS last_event_type,
  e.progress AS progress_percent,
  e.message AS last_work_summary,
  e.created_at AS last_event_at,
  EXTRACT(EPOCH FROM (now() - e.created_at))::int AS seconds_since_last_event,
  CASE WHEN now() - e.created_at > interval '2 hours' THEN true ELSE false END AS is_stuck
FROM public.course_pipeline_events e
LEFT JOIN public.course_packages cp ON cp.id = e.package_id
WHERE e.package_id IS NOT NULL
ORDER BY e.package_id, e.created_at DESC;

CREATE OR REPLACE VIEW public.effective_ui_content_blocks WITH (security_invoker = on) AS
SELECT
  id, scope, placement, locale, audience,
  COALESCE(manual_copy, generated_copy) AS copy,
  COALESCE(manual_image_id, generated_image_id) AS image_id,
  cta_label, cta_url, status, updated_at
FROM public.ui_content_blocks;

CREATE OR REPLACE VIEW public.effective_media_assets WITH (security_invoker = on) AS
SELECT
  id, storage_path, width, height, mime, primary_keyword, context,
  COALESCE(manual_alt, generated_alt) AS alt,
  COALESCE(manual_caption, generated_caption) AS caption,
  updated_at
FROM public.media_assets;

-- Realtime for pipeline events
ALTER PUBLICATION supabase_realtime ADD TABLE public.course_pipeline_events;
