-- =========================================================================
-- P20 Cut 2 — GIL RSS / Web Collector
-- =========================================================================

-- ---------- Enable rss source ----------------------------------------------
UPDATE public.gil_signal_sources
   SET enabled = true,
       label = 'RSS / Atom Collector',
       notes = 'P20 Cut 2 — review-first. Items land in gil_signal_intake (status=pending).',
       updated_at = now()
 WHERE source_key = 'rss';

-- ---------- Feeds registry --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gil_rss_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_url text NOT NULL,
  label text NOT NULL,
  category text,
  default_signal_type text NOT NULL DEFAULT 'press_mention',
  default_severity text NOT NULL DEFAULT 'info' CHECK (default_severity IN ('info','warning','critical')),
  tags text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT chk_gil_rss_feeds_url_https CHECK (feed_url ~* '^https?://'),
  CONSTRAINT chk_gil_rss_feeds_label CHECK (length(trim(label)) >= 2),
  CONSTRAINT uq_gil_rss_feeds_url UNIQUE (feed_url)
);

CREATE INDEX IF NOT EXISTS idx_gil_rss_feeds_enabled
  ON public.gil_rss_feeds (enabled) WHERE enabled = true;

ALTER TABLE public.gil_rss_feeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gil_rss_feeds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.gil_rss_feeds TO service_role;

DROP POLICY IF EXISTS gil_rss_feeds_admin_read ON public.gil_rss_feeds;
CREATE POLICY gil_rss_feeds_admin_read ON public.gil_rss_feeds
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Block private/localhost feed URLs at DB layer (defense-in-depth).
CREATE OR REPLACE FUNCTION public.fn_guard_gil_rss_feed_url_safe()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_host text;
BEGIN
  v_host := lower(coalesce((regexp_match(NEW.feed_url, '^https?://([^/:?#]+)'))[1], ''));
  IF v_host = '' THEN
    RAISE EXCEPTION 'feed_url has no host';
  END IF;
  IF v_host IN ('localhost','0.0.0.0','::1')
     OR v_host LIKE '%.local'
     OR v_host LIKE '%.localhost'
     OR v_host ~ '^127\.'
     OR v_host ~ '^10\.'
     OR v_host ~ '^192\.168\.'
     OR v_host ~ '^169\.254\.'
     OR v_host ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
     OR v_host ~ '^0\.' THEN
    RAISE EXCEPTION 'feed_url host % is not a public address', v_host;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_gil_rss_feed_url_safe ON public.gil_rss_feeds;
CREATE TRIGGER trg_guard_gil_rss_feed_url_safe
  BEFORE INSERT OR UPDATE OF feed_url ON public.gil_rss_feeds
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_gil_rss_feed_url_safe();

-- ---------- Audit contracts -------------------------------------------------
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('gil_rss_collector_run',
     ARRAY['scanned_sources','fetched_items','inserted','skipped_duplicate','failed_sources','reason'],
     'p20.gil_collector.rss'),
  ('gil_rss_item_intaked',
     ARRAY['feed_id','intake_id','fingerprint'],
     'p20.gil_collector.rss'),
  ('gil_rss_source_failed',
     ARRAY['feed_id','feed_url','error'],
     'p20.gil_collector.rss')
ON CONFLICT (action_type) DO NOTHING;

-- ---------- RPC: list feeds (admin) -----------------------------------------
CREATE OR REPLACE FUNCTION public.admin_gil_list_rss_feeds()
RETURNS TABLE (
  id uuid,
  feed_url text,
  label text,
  category text,
  default_signal_type text,
  default_severity text,
  tags text[],
  enabled boolean,
  last_run_at timestamptz,
  last_run_result jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.id, f.feed_url, f.label, f.category,
         f.default_signal_type, f.default_severity, f.tags,
         f.enabled, f.last_run_at, f.last_run_result, f.created_at
  FROM public.gil_rss_feeds f
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY f.enabled DESC, f.label;
$$;
REVOKE ALL ON FUNCTION public.admin_gil_list_rss_feeds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gil_list_rss_feeds() TO authenticated;

-- ---------- RPC: add feed (admin) -------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_gil_add_rss_feed(
  p_feed_url text,
  p_label text,
  p_category text,
  p_default_signal_type text,
  p_tags text[],
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_allowed text[];
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF coalesce(length(trim(p_reason)), 0) < 8 THEN
    RAISE EXCEPTION 'reason must be at least 8 characters';
  END IF;
  SELECT s.allowed_signal_types INTO v_allowed
    FROM public.gil_signal_sources s WHERE s.source_key = 'rss';
  IF NOT (p_default_signal_type = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'default_signal_type % not allowed for rss source', p_default_signal_type;
  END IF;
  INSERT INTO public.gil_rss_feeds (feed_url, label, category, default_signal_type, tags, created_by)
  VALUES (trim(p_feed_url), trim(p_label), nullif(trim(p_category), ''), p_default_signal_type,
          coalesce(p_tags, '{}'::text[]), v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_gil_add_rss_feed(text,text,text,text,text[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gil_add_rss_feed(text,text,text,text,text[],text) TO authenticated;

-- ---------- RPC: toggle feed enabled (admin) --------------------------------
CREATE OR REPLACE FUNCTION public.admin_gil_set_rss_feed_enabled(
  p_feed_id uuid,
  p_enabled boolean,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF coalesce(length(trim(p_reason)), 0) < 8 THEN
    RAISE EXCEPTION 'reason must be at least 8 characters';
  END IF;
  UPDATE public.gil_rss_feeds
     SET enabled = p_enabled, updated_at = now()
   WHERE id = p_feed_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_gil_set_rss_feed_enabled(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gil_set_rss_feed_enabled(uuid,boolean,text) TO authenticated;
