
-- 1. DISTRIBUTION RUNS
CREATE TABLE IF NOT EXISTS public.distribution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  processed_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE OR REPLACE FUNCTION public.trg_validate_distribution_runs_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('running','done','failed') THEN
    RAISE EXCEPTION 'Invalid distribution_runs status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_distribution_runs_status ON public.distribution_runs;
CREATE TRIGGER validate_distribution_runs_status
  BEFORE INSERT OR UPDATE ON public.distribution_runs
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_distribution_runs_status();

-- 2. CHANNEL CONFIGS
CREATE TABLE IF NOT EXISTS public.distribution_channel_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_key text NOT NULL UNIQUE,
  channel_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  target_system text NOT NULL,
  publish_mode text NOT NULL DEFAULT 'queue_only',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_validate_distribution_channel_configs()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel_type NOT IN ('seo','landingpage','email','affiliate','crm','social','ads') THEN
    RAISE EXCEPTION 'Invalid channel_type: %', NEW.channel_type;
  END IF;
  IF NEW.publish_mode NOT IN ('queue_only','draft_publish','direct_publish') THEN
    RAISE EXCEPTION 'Invalid publish_mode: %', NEW.publish_mode;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_distribution_channel_configs ON public.distribution_channel_configs;
CREATE TRIGGER validate_distribution_channel_configs
  BEFORE INSERT OR UPDATE ON public.distribution_channel_configs
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_distribution_channel_configs();

-- 3. DISTRIBUTION TARGETS
CREATE TABLE IF NOT EXISTS public.distribution_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.campaign_assets(id) ON DELETE CASCADE,
  launch_plan_id uuid NOT NULL REFERENCES public.campaign_launch_plans(id) ON DELETE CASCADE,
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  channel_key text NOT NULL,
  target_type text NOT NULL,
  target_identifier text,
  distribution_status text NOT NULL DEFAULT 'planned',
  priority integer NOT NULL DEFAULT 5,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_validate_distribution_targets_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.distribution_status NOT IN ('planned','queued','distributed','published','failed','skipped') THEN
    RAISE EXCEPTION 'Invalid distribution_status: %', NEW.distribution_status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_distribution_targets_status ON public.distribution_targets;
CREATE TRIGGER validate_distribution_targets_status
  BEFORE INSERT OR UPDATE ON public.distribution_targets
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_distribution_targets_status();

