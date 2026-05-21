
-- =============================================================
-- Phase A — SEO Publish Integrity
-- =============================================================

-- ---- 1) Grandfather the 190 legacy published packages -------
UPDATE public.course_packages
SET feature_flags = COALESCE(feature_flags,'{}'::jsonb) || jsonb_build_object('publish_legacy_grandfathered', true)
WHERE status = 'published'
  AND COALESCE(feature_flags->>'publish_legacy_grandfathered','') <> 'true';

-- ---- 2) Register new job_type ------------------------------
INSERT INTO public.ops_job_type_registry (job_type, pool, description, job_name, lane, step_key, is_governance, requires_package_id, is_active)
VALUES (
  'package_seo_pillar_ensure',
  'growth',
  'Idempotent skeleton creation of SEO pillar pages (PF + PV) for a published package. Governance-first: status=reserved, no auto-publish of AI content.',
  'package_seo_pillar_ensure',
  'growth',
  'package_seo_pillar_ensure',
  false,
  true,
  true
) ON CONFLICT (job_type) DO UPDATE SET is_active = true, description = EXCLUDED.description;

-- ---- 3) Step DAG: runs AFTER auto_publish -------------------
INSERT INTO public.step_dag_edges (step_key, depends_on)
VALUES ('package_seo_pillar_ensure', 'auto_publish')
ON CONFLICT DO NOTHING;

-- ---- 4) SSOT view: v_seo_pillars (blog_articles pillar subset)
CREATE OR REPLACE VIEW public.v_seo_pillars AS
SELECT
  ba.id,
  ba.slug,
  ba.title,
  ba.status,
  ba.source_package_id,
  ba.source_curriculum_id,
  CASE
    WHEN ba.slug LIKE 'pruefungsfragen-%-pillar-guide' THEN 'exam_questions'
    WHEN ba.slug LIKE 'pruefungsvorbereitung-%-pillar-guide' THEN 'exam_prep'
    ELSE 'other'
  END AS intent_key,
  ba.target_keyword,
  ba.published_at,
  ba.updated_at,
  ba.word_count,
  ba.internal_links_json,
  ba.faq_json
FROM public.blog_articles ba
WHERE ba.slug LIKE 'pruefungsfragen-%-pillar-guide'
   OR ba.slug LIKE 'pruefungsvorbereitung-%-pillar-guide';

REVOKE ALL ON public.v_seo_pillars FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_seo_pillars TO service_role;

-- ---- 5) Cockpit views ---------------------------------------

-- Published packages missing one or both pillar intents
CREATE OR REPLACE VIEW public.v_published_without_pillar AS
WITH need AS (
  SELECT id AS package_id, title, package_key FROM public.course_packages WHERE status='published'
),
have AS (
  SELECT source_package_id AS package_id,
         bool_or(intent_key='exam_questions') AS has_pf,
         bool_or(intent_key='exam_prep') AS has_pv
  FROM public.v_seo_pillars
  WHERE source_package_id IS NOT NULL
  GROUP BY source_package_id
)
SELECT n.package_id, n.title, n.package_key,
       COALESCE(h.has_pf,false) AS has_pf,
       COALESCE(h.has_pv,false) AS has_pv,
       CASE
         WHEN NOT COALESCE(h.has_pf,false) AND NOT COALESCE(h.has_pv,false) THEN 'MISSING_BOTH'
         WHEN NOT COALESCE(h.has_pf,false) THEN 'MISSING_PF'
         WHEN NOT COALESCE(h.has_pv,false) THEN 'MISSING_PV'
         ELSE 'OK'
       END AS gap_kind
FROM need n
LEFT JOIN have h USING (package_id)
WHERE NOT (COALESCE(h.has_pf,false) AND COALESCE(h.has_pv,false));

REVOKE ALL ON public.v_published_without_pillar FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_published_without_pillar TO service_role;

-- Pillars without a valid published source_package_id
CREATE OR REPLACE VIEW public.v_pillar_orphans AS
SELECT p.id, p.slug, p.intent_key, p.source_package_id, p.status,
       CASE
         WHEN p.source_package_id IS NULL THEN 'NO_SOURCE_PACKAGE'
         WHEN cp.id IS NULL THEN 'SOURCE_PACKAGE_MISSING'
         WHEN cp.status <> 'published' THEN 'SOURCE_PACKAGE_NOT_PUBLISHED'
         ELSE 'OK'
       END AS orphan_reason
