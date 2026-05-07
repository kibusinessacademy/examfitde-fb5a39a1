-- ============================================================================
-- Growth OS Phase 2A: Keyword SSOT Registry
-- Concern: Single-owner ownership for every targeted keyword_slug.
-- Companion guard: scripts/guards/seo-cannibalization-guard.mjs
-- Rollback hint: DROP TABLE public.growth_keyword_registry CASCADE;
--                DROP FUNCTION admin_register_keyword, admin_check_keyword_conflict,
--                              admin_get_keyword_registry_summary, fn_slugify_keyword;
-- ============================================================================

-- 1. Helper: deterministic slug
CREATE OR REPLACE FUNCTION public.fn_slugify_keyword(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(both '-' from
    regexp_replace(
      regexp_replace(
        lower(coalesce(p_text, '')),
        '[äÄ]', 'ae', 'g'
      ),
      '[^a-z0-9]+', '-', 'g'
    )
  )
$$;

-- 2. Registry table — SSOT for keyword ownership
CREATE TABLE IF NOT EXISTS public.growth_keyword_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_slug    text NOT NULL,
  keyword_text    text NOT NULL,
  persona         text NOT NULL CHECK (persona IN ('azubi','betrieb','institution','generic')),
  funnel_stage    text NOT NULL CHECK (funnel_stage IN ('awareness','problem','comparison','exam_prep','purchase','retention','b2b','institutional')),
  canonical_intent text NOT NULL CHECK (canonical_intent IN ('informational','navigational','transactional','commercial','definition','comparison','programmatic')),
  cluster_id      uuid REFERENCES public.seo_keyword_clusters(id) ON DELETE SET NULL,
  owner_kind      text NOT NULL CHECK (owner_kind IN ('blog_article','seo_content_page','certification_seo_page','product_landing','money_page','reserved','other')),
  owner_id        uuid,
  owner_url       text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','reserved')),
  notes           text,
  registered_by   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Hard SSOT: a keyword_slug has at most ONE active owner
CREATE UNIQUE INDEX IF NOT EXISTS ux_growth_keyword_registry_slug_active
  ON public.growth_keyword_registry (keyword_slug)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_growth_keyword_registry_persona_funnel
  ON public.growth_keyword_registry (persona, funnel_stage);
CREATE INDEX IF NOT EXISTS ix_growth_keyword_registry_owner
  ON public.growth_keyword_registry (owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS ix_growth_keyword_registry_cluster
  ON public.growth_keyword_registry (cluster_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.fn_growth_keyword_registry_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_growth_keyword_registry_touch ON public.growth_keyword_registry;
CREATE TRIGGER trg_growth_keyword_registry_touch
  BEFORE UPDATE ON public.growth_keyword_registry
  FOR EACH ROW EXECUTE FUNCTION public.fn_growth_keyword_registry_touch();

-- 3. RLS: locked down. Reads + writes only via SECURITY DEFINER admin RPCs.
ALTER TABLE public.growth_keyword_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_keyword_registry FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.growth_keyword_registry TO service_role;

-- 4. Conflict check RPC — read-only, admin-gated
CREATE OR REPLACE FUNCTION public.admin_check_keyword_conflict(
  p_keyword text
)
RETURNS TABLE (
  conflict        boolean,
  existing_id     uuid,
  existing_slug   text,
  existing_owner  text,
  existing_url    text,
  existing_status text,
  registered_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text := public.fn_slugify_keyword(p_keyword);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    true,
    r.id,
    r.keyword_slug,
    r.owner_kind || COALESCE(':' || r.owner_id::text, ''),
    r.owner_url,
    r.status,
    r.created_at
  FROM public.growth_keyword_registry r
  WHERE r.keyword_slug = v_slug
    AND r.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, v_slug, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_check_keyword_conflict(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_check_keyword_conflict(text) TO authenticated;

-- 5. Register RPC — admin only, raises on conflict, audits to auto_heal_log
CREATE OR REPLACE FUNCTION public.admin_register_keyword(
  p_keyword          text,
  p_persona          text,
  p_funnel_stage     text,
  p_canonical_intent text,
  p_owner_kind       text,
  p_owner_id         uuid DEFAULT NULL,
  p_owner_url        text DEFAULT NULL,
  p_cluster_id       uuid DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_force_takeover   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text := public.fn_slugify_keyword(p_keyword);
  v_existing public.growth_keyword_registry;
  v_new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF v_slug IS NULL OR length(v_slug) = 0 THEN
    RAISE EXCEPTION 'invalid keyword: empty after slugify';
  END IF;

  SELECT * INTO v_existing
  FROM public.growth_keyword_registry
  WHERE keyword_slug = v_slug AND status = 'active'
  LIMIT 1;

  IF FOUND AND NOT p_force_takeover THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'keyword_already_owned',
      'existing_id', v_existing.id,
      'existing_owner_kind', v_existing.owner_kind,
      'existing_owner_id', v_existing.owner_id,
      'existing_url', v_existing.owner_url
    );
  END IF;

  IF FOUND AND p_force_takeover THEN
    UPDATE public.growth_keyword_registry
       SET status = 'deprecated', notes = COALESCE(notes, '') || ' | takeover by ' || coalesce(auth.uid()::text,'system') || ' at ' || now()::text
     WHERE id = v_existing.id;
  END IF;

  INSERT INTO public.growth_keyword_registry (
    keyword_slug, keyword_text, persona, funnel_stage, canonical_intent,
    cluster_id, owner_kind, owner_id, owner_url, notes, registered_by
  ) VALUES (
    v_slug, p_keyword, p_persona, p_funnel_stage, p_canonical_intent,
    p_cluster_id, p_owner_kind, p_owner_id, p_owner_url, p_notes, auth.uid()
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, meta)
  VALUES (
    'growth_keyword_registered',
    'keyword',
    v_new_id::text,
    'success',
    jsonb_build_object(
      'keyword_slug', v_slug,
      'persona', p_persona,
      'funnel_stage', p_funnel_stage,
      'owner_kind', p_owner_kind,
      'owner_id', p_owner_id,
      'force_takeover', p_force_takeover,
      'previous_owner_id', v_existing.id
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_new_id, 'keyword_slug', v_slug);
END $$;

REVOKE ALL ON FUNCTION public.admin_register_keyword(text,text,text,text,text,uuid,text,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_keyword(text,text,text,text,text,uuid,text,uuid,text,boolean) TO authenticated;

-- 6. Summary RPC — counts per persona × funnel_stage
CREATE OR REPLACE FUNCTION public.admin_get_keyword_registry_summary()
RETURNS TABLE (
  persona        text,
  funnel_stage   text,
  active_count   bigint,
  deprecated_count bigint,
  reserved_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    r.persona,
    r.funnel_stage,
    COUNT(*) FILTER (WHERE r.status = 'active'),
    COUNT(*) FILTER (WHERE r.status = 'deprecated'),
    COUNT(*) FILTER (WHERE r.status = 'reserved')
  FROM public.growth_keyword_registry r
  GROUP BY r.persona, r.funnel_stage
  ORDER BY r.persona, r.funnel_stage;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_keyword_registry_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_keyword_registry_summary() TO authenticated;

-- ============================================================================
-- Smoke test (run manually after migration):
--   SELECT public.fn_slugify_keyword('Bankfachwirt IHK Prüfung');
--     -> 'bankfachwirt-ihk-pruefung'
--   SELECT public.admin_check_keyword_conflict('Bankfachwirt IHK Prüfung');
--     -> conflict=false (initially)
-- ============================================================================