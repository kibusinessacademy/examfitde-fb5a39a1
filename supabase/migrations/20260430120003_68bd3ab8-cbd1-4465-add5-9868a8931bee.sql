-- =================================================================
-- 1) STAMMDATEN: product_pricing_tiers
-- =================================================================
CREATE TABLE IF NOT EXISTS public.product_pricing_tiers (
  tier_key            text PRIMARY KEY,
  display_name        text NOT NULL,
  price_cents         integer NOT NULL CHECK (price_cents >= 0),
  currency            text NOT NULL DEFAULT 'EUR',
  access_months       integer NOT NULL DEFAULT 12,
  billing_type        text NOT NULL DEFAULT 'one_time',
  match_patterns      text[] NOT NULL DEFAULT '{}',  -- regex / ILIKE patterns gegen certification.title
  exclude_patterns    text[] NOT NULL DEFAULT '{}',
  priority            integer NOT NULL DEFAULT 100,  -- niedriger = wird zuerst geprüft
  description         text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_pricing_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tiers_admin_read" ON public.product_pricing_tiers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tiers_admin_write" ON public.product_pricing_tiers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed Tiers (ON CONFLICT DO NOTHING — idempotent)
INSERT INTO public.product_pricing_tiers
  (tier_key, display_name, price_cents, priority, match_patterns, exclude_patterns, description)
VALUES
  ('ihk_fortbildung_premium', 'IHK Fortbildung Premium (49,90 €)', 4990, 10,
   ARRAY['betriebswirt','bilanzbuchhalter','wirtschaftsfachwirt','industriemeister'],
   ARRAY[]::text[],
   'Hohe Prüfungstiefe: Geprüfte Betriebswirte, Bilanzbuchhalter, Meister, Wirtschaftsfachwirt'),
  ('ihk_fortbildung_standard', 'IHK Fortbildung Standard (39,90 €)', 3990, 20,
   ARRAY['fachwirt','fachkaufmann','fachkauffrau','meister','aevo','ausbildereignung','personalfachkaufmann'],
   ARRAY['betriebswirt','bilanzbuchhalter','industriemeister','wirtschaftsfachwirt'],
   'IHK-Fortbildung mittlere Tiefe: Fachwirte, Fachkaufleute, AEVO'),
  ('sachkunde_kompakt', 'Sachkunde / kompakte Prüfung (29,90 €)', 2990, 30,
   ARRAY['sachkunde','§\s*34','sachkundepr','bewachungsgewerbe','immobilienmakler','wohnimmobilienverwalter','immobiliardarlehen'],
   ARRAY[]::text[],
   'Kompakte Sachkunde-/§34-Prüfungen'),
  ('studium_zertifikat', 'Studium / IT-Zertifikat (24,90 €)', 2490, 40,
   ARRAY['scrum','prince2','aws','itil','pmp','cissp','azure','google cloud','wirtschaftsingenieur','informatik','bachelor','master','b\.\s*sc','m\.\s*sc'],
   ARRAY[]::text[],
   'Studium-Module und IT-Zertifizierungen — im Dry-Run 24,90 €, per Override anpassbar'),
  ('ihk_ausbildung_standard', 'IHK Erstausbildung (24,90 €)', 2490, 90,
   ARRAY[]::text[],
   ARRAY[]::text[],
   'Default-Tier: Duale IHK-Erstausbildung. Greift wenn kein anderer Tier matched.')
ON CONFLICT (tier_key) DO NOTHING;

-- =================================================================
-- 2) OVERRIDES: pro Package
-- =================================================================
CREATE TABLE IF NOT EXISTS public.product_pricing_overrides (
  package_id          uuid PRIMARY KEY REFERENCES public.course_packages(id) ON DELETE CASCADE,
  forced_tier         text REFERENCES public.product_pricing_tiers(tier_key),
  forced_price_cents  integer CHECK (forced_price_cents IS NULL OR forced_price_cents >= 0),
  forced_action       text CHECK (forced_action IN ('none','create_product_and_price','create_price_only','manual_review','skip')),
  note                text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_pricing_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "overrides_admin_read" ON public.product_pricing_overrides
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "overrides_admin_write" ON public.product_pricing_overrides
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_product_pricing_overrides_updated_at ON public.product_pricing_overrides;
CREATE TRIGGER trg_product_pricing_overrides_updated_at
  BEFORE UPDATE ON public.product_pricing_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_product_pricing_tiers_updated_at ON public.product_pricing_tiers;
CREATE TRIGGER trg_product_pricing_tiers_updated_at
  BEFORE UPDATE ON public.product_pricing_tiers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =================================================================
-- 3) KLASSIFIKATOR-FUNKTION
-- =================================================================
CREATE OR REPLACE FUNCTION public.classify_package_pricing_tier(p_title text)
RETURNS TABLE (
  tier_key      text,
  price_cents   integer,
  confidence    text,   -- 'high' | 'medium' | 'low' | 'none'
  reason        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title_lc text := lower(coalesce(p_title,''));
  v_tier RECORD;
  v_pat  text;
  v_excl text;
  v_excluded boolean;
BEGIN
  IF v_title_lc = '' THEN
    RETURN QUERY SELECT NULL::text, NULL::int, 'none'::text, 'empty_title'::text;
    RETURN;
  END IF;

  FOR v_tier IN
    SELECT t.tier_key, t.price_cents, t.match_patterns, t.exclude_patterns, t.priority
      FROM product_pricing_tiers t
     WHERE t.is_active = true
     ORDER BY t.priority ASC, t.tier_key ASC
  LOOP
    -- exclude check
    v_excluded := false;
    IF array_length(v_tier.exclude_patterns,1) > 0 THEN
      FOREACH v_excl IN ARRAY v_tier.exclude_patterns LOOP
        IF v_title_lc ~* v_excl THEN
          v_excluded := true; EXIT;
        END IF;
      END LOOP;
    END IF;
    IF v_excluded THEN CONTINUE; END IF;

    -- match check
    IF array_length(v_tier.match_patterns,1) > 0 THEN
      FOREACH v_pat IN ARRAY v_tier.match_patterns LOOP
        IF v_title_lc ~* v_pat THEN
          RETURN QUERY SELECT 
            v_tier.tier_key,
            v_tier.price_cents,
            'high'::text,
            format('matched pattern "%s" in tier "%s"', v_pat, v_tier.tier_key);
          RETURN;
        END IF;
      END LOOP;
    ELSE
      -- Tier ohne Patterns = Default-Fallback
      RETURN QUERY SELECT 
        v_tier.tier_key,
        v_tier.price_cents,
        'low'::text,
        format('default fallback tier "%s" (no patterns matched)', v_tier.tier_key);
      RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT NULL::text, NULL::int, 'none'::text, 'no_tier_matched'::text;
END;
$$;

-- =================================================================
-- 4) DRY-RUN VIEW
-- =================================================================
CREATE OR REPLACE VIEW public.v_pricing_backfill_dryrun AS
WITH base AS (
  SELECT 
    cp.id           AS package_id,
    cp.title        AS package_title,
    cp.status       AS package_status,
    cp.certification_id,
    c.title         AS certification_title,
    -- existing product (via active_package_id reverse)
    (SELECT p.id FROM products p WHERE p.active_package_id = cp.id LIMIT 1) AS existing_product_id,
    -- existing product via certification (fallback)
    (SELECT p.id FROM products p WHERE p.certification_id = cp.certification_id LIMIT 1) AS cert_product_id
  FROM course_packages cp
  LEFT JOIN certifications c ON c.id = cp.certification_id
  WHERE cp.status = 'published'
),
classified AS (
  SELECT b.*,
         cls.tier_key   AS auto_tier,
         cls.price_cents AS auto_price_cents,
         cls.confidence AS auto_confidence,
         cls.reason     AS auto_reason
    FROM base b
    LEFT JOIN LATERAL public.classify_package_pricing_tier(b.certification_title) cls ON true
),
merged AS (
  SELECT 
    cf.*,
    o.forced_tier,
    o.forced_price_cents,
    o.forced_action,
    o.note AS override_note,
    -- final tier resolution: override > auto
    COALESCE(o.forced_tier, cf.auto_tier) AS suggested_tier,
    COALESCE(
      o.forced_price_cents,
      (SELECT t.price_cents FROM product_pricing_tiers t WHERE t.tier_key = o.forced_tier),
      cf.auto_price_cents
    ) AS suggested_price_cents,
    CASE 
      WHEN o.forced_tier IS NOT NULL OR o.forced_price_cents IS NOT NULL THEN 'override'
      ELSE cf.auto_confidence
    END AS confidence,
    CASE 
      WHEN o.forced_tier IS NOT NULL OR o.forced_price_cents IS NOT NULL 
        THEN 'manual override: ' || COALESCE(o.note,'(no note)')
      ELSE cf.auto_reason
    END AS reason,
    -- existing active price (if any product is linked)
    (SELECT pp.id FROM product_prices pp 
       WHERE pp.product_id = COALESCE(cf.existing_product_id, cf.cert_product_id) 
         AND pp.active = true 
       LIMIT 1) AS existing_active_price_id
  FROM classified cf
  LEFT JOIN product_pricing_overrides o ON o.package_id = cf.package_id
)
SELECT 
  package_id,
  package_title,
  package_status,
  certification_id,
  certification_title,
  suggested_tier,
  suggested_price_cents,
  confidence,
  reason,
  forced_tier,
  forced_price_cents,
  override_note,
  existing_product_id,
  cert_product_id,
  existing_active_price_id,
  -- ACTION RESOLUTION
  CASE
    WHEN forced_action = 'skip'                       THEN 'skip'
    WHEN forced_action IS NOT NULL                    THEN forced_action
    WHEN suggested_tier IS NULL                       THEN 'manual_review'
    WHEN existing_active_price_id IS NOT NULL        THEN 'none'
    WHEN COALESCE(existing_product_id, cert_product_id) IS NOT NULL 
         AND existing_active_price_id IS NULL         THEN 'create_price_only'
    WHEN existing_product_id IS NULL 
         AND cert_product_id IS NULL                  THEN 'create_product_and_price'
    WHEN confidence = 'low'                           THEN 'manual_review'
    ELSE 'manual_review'
  END AS action_needed
