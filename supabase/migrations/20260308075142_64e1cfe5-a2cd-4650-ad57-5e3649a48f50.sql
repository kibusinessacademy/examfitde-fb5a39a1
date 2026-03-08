
-- 1. AUTOMATION RUNS
CREATE TABLE IF NOT EXISTS public.campaign_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  processed_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE OR REPLACE FUNCTION public.trg_validate_campaign_automation_runs_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('running','done','failed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_campaign_automation_runs_status ON public.campaign_automation_runs;
CREATE TRIGGER validate_campaign_automation_runs_status
  BEFORE INSERT OR UPDATE ON public.campaign_automation_runs
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_campaign_automation_runs_status();

-- 2. CAMPAIGN LAUNCH PLANS
CREATE TABLE IF NOT EXISTS public.campaign_launch_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  launch_recommendation_id uuid REFERENCES public.curriculum_launch_recommendations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned',
  primary_channel text NOT NULL DEFAULT 'b2c',
  campaign_priority integer NOT NULL DEFAULT 5,
  offer_type text NOT NULL DEFAULT 'standard_course',
  price_tier text NOT NULL DEFAULT 'mid',
  seo_slug text,
  launch_angle text,
  target_persona text,
  asset_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_asset_count integer NOT NULL DEFAULT 0,
  published_asset_count integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_validate_campaign_launch_plans()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('planned','queued','in_progress','ready','launched','blocked','archived') THEN
    RAISE EXCEPTION 'Invalid campaign_launch_plans status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_campaign_launch_plans ON public.campaign_launch_plans;
CREATE TRIGGER validate_campaign_launch_plans
  BEFORE INSERT OR UPDATE ON public.campaign_launch_plans
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_campaign_launch_plans();

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_launch_plans_qc
  ON public.campaign_launch_plans (qualification_catalog_id);

-- 3. ASSET QUEUE
CREATE TABLE IF NOT EXISTS public.campaign_asset_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_plan_id uuid NOT NULL REFERENCES public.campaign_launch_plans(id) ON DELETE CASCADE,
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  asset_key text NOT NULL,
  channel text NOT NULL,
  priority integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_owner text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE OR REPLACE FUNCTION public.trg_validate_campaign_asset_queue_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('queued','processing','done','failed','dead','skipped') THEN
    RAISE EXCEPTION 'Invalid campaign_asset_queue status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_campaign_asset_queue_status ON public.campaign_asset_queue;
CREATE TRIGGER validate_campaign_asset_queue_status
  BEFORE INSERT OR UPDATE ON public.campaign_asset_queue
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_campaign_asset_queue_status();

CREATE INDEX IF NOT EXISTS idx_campaign_asset_queue_sched
  ON public.campaign_asset_queue (status, run_after, priority DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_asset_queue_open
  ON public.campaign_asset_queue (launch_plan_id, asset_key)
  WHERE status IN ('queued','processing','done');

-- 4. GENERATED ASSETS
CREATE TABLE IF NOT EXISTS public.campaign_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_plan_id uuid NOT NULL REFERENCES public.campaign_launch_plans(id) ON DELETE CASCADE,
  queue_id uuid REFERENCES public.campaign_asset_queue(id) ON DELETE SET NULL,
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  asset_key text NOT NULL,
  channel text NOT NULL,
  title text,
  slug text,
  content_markdown text,
  content_json jsonb,
  publication_status text NOT NULL DEFAULT 'draft',
  publication_target text,
  performance_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_validate_campaign_assets_pub_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.publication_status NOT IN ('draft','ready','published','archived') THEN
    RAISE EXCEPTION 'Invalid campaign_assets publication_status: %', NEW.publication_status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_campaign_assets_pub_status ON public.campaign_assets;
CREATE TRIGGER validate_campaign_assets_pub_status
  BEFORE INSERT OR UPDATE ON public.campaign_assets
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_campaign_assets_pub_status();

CREATE INDEX IF NOT EXISTS idx_campaign_assets_lookup
  ON public.campaign_assets (launch_plan_id, channel, asset_type);

-- 5. PERFORMANCE SNAPSHOTS
CREATE TABLE IF NOT EXISTS public.campaign_performance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_plan_id uuid NOT NULL REFERENCES public.campaign_launch_plans(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.campaign_assets(id) ON DELETE CASCADE,
  channel text NOT NULL,
  metric_date date NOT NULL DEFAULT current_date,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  purchases integer NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_performance_snapshots_lookup
  ON public.campaign_performance_snapshots (launch_plan_id, channel, metric_date DESC);

-- 6. HELPER: default asset plan
CREATE OR REPLACE FUNCTION public.default_asset_plan_for_channel(
  p_primary_channel text,
  p_offer_type text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_primary_channel = 'seo' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('asset_type','pillar_page','channel','seo','asset_key','pillar_page'),
      jsonb_build_object('asset_type','faq_cluster','channel','seo','asset_key','faq_cluster'),
      jsonb_build_object('asset_type','blog_cluster','channel','seo','asset_key','blog_cluster'),
      jsonb_build_object('asset_type','leadmagnet_page','channel','seo','asset_key','leadmagnet_page')
    );
  ELSIF p_primary_channel = 'b2b' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('asset_type','sales_onepager','channel','b2b','asset_key','sales_onepager'),
      jsonb_build_object('asset_type','license_page','channel','b2b','asset_key','license_page'),
      jsonb_build_object('asset_type','outreach_email_sequence','channel','b2b','asset_key','outreach_email_sequence'),
      jsonb_build_object('asset_type','demo_pitch','channel','b2b','asset_key','demo_pitch')
    );
  ELSIF p_primary_channel = 'affiliate' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('asset_type','affiliate_landing_page','channel','affiliate','asset_key','affiliate_landing_page'),
      jsonb_build_object('asset_type','affiliate_email_copy','channel','affiliate','asset_key','affiliate_email_copy'),
      jsonb_build_object('asset_type','promo_copy_set','channel','affiliate','asset_key','promo_copy_set')
    );
  ELSIF p_primary_channel = 'hybrid' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('asset_type','sales_page','channel','b2c','asset_key','sales_page'),
      jsonb_build_object('asset_type','pillar_page','channel','seo','asset_key','pillar_page'),
      jsonb_build_object('asset_type','sales_onepager','channel','b2b','asset_key','sales_onepager'),
      jsonb_build_object('asset_type','email_sequence','channel','email','asset_key','email_sequence')
    );
  ELSE
    RETURN jsonb_build_array(
      jsonb_build_object('asset_type','sales_page','channel','b2c','asset_key','sales_page'),
      jsonb_build_object('asset_type','checkout_page_copy','channel','b2c','asset_key','checkout_page_copy'),
      jsonb_build_object('asset_type','email_sequence','channel','email','asset_key','email_sequence'),
      jsonb_build_object('asset_type','ad_copy_set','channel','paid','asset_key','ad_copy_set')
    );
  END IF;
