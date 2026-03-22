
-- ============================================================
-- ExamFit Content Automation Engine — DB Schema
-- ============================================================

-- 1. content_jobs: Blueprint → Content Script Pipeline
CREATE TABLE public.content_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID REFERENCES public.question_blueprints(id) ON DELETE SET NULL,
  question_id UUID REFERENCES public.exam_questions(id) ON DELETE SET NULL,
  curriculum_id UUID,
  competency_id UUID,
  content_type TEXT NOT NULL DEFAULT 'video' CHECK (content_type IN ('video', 'post', 'carousel', 'reel', 'story')),
  platform TEXT NOT NULL DEFAULT 'tiktok' CHECK (platform IN ('tiktok', 'instagram', 'youtube', 'linkedin', 'all')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'generated', 'review', 'approved', 'published', 'failed')),
  hook TEXT,
  script TEXT,
  cta TEXT,
  hashtags TEXT[],
  target_audience TEXT DEFAULT 'azubi' CHECK (target_audience IN ('azubi', 'betrieb', 'institution', 'all')),
  content_category TEXT DEFAULT 'reichweite' CHECK (content_category IN ('reichweite', 'vertrauen', 'conversion')),
  llm_model TEXT,
  llm_cost_eur NUMERIC DEFAULT 0,
  generation_meta JSONB DEFAULT '{}',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on content_jobs" ON public.content_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. video_jobs: Script → Voice → Video Pipeline
CREATE TABLE public.video_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id UUID NOT NULL REFERENCES public.content_jobs(id) ON DELETE CASCADE,
  script TEXT NOT NULL,
  voice_provider TEXT DEFAULT 'elevenlabs',
  voice_url TEXT,
  video_provider TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  duration_seconds NUMERIC,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'voice_generating', 'voice_done', 'video_generating', 'video_done', 'failed')),
  error_message TEXT,
  processing_meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on video_jobs" ON public.video_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. distribution_jobs: Auto-Posting Pipeline
CREATE TABLE public.distribution_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id UUID NOT NULL REFERENCES public.content_jobs(id) ON DELETE CASCADE,
  video_job_id UUID REFERENCES public.video_jobs(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'youtube', 'linkedin')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'posting', 'posted', 'failed')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  external_post_id TEXT,
  external_url TEXT,
  caption TEXT,
  hashtags TEXT[],
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.distribution_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on distribution_jobs" ON public.distribution_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. content_performance: Analytics per Content Piece
CREATE TABLE public.content_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id UUID NOT NULL REFERENCES public.content_jobs(id) ON DELETE CASCADE,
  distribution_job_id UUID REFERENCES public.distribution_jobs(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  watch_time_seconds NUMERIC DEFAULT 0,
  retention_pct NUMERIC DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  conversion_rate NUMERIC DEFAULT 0,
  revenue_eur NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on content_performance" ON public.content_performance FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. b2b_leads: Betriebe CRM
CREATE TABLE public.b2b_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  industry TEXT,
  azubi_count INTEGER,
  source TEXT DEFAULT 'website' CHECK (source IN ('website', 'linkedin', 'email', 'referral', 'event', 'content', 'other')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'demo_scheduled', 'demo_done', 'proposal_sent', 'negotiation', 'closed_won', 'closed_lost')),
  deal_value_eur NUMERIC,
  notes TEXT,
  next_action TEXT,
  next_action_at TIMESTAMPTZ,
  assigned_to TEXT,
  tags TEXT[],
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.b2b_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on b2b_leads" ON public.b2b_leads FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. content_hooks: Hook-Datenbank für maximale Aufmerksamkeit
CREATE TABLE public.content_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hook_text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'reichweite' CHECK (category IN ('reichweite', 'vertrauen', 'conversion', 'provokation', 'neugier')),
  target_audience TEXT DEFAULT 'azubi',
  usage_count INTEGER DEFAULT 0,
  avg_performance_score NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_hooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on content_hooks" ON public.content_hooks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indices for performance
CREATE INDEX idx_content_jobs_status ON public.content_jobs(status);
CREATE INDEX idx_content_jobs_blueprint ON public.content_jobs(blueprint_id);
CREATE INDEX idx_content_jobs_curriculum ON public.content_jobs(curriculum_id);
CREATE INDEX idx_video_jobs_status ON public.video_jobs(status);
CREATE INDEX idx_video_jobs_content ON public.video_jobs(content_job_id);
CREATE INDEX idx_distribution_jobs_status ON public.distribution_jobs(status);
CREATE INDEX idx_content_performance_content ON public.content_performance(content_job_id);
CREATE INDEX idx_content_performance_platform ON public.content_performance(platform);
CREATE INDEX idx_b2b_leads_status ON public.b2b_leads(status);
CREATE INDEX idx_content_hooks_category ON public.content_hooks(category);

-- Seed initial hooks
INSERT INTO public.content_hooks (hook_text, category) VALUES
  ('Diese Frage killt 90% der Azubis', 'provokation'),
  ('Das kommt SAFE in der Prüfung', 'neugier'),
  ('Typische IHK-Prüfungsfalle', 'reichweite'),
  ('Wenn du DAS nicht kannst → durchgefallen', 'provokation'),
  ('Die meisten Azubis machen hier einen Denkfehler', 'vertrauen'),
  ('Prüfer lieben diese Frage', 'neugier'),
  ('Hier entscheidet sich deine Note', 'conversion'),
  ('Das ist eine 100%-Prüfungsfrage', 'reichweite'),
  ('Diese Antwort klingt richtig – ist aber falsch', 'provokation'),
  ('Wenn du das verwechselst → Problem', 'vertrauen'),
  ('1 Minute – 1 IHK Frage', 'reichweite'),
  ('Würdest du DAS in der Prüfung richtig machen?', 'neugier'),
  ('90% fallen bei dieser Frage durch', 'provokation'),
  ('Das ist KEIN richtiger Antwortweg', 'vertrauen'),
  ('Kurz vor der Prüfung: DAS musst du können', 'conversion');