FROM merged
ORDER BY 
  CASE 
    WHEN confidence = 'none' THEN 1
    WHEN confidence = 'low'  THEN 2
    ELSE 3 
  END,
  package_title;

-- View ist auf authenticated lesbar via underlying RLS (course_packages, etc.)
GRANT SELECT ON public.v_pricing_backfill_dryrun TO authenticated;

-- =================================================================
-- 5) PREVIEW RPC
-- =================================================================
CREATE OR REPLACE FUNCTION public.admin_pricing_backfill_preview()
RETURNS TABLE (
  summary jsonb,
  rows    jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  RETURN QUERY
  WITH d AS (SELECT * FROM public.v_pricing_backfill_dryrun)
  SELECT
    jsonb_build_object(
      'total_published_no_price', (SELECT count(*) FROM d WHERE existing_active_price_id IS NULL),
      'total_already_priced',     (SELECT count(*) FROM d WHERE existing_active_price_id IS NOT NULL),
      'by_action', (
        SELECT jsonb_object_agg(action_needed, c) 
        FROM (SELECT action_needed, count(*) c FROM d GROUP BY action_needed) s
      ),
      'by_tier', (
        SELECT jsonb_object_agg(COALESCE(suggested_tier,'(none)'), c) 
        FROM (SELECT suggested_tier, count(*) c FROM d GROUP BY suggested_tier) s
      ),
      'by_confidence', (
        SELECT jsonb_object_agg(confidence, c) 
        FROM (SELECT confidence, count(*) c FROM d GROUP BY confidence) s
      ),
      'generated_at', now()
    ) AS summary,
    (SELECT jsonb_agg(to_jsonb(d.*) ORDER BY 
        CASE confidence WHEN 'none' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, 
        package_title) FROM d) AS rows;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pricing_backfill_preview() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_pricing_backfill_preview() TO authenticated;