END;
$$;

-- 7. SYNC LAUNCH PLANS FROM RECOMMENDATIONS
CREATE OR REPLACE FUNCTION public.sync_campaign_launch_plans()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT clr.*, qc.canonical_title
    FROM public.curriculum_launch_recommendations clr
    JOIN public.qualification_catalog qc ON qc.id = clr.qualification_catalog_id
    WHERE clr.launch_status IN ('ready','planned')
  LOOP
    INSERT INTO public.campaign_launch_plans (
      qualification_catalog_id, curriculum_id, launch_recommendation_id,
      status, primary_channel, campaign_priority, offer_type, price_tier,
      seo_slug, launch_angle, target_persona, asset_plan, meta, updated_at
    )
    VALUES (
      v_row.qualification_catalog_id, v_row.curriculum_id, v_row.id,
      CASE WHEN v_row.launch_status = 'ready' THEN 'queued' ELSE 'planned' END,
      v_row.primary_channel, v_row.campaign_priority, v_row.offer_type,
      v_row.recommended_price_tier,
      lower(replace(regexp_replace(v_row.qualification_catalog_id::text, '[^a-zA-Z0-9]+', '-', 'g'), '--', '-')),
      CASE
        WHEN v_row.primary_channel = 'b2b' THEN 'Betriebsnutzen und Bestehensquote'
        WHEN v_row.primary_channel = 'seo' THEN 'Prüfung bestehen und Vorbereitung strukturieren'
        WHEN v_row.primary_channel = 'affiliate' THEN 'Empfehlbarer Prüfungshelfer'
        ELSE 'Prüfung sicherer bestehen'
      END,
      CASE WHEN v_row.primary_channel = 'b2b' THEN 'Ausbildungsbetrieb / Personalverantwortliche' ELSE 'Prüfungskandidat' END,
      public.default_asset_plan_for_channel(v_row.primary_channel, v_row.offer_type),
      jsonb_build_object('score_snapshot', v_row.score_snapshot, 'recommendations', v_row.recommendations),
      now()
    )
    ON CONFLICT (qualification_catalog_id)
    DO UPDATE SET
      launch_recommendation_id = excluded.launch_recommendation_id,
      status = excluded.status,
      primary_channel = excluded.primary_channel,
      campaign_priority = excluded.campaign_priority,
      offer_type = excluded.offer_type,
      price_tier = excluded.price_tier,
      launch_angle = excluded.launch_angle,
      target_persona = excluded.target_persona,
      asset_plan = excluded.asset_plan,
      meta = public.campaign_launch_plans.meta || excluded.meta,
      updated_at = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'synced', v_count);
