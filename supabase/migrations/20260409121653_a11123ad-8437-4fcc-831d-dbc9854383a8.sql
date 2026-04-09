
CREATE TABLE IF NOT EXISTS public.seo_keyword_clusters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_name text NOT NULL,
    parent_topic text,
    persona text,
    business_priority integer DEFAULT 5,
    pillar_page_url text,
    status text DEFAULT 'active',
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.seo_keyword_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage keyword clusters" ON public.seo_keyword_clusters
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );

CREATE TABLE IF NOT EXISTS public.seo_keywords (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword text NOT NULL,
    cluster_id uuid REFERENCES public.seo_keyword_clusters(id) ON DELETE SET NULL,
    intent_type text DEFAULT 'informational',
    funnel_stage text DEFAULT 'tofu',
    persona text,
    search_volume integer,
    difficulty integer,
    business_value integer DEFAULT 5,
    conversion_value integer DEFAULT 5,
    curriculum_fit integer DEFAULT 5,
    content_gap_score integer DEFAULT 0,
    seasonality text,
    opportunity_score numeric(5,2) DEFAULT 0,
    target_page_type text,
    target_url text,
    parent_keyword_id uuid REFERENCES public.seo_keywords(id) ON DELETE SET NULL,
    secondary_keywords text[],
    entity_terms text[],
    status text DEFAULT 'new',
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.seo_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage keywords" ON public.seo_keywords
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );
CREATE INDEX idx_seo_keywords_cluster ON public.seo_keywords(cluster_id);
CREATE INDEX idx_seo_keywords_opportunity ON public.seo_keywords(opportunity_score DESC);

CREATE TABLE IF NOT EXISTS public.seo_content_briefs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword_id uuid REFERENCES public.seo_keywords(id) ON DELETE SET NULL,
    title text NOT NULL,
    content_type text NOT NULL,
    persona text,
    primary_angle text,
    search_intent text,
    funnel_stage text,
    secondary_keywords text[],
    entities text[],
    recommended_headings jsonb DEFAULT '[]',
    faq_suggestions jsonb DEFAULT '[]',
    cta_type text,
    cta_text text,
    internal_link_targets jsonb DEFAULT '[]',
    relevant_features text[],
    json_ld_recommendation text,
    target_word_count integer DEFAULT 1500,
    generated_brief_md text,
    status text DEFAULT 'draft',
    assigned_to text,
    target_publish_date date,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.seo_content_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage content briefs" ON public.seo_content_briefs
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );

CREATE TABLE IF NOT EXISTS public.seo_internal_link_suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_url text NOT NULL,
    source_title text,
    target_url text NOT NULL,
    target_title text,
    anchor_text text,
    relevance_score integer DEFAULT 50,
    link_type text DEFAULT 'contextual',
    priority integer DEFAULT 5,
    reason text,
    status text DEFAULT 'suggested',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.seo_internal_link_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage link suggestions" ON public.seo_internal_link_suggestions
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );

CREATE TABLE IF NOT EXISTS public.seo_content_audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type text NOT NULL,
    content_id uuid NOT NULL,
    content_url text,
    content_title text,
    seo_score integer DEFAULT 0,
    intent_match_score integer DEFAULT 0,
    conversion_score integer DEFAULT 0,
    completeness_score integer DEFAULT 0,
    interlink_score integer DEFAULT 0,
    refresh_risk_score integer DEFAULT 0,
    overall_score integer DEFAULT 0,
    issues jsonb DEFAULT '[]',
    recommendations jsonb DEFAULT '[]',
    cannibalization_risk jsonb,
    schema_recommendation text,
    audited_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);
ALTER TABLE public.seo_content_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage content audits" ON public.seo_content_audits
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );
CREATE INDEX idx_seo_content_audits_content ON public.seo_content_audits(content_type, content_id);

CREATE TABLE IF NOT EXISTS public.seo_refresh_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type text NOT NULL,
    content_id uuid NOT NULL,
    content_url text,
    content_title text,
    reason text NOT NULL,
    priority integer DEFAULT 5,
    suggested_actions jsonb DEFAULT '[]',
    status text DEFAULT 'pending',
    completed_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.seo_refresh_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage refresh queue" ON public.seo_refresh_queue
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );

CREATE TABLE IF NOT EXISTS public.seo_submission_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    source_type text NOT NULL,
    source_id uuid,
    url text NOT NULL,
    action text NOT NULL,
    status text DEFAULT 'pending',
    request_payload jsonb,
    response_payload jsonb,
    http_status integer,
    error_message text,
    retry_count integer DEFAULT 0,
    submitted_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.seo_submission_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage submission logs" ON public.seo_submission_logs
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );
CREATE INDEX idx_seo_submission_logs_provider ON public.seo_submission_logs(provider, status);
CREATE INDEX idx_seo_submission_logs_failed ON public.seo_submission_logs(status) WHERE status = 'failed';

CREATE TABLE IF NOT EXISTS public.seo_discovery_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    canonical_url text NOT NULL,
    is_indexable boolean DEFAULT true,
    in_sitemap boolean DEFAULT false,
    in_feed boolean DEFAULT false,
    last_submitted_via_indexnow_at timestamptz,
    last_sitemap_refresh_at timestamptz,
    last_feed_refresh_at timestamptz,
    last_discovery_hash text,
    discovery_health_score integer DEFAULT 0,
    drift_issues jsonb DEFAULT '[]',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(source_type, source_id)
);
ALTER TABLE public.seo_discovery_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage discovery state" ON public.seo_discovery_state
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );
CREATE INDEX idx_seo_discovery_state_source ON public.seo_discovery_state(source_type, source_id);

-- Fix enrichment for Digitale Vernetzung
UPDATE public.competencies
SET enrichment_version = 2
WHERE id IN ('cef3adc9-06df-4da8-9802-5b2b8623779d', 'df97e929-6fe9-42ee-8a10-2bead4ba7bcf')
  AND enrichment_version = 0;