FROM public.v_seo_pillars p
LEFT JOIN public.course_packages cp ON cp.id = p.source_package_id
WHERE p.source_package_id IS NULL
   OR cp.id IS NULL
   OR cp.status <> 'published';

REVOKE ALL ON public.v_pillar_orphans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pillar_orphans TO service_role;

-- Duplicate keyword targeting
CREATE OR REPLACE VIEW public.v_duplicate_keyword_targets AS
SELECT lower(target_keyword) AS keyword,
       COUNT(*) AS pillar_count,
       array_agg(slug ORDER BY published_at NULLS LAST) AS slugs
FROM public.v_seo_pillars
WHERE target_keyword IS NOT NULL AND target_keyword <> ''
GROUP BY lower(target_keyword)
HAVING COUNT(*) > 1;

REVOKE ALL ON public.v_duplicate_keyword_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_duplicate_keyword_targets TO service_role;

-- Backlog: reserved/planned/drafting pillars
CREATE OR REPLACE VIEW public.v_pillar_generation_backlog AS
SELECT id, slug, intent_key, status, source_package_id, updated_at,
       EXTRACT(EPOCH FROM (now() - updated_at))/3600 AS hours_in_state
FROM public.v_seo_pillars
WHERE status IN ('reserved','planned','drafting','review_required');

REVOKE ALL ON public.v_pillar_generation_backlog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pillar_generation_backlog TO service_role;

-- Crawlability: published pillars with too few internal links
CREATE OR REPLACE VIEW public.v_pillar_missing_internal_links AS
SELECT id, slug, intent_key, status,
       COALESCE(jsonb_array_length(internal_links_json), 0) AS link_count
FROM public.v_seo_pillars
WHERE status = 'published'
  AND COALESCE(jsonb_array_length(internal_links_json), 0) < 4;

REVOKE ALL ON public.v_pillar_missing_internal_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pillar_missing_internal_links TO service_role;

-- Stale: published pillars older than 180 days
CREATE OR REPLACE VIEW public.v_pillar_content_stale AS
SELECT id, slug, intent_key, published_at, updated_at,
       EXTRACT(DAY FROM (now() - updated_at))::int AS days_since_update
FROM public.v_seo_pillars
WHERE status = 'published'
  AND updated_at < now() - INTERVAL '180 days';

REVOKE ALL ON public.v_pillar_content_stale FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pillar_content_stale TO service_role;

-- ---- 6) Skeleton generator (idempotent) ---------------------
CREATE OR REPLACE FUNCTION public.fn_seo_pillar_ensure_skeleton(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pkg RECORD;
  v_beruf_slug text;
  v_created int := 0;
  v_skipped int := 0;
  v_intent text;
  v_slug text;
  v_title text;
BEGIN
  SELECT id, title, package_key, status, certification_id
    INTO v_pkg
  FROM public.course_packages WHERE id = _package_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','reason','PACKAGE_NOT_FOUND');
  END IF;
  IF v_pkg.status <> 'published' THEN
    RETURN jsonb_build_object('status','skipped','reason','PACKAGE_NOT_PUBLISHED');
  END IF;

  v_beruf_slug := regexp_replace(
    lower(translate(COALESCE(v_pkg.package_key, v_pkg.title), 'äöüÄÖÜß', 'aouAOUs')),
    '[^a-z0-9]+', '-', 'g'
  );
  v_beruf_slug := regexp_replace(v_beruf_slug, '(^-|-$)', '', 'g');

  FOR v_intent IN SELECT unnest(ARRAY['pruefungsfragen','pruefungsvorbereitung']) LOOP
    v_slug := v_intent || '-' || v_beruf_slug || '-pillar-guide';
    v_title := CASE v_intent
      WHEN 'pruefungsfragen' THEN 'Prüfungsfragen ' || v_pkg.title || ' — Pillar Guide'
      ELSE 'Prüfungsvorbereitung ' || v_pkg.title || ' — Pillar Guide'
    END;

    INSERT INTO public.blog_articles (
      slug, title, status, source_package_id, article_type, target_keyword, content_md, meta_description
    )
    VALUES (
      v_slug,
      v_title,
      'reserved',
      _package_id,
      'pillar_guide',
      v_intent || ' ' || v_pkg.title,
      '<!-- SKELETON: awaiting governance approval. Sections: intro, USP, FAQ-slots, CTA-slot, internal links. -->',
      left(v_title, 155)
    )
    ON CONFLICT (slug) DO UPDATE
      SET source_package_id = COALESCE(public.blog_articles.source_package_id, EXCLUDED.source_package_id)
    RETURNING xmax = 0 INTO STRICT v_intent;  -- xmax=0 = inserted

    IF v_intent::text = 'true' THEN v_created := v_created + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'seo_pillar_skeleton_ensured',
    jsonb_build_object('package_id', _package_id, 'created', v_created, 'skipped', v_skipped, 'beruf_slug', v_beruf_slug)
  );
  RETURN jsonb_build_object('status','ok','created',v_created,'skipped',v_skipped,'beruf_slug',v_beruf_slug);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','error','reason',SQLERRM);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_seo_pillar_ensure_skeleton(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seo_pillar_ensure_skeleton(uuid) TO service_role;