END;
$$;

-- 8. ENQUEUE ASSETS FROM PLAN
CREATE OR REPLACE FUNCTION public.enqueue_campaign_assets_from_plan(
  p_launch_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.campaign_launch_plans%ROWTYPE;
  v_asset jsonb;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_plan FROM public.campaign_launch_plans WHERE id = p_launch_plan_id;
  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'launch_plan_not_found');
  END IF;

  FOR v_asset IN SELECT value FROM jsonb_array_elements(coalesce(v_plan.asset_plan, '[]'::jsonb))
  LOOP
    INSERT INTO public.campaign_asset_queue (
      launch_plan_id, qualification_catalog_id, curriculum_id,
      asset_type, asset_key, channel, priority, status, payload
    )
    VALUES (
      v_plan.id, v_plan.qualification_catalog_id, v_plan.curriculum_id,
      v_asset->>'asset_type', v_asset->>'asset_key', v_asset->>'channel',
      v_plan.campaign_priority, 'queued',
      jsonb_build_object(
        'offer_type', v_plan.offer_type, 'price_tier', v_plan.price_tier,
        'launch_angle', v_plan.launch_angle, 'target_persona', v_plan.target_persona
      )
    )
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.campaign_launch_plans SET status = 'in_progress', updated_at = now() WHERE id = p_launch_plan_id;
  RETURN jsonb_build_object('ok', true, 'enqueued_assets', v_count);
END;
$$;

-- 9. CLAIM CAMPAIGN ASSET JOBS
CREATE OR REPLACE FUNCTION public.claim_campaign_asset_jobs(
  p_limit integer DEFAULT 10,
  p_worker_id text DEFAULT 'campaign-asset-worker',
  p_lease_minutes integer DEFAULT 10
)
RETURNS SETOF public.campaign_asset_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.campaign_asset_queue
    WHERE status = 'queued' AND run_after <= now()
    ORDER BY priority DESC, created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.campaign_asset_queue q
    SET status = 'processing',
        attempts = q.attempts + 1,
        lease_owner = p_worker_id,
        lease_until = now() + make_interval(mins => p_lease_minutes),
        updated_at = now()
    WHERE q.id IN (SELECT id FROM picked)
    RETURNING q.*
  )
  SELECT * FROM updated;
END;
$$;

-- RLS
ALTER TABLE public.campaign_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_launch_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_asset_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_performance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.campaign_automation_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.campaign_launch_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.campaign_asset_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.campaign_assets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.campaign_performance_snapshots FOR ALL USING (true) WITH CHECK (true);