CREATE INDEX IF NOT EXISTS idx_distribution_targets_lookup
  ON public.distribution_targets (launch_plan_id, channel_key, distribution_status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_distribution_target_asset_channel
  ON public.distribution_targets (asset_id, channel_key, target_type);

-- 4. DISTRIBUTION QUEUE
CREATE TABLE IF NOT EXISTS public.distribution_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.distribution_targets(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.campaign_assets(id) ON DELETE CASCADE,
  launch_plan_id uuid NOT NULL REFERENCES public.campaign_launch_plans(id) ON DELETE CASCADE,
  channel_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 5,
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

CREATE OR REPLACE FUNCTION public.trg_validate_distribution_queue_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('queued','processing','done','failed','dead','skipped') THEN
    RAISE EXCEPTION 'Invalid distribution_queue status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_distribution_queue_status ON public.distribution_queue;
CREATE TRIGGER validate_distribution_queue_status
  BEFORE INSERT OR UPDATE ON public.distribution_queue
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_distribution_queue_status();

CREATE INDEX IF NOT EXISTS idx_distribution_queue_sched
  ON public.distribution_queue (status, run_after, priority DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_distribution_queue_open
  ON public.distribution_queue (target_id)
  WHERE status IN ('queued','processing','done');

-- 5. PUBLICATIONS
CREATE TABLE IF NOT EXISTS public.distribution_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.distribution_targets(id) ON DELETE CASCADE,
  queue_id uuid REFERENCES public.distribution_queue(id) ON DELETE SET NULL,
  asset_id uuid NOT NULL REFERENCES public.campaign_assets(id) ON DELETE CASCADE,
  channel_key text NOT NULL,
  publication_status text NOT NULL DEFAULT 'draft',
  external_ref text,
  external_url text,
  published_title text,
  published_slug text,
  publication_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  performance_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_validate_distribution_publications_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.publication_status NOT IN ('draft','queued','published','failed','archived') THEN
    RAISE EXCEPTION 'Invalid publication_status: %', NEW.publication_status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_distribution_publications_status ON public.distribution_publications;
CREATE TRIGGER validate_distribution_publications_status
  BEFORE INSERT OR UPDATE ON public.distribution_publications
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_distribution_publications_status();

CREATE INDEX IF NOT EXISTS idx_distribution_publications_lookup
  ON public.distribution_publications (channel_key, publication_status, published_at DESC);

-- 6. DELIVERY LOGS
CREATE TABLE IF NOT EXISTS public.distribution_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid REFERENCES public.distribution_publications(id) ON DELETE CASCADE,
  queue_id uuid REFERENCES public.distribution_queue(id) ON DELETE SET NULL,
  target_id uuid REFERENCES public.distribution_targets(id) ON DELETE SET NULL,
  channel_key text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distribution_delivery_logs_lookup
  ON public.distribution_delivery_logs (channel_key, event_type, created_at DESC);

-- 7. DEFAULT CHANNEL CONFIGS
INSERT INTO public.distribution_channel_configs (channel_key, channel_type, target_system, publish_mode, config)
VALUES
  ('seo_blog', 'seo', 'content_pages', 'draft_publish', '{}'::jsonb),
  ('landing_pages', 'landingpage', 'content_pages', 'draft_publish', '{}'::jsonb),
  ('email_sequences', 'email', 'campaign_assets', 'queue_only', '{}'::jsonb),
  ('affiliate_portal', 'affiliate', 'campaign_assets', 'queue_only', '{}'::jsonb),
  ('crm_outreach', 'crm', 'campaign_assets', 'queue_only', '{}'::jsonb),
  ('social_queue', 'social', 'campaign_assets', 'queue_only', '{}'::jsonb)
ON CONFLICT (channel_key) DO NOTHING;

-- 8. HELPER: TARGETS FROM ASSET TYPE
CREATE OR REPLACE FUNCTION public.default_distribution_target_for_asset(
  p_asset_type text,
  p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_channel = 'seo' THEN
    RETURN jsonb_build_object('channel_key','seo_blog','target_type','content_page');
  ELSIF p_channel = 'b2c' THEN
    RETURN jsonb_build_object('channel_key','landing_pages','target_type','landing_page');
  ELSIF p_channel = 'email' THEN
    RETURN jsonb_build_object('channel_key','email_sequences','target_type','email_sequence');
  ELSIF p_channel = 'affiliate' THEN
    RETURN jsonb_build_object('channel_key','affiliate_portal','target_type','affiliate_asset');
  ELSIF p_channel = 'b2b' THEN
    RETURN jsonb_build_object('channel_key','crm_outreach','target_type','crm_asset');
  ELSE
    RETURN jsonb_build_object('channel_key','social_queue','target_type','social_asset');
  END IF;
END;
$$;

-- 9. SYNC TARGETS FROM ASSETS
CREATE OR REPLACE FUNCTION public.sync_distribution_targets_from_assets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_target jsonb;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT ca.* FROM public.campaign_assets ca
    WHERE ca.publication_status IN ('draft','ready')
  LOOP
    v_target := public.default_distribution_target_for_asset(v_row.asset_type, v_row.channel);

    INSERT INTO public.distribution_targets (
      asset_id, launch_plan_id, qualification_catalog_id, curriculum_id,
      channel_key, target_type, target_identifier, distribution_status,
      priority, payload, updated_at
    )
    VALUES (
      v_row.id, v_row.launch_plan_id, v_row.qualification_catalog_id, v_row.curriculum_id,
      v_target->>'channel_key', v_target->>'target_type', v_row.slug,
      'planned', 5,
      jsonb_build_object('asset_type', v_row.asset_type, 'asset_key', v_row.asset_key, 'title', v_row.title, 'slug', v_row.slug),
      now()
    )
    ON CONFLICT (asset_id, channel_key, target_type)
    DO UPDATE SET payload = excluded.payload, updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'synced_targets', v_count);
END;
$$;

-- 10. ENQUEUE DISTRIBUTION TARGETS
CREATE OR REPLACE FUNCTION public.enqueue_distribution_targets()
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
    SELECT dt.* FROM public.distribution_targets dt WHERE dt.distribution_status = 'planned'
  LOOP
    INSERT INTO public.distribution_queue (
      target_id, asset_id, launch_plan_id, channel_key, status, priority, payload
    )
    VALUES (
      v_row.id, v_row.asset_id, v_row.launch_plan_id, v_row.channel_key,
      'queued', v_row.priority, v_row.payload
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.distribution_targets SET distribution_status = 'queued', updated_at = now() WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'enqueued', v_count);
END;
$$;

-- 11. CLAIM DISTRIBUTION JOBS
CREATE OR REPLACE FUNCTION public.claim_distribution_jobs(
  p_limit integer DEFAULT 10,
  p_worker_id text DEFAULT 'distribution-worker',
  p_lease_minutes integer DEFAULT 10
)
RETURNS SETOF public.distribution_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.distribution_queue
    WHERE status = 'queued' AND run_after <= now()
    ORDER BY priority DESC, created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.distribution_queue q
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
ALTER TABLE public.distribution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribution_channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribution_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribution_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribution_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribution_delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.distribution_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.distribution_channel_configs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.distribution_targets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.distribution_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.distribution_publications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.distribution_delivery_logs FOR ALL USING (true) WITH CHECK (true);