-- ---- 7) Admin backfill RPC ----------------------------------
CREATE OR REPLACE FUNCTION public.admin_backfill_pillar_source_package_id(_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_matched int := 0;
  v_unmatched int := 0;
  v_already int := 0;
  r RECORD;
  v_pkg_id uuid;
  v_beruf_token text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: admin role required';
  END IF;

  FOR r IN
    SELECT id, slug, source_package_id FROM public.v_seo_pillars
  LOOP
    IF r.source_package_id IS NOT NULL THEN
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    v_beruf_token := regexp_replace(
      replace(replace(r.slug,'pruefungsfragen-',''),'pruefungsvorbereitung-',''),
      '-pillar-guide$', ''
    );

    SELECT cp.id INTO v_pkg_id
    FROM public.course_packages cp
    WHERE cp.status='published'
      AND (
        regexp_replace(lower(translate(COALESCE(cp.package_key,cp.title),'äöüÄÖÜß','aouAOUs')),'[^a-z0-9]+','-','g') = v_beruf_token
        OR regexp_replace(lower(translate(COALESCE(cp.package_key,cp.title),'äöüÄÖÜß','aouAOUs')),'[^a-z0-9]+','-','g') LIKE '%' || v_beruf_token || '%'
        OR v_beruf_token LIKE '%' || regexp_replace(lower(translate(COALESCE(cp.package_key,cp.title),'äöüÄÖÜß','aouAOUs')),'[^a-z0-9]+','-','g') || '%'
      )
    ORDER BY length(COALESCE(cp.package_key,cp.title)) ASC
    LIMIT 1;

    IF v_pkg_id IS NOT NULL THEN
      v_matched := v_matched + 1;
      IF NOT _dry_run THEN
        UPDATE public.blog_articles SET source_package_id = v_pkg_id, updated_at = now() WHERE id = r.id;
      END IF;
    ELSE
      v_unmatched := v_unmatched + 1;
      IF NOT _dry_run THEN
        PERFORM public.fn_emit_audit(
          'pillar_orphan_detected',
          jsonb_build_object('pillar_id', r.id, 'slug', r.slug, 'beruf_token', v_beruf_token)
        );
      END IF;
    END IF;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'pillar_source_package_backfill',
    jsonb_build_object('dry_run', _dry_run, 'matched', v_matched, 'unmatched', v_unmatched, 'already_set', v_already)
  );

  RETURN jsonb_build_object(
    'dry_run', _dry_run,
    'matched', v_matched,
    'unmatched', v_unmatched,
    'already_set', v_already
  );
END $fn$;

REVOKE ALL ON FUNCTION public.admin_backfill_pillar_source_package_id(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backfill_pillar_source_package_id(boolean) TO authenticated;

-- ---- 8) Trigger: enqueue pillar-ensure on publish -----------
CREATE OR REPLACE FUNCTION public.fn_enqueue_pillar_ensure_on_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status = 'published' AND COALESCE(OLD.status,'') <> 'published' THEN
    INSERT INTO public.job_queue (
      job_type, status, payload, job_name, correlation_id, root_job_id, package_id
    )
    SELECT
      'package_seo_pillar_ensure', 'pending',
      jsonb_build_object('package_id', NEW.id, 'enqueue_source', 'publish_transition'),
      'package_seo_pillar_ensure',
      'pillar_ensure|' || NEW.id::text,
      gen_random_uuid(),
      NEW.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = NEW.id
        AND jq.job_type = 'package_seo_pillar_ensure'
        AND jq.status IN ('pending','queued','processing')
    );
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_enqueue_pillar_ensure_on_publish ON public.course_packages;
CREATE TRIGGER trg_enqueue_pillar_ensure_on_publish
AFTER UPDATE OF status ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.fn_enqueue_pillar_ensure_on_publish();

-- ---- 9) Pre-publish guard: catalog entry required -----------
CREATE OR REPLACE FUNCTION public.fn_guard_publish_requires_catalog_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Only enforce for transitions INTO published from a non-published state
  IF NEW.status = 'published' AND COALESCE(OLD.status,'') <> 'published' THEN
    -- Grandfather legacy packages (set by migration prelude)
    IF COALESCE(NEW.feature_flags->>'publish_legacy_grandfathered','') = 'true' THEN
      RETURN NEW;
    END IF;
    -- Require certification_id
    IF NEW.certification_id IS NULL THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKED_NO_CERTIFICATION_ID: package % has no certification_id', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    -- Require catalog entry
    IF NOT EXISTS (
      SELECT 1 FROM public.certification_catalog cc
      WHERE cc.id = NEW.certification_id OR cc.linked_certification_id = NEW.certification_id
    ) THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKED_NO_CATALOG_ENTRY: certification_id % missing in certification_catalog', NEW.certification_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_guard_publish_requires_catalog_entry ON public.course_packages;
CREATE TRIGGER trg_guard_publish_requires_catalog_entry
BEFORE UPDATE OF status ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_publish_requires_catalog_entry();

-- ---- 10) Admin RPCs for cockpit cards -----------------------
CREATE OR REPLACE FUNCTION public.admin_get_pillar_coverage_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN jsonb_build_object(
    'published_packages', (SELECT COUNT(*) FROM public.course_packages WHERE status='published'),
    'pillars_total', (SELECT COUNT(*) FROM public.v_seo_pillars),
    'pillars_published', (SELECT COUNT(*) FROM public.v_seo_pillars WHERE status='published'),
    'packages_missing_pillars', (SELECT COUNT(*) FROM public.v_published_without_pillar),
    'missing_both', (SELECT COUNT(*) FROM public.v_published_without_pillar WHERE gap_kind='MISSING_BOTH'),
    'missing_pf', (SELECT COUNT(*) FROM public.v_published_without_pillar WHERE gap_kind='MISSING_PF'),
    'missing_pv', (SELECT COUNT(*) FROM public.v_published_without_pillar WHERE gap_kind='MISSING_PV'),
    'orphans', (SELECT COUNT(*) FROM public.v_pillar_orphans),
    'duplicate_keywords', (SELECT COUNT(*) FROM public.v_duplicate_keyword_targets),
    'backlog', (SELECT COUNT(*) FROM public.v_pillar_generation_backlog),
    'stale', (SELECT COUNT(*) FROM public.v_pillar_content_stale),
    'low_internal_links', (SELECT COUNT(*) FROM public.v_pillar_missing_internal_links)
  );
END $fn$;

REVOKE ALL ON FUNCTION public.admin_get_pillar_coverage_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_pillar_coverage_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_published_without_pillar(_limit int DEFAULT 100)
RETURNS SETOF public.v_published_without_pillar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN QUERY SELECT * FROM public.v_published_without_pillar ORDER BY title LIMIT _limit;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_get_published_without_pillar(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_published_without_pillar(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_dispatch_pillar_ensure_for_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  v_result := public.fn_seo_pillar_ensure_skeleton(_package_id);
  PERFORM public.fn_emit_audit(
    'admin_dispatch_pillar_ensure',
    jsonb_build_object('package_id', _package_id, 'result', v_result, 'actor', auth.uid())
  );
  RETURN v_result;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_dispatch_pillar_ensure_for_package(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_pillar_ensure_for_package(uuid) TO authenticated;
