
-- =====================================================================
-- Track 2.3a — Canonical Drift Runbook (diagnose-only)
-- =====================================================================

CREATE OR REPLACE VIEW public.v_canonical_drift_classification_v1 AS
WITH published_pkgs AS (
  SELECT cp.id AS package_id, cp.package_key, cp.title,
         cp.status AS pkg_status, cp.is_published
  FROM course_packages cp
  WHERE cp.status = 'published' AND COALESCE(cp.is_published, false) = true
),
pkg_pages AS (
  SELECT pp.package_id, pp.package_key, pp.title,
         p.id AS page_id, p.slug, p.persona_type, p.status AS page_status,
         p.last_canonical_check, p.canonical_check_status
  FROM published_pkgs pp
  LEFT JOIN seo_content_pages p ON p.package_id = pp.package_id
),
dup_slugs AS (
  SELECT slug, count(DISTINCT package_id) AS pkg_count
  FROM seo_content_pages
  WHERE slug IS NOT NULL AND status = 'published'
  GROUP BY slug
  HAVING count(DISTINCT package_id) > 1
)
SELECT
  pp.package_id,
  pp.package_key,
  pp.title AS package_title,
  pp.page_id,
  pp.slug,
  pp.persona_type,
  pp.page_status,
  pp.last_canonical_check,
  pp.canonical_check_status,
  CASE
    WHEN pp.page_id IS NULL                                    THEN 'MISSING_CANONICAL'
    WHEN pp.page_status = 'published'
         AND ds.slug IS NOT NULL                               THEN 'DUPLICATE_CANONICAL'
    WHEN pp.page_status = 'published'
         AND pp.last_canonical_check IS NULL                   THEN 'NEVER_CHECKED'
    WHEN pp.page_status = 'published'
         AND pp.last_canonical_check < (now() - interval '24h')THEN 'STALE_ARTIFACT'
    WHEN pp.page_status = 'published'
         AND pp.canonical_check_status IS NOT NULL
         AND pp.canonical_check_status <> 'ok'                 THEN 'ROUTE_MISMATCH'
    WHEN pp.page_status IS DISTINCT FROM 'published'           THEN 'DRAFT_BUT_PKG_LIVE'
    ELSE 'OK'
  END AS drift_cause,
  CASE
    WHEN pp.page_id IS NULL THEN 'critical'
    WHEN pp.page_status = 'published' AND ds.slug IS NOT NULL THEN 'critical'
    WHEN pp.page_status = 'published' AND pp.canonical_check_status NOT IN ('ok') THEN 'warn'
    WHEN pp.page_status IS DISTINCT FROM 'published' THEN 'warn'
    WHEN pp.page_status = 'published' AND pp.last_canonical_check IS NULL THEN 'warn'
    WHEN pp.page_status = 'published' AND pp.last_canonical_check < now() - interval '24h' THEN 'info'
    ELSE 'ok'
  END AS severity,
  CASE
    WHEN pp.page_id IS NULL THEN 'platform'           -- platform fix (seed pages)
    WHEN ds.slug IS NOT NULL THEN 'platform'          -- dedupe canonical
    WHEN pp.canonical_check_status NOT IN ('ok') THEN 'package'
    WHEN pp.page_status IS DISTINCT FROM 'published' THEN 'package'
    ELSE 'platform'
  END AS fix_scope
FROM pkg_pages pp
LEFT JOIN dup_slugs ds ON ds.slug = pp.slug;

REVOKE ALL ON public.v_canonical_drift_classification_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_canonical_drift_classification_v1 TO service_role;

-- Summary RPC
CREATE OR REPLACE FUNCTION public.admin_get_canonical_drift_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (v_uid IS NOT NULL AND has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'total_published_packages',
      (SELECT count(DISTINCT package_id) FROM v_canonical_drift_classification_v1),
    'by_cause',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'drift_cause', drift_cause,
          'severity', severity,
          'fix_scope', fix_scope,
          'package_count', cnt
        ) ORDER BY cnt DESC)
        FROM (
          SELECT drift_cause, severity, fix_scope, count(DISTINCT package_id) AS cnt
          FROM v_canonical_drift_classification_v1
          GROUP BY 1,2,3
        ) s
      ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_canonical_drift_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_canonical_drift_summary() TO authenticated;

-- Drill-down RPC
CREATE OR REPLACE FUNCTION public.admin_get_canonical_drift_packages(
  _cause text DEFAULT NULL,
  _severity text DEFAULT NULL,
  _limit int DEFAULT 100
)
RETURNS TABLE(
  package_id uuid,
  package_key text,
  package_title text,
  page_id uuid,
  slug text,
  persona_type text,
  page_status text,
  drift_cause text,
  severity text,
  fix_scope text,
  last_canonical_check timestamptz,
  canonical_check_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (v_uid IS NOT NULL AND has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT v.package_id, v.package_key, v.package_title, v.page_id, v.slug,
         v.persona_type, v.page_status, v.drift_cause, v.severity, v.fix_scope,
         v.last_canonical_check, v.canonical_check_status
  FROM v_canonical_drift_classification_v1 v
  WHERE (_cause    IS NULL OR v.drift_cause = _cause)
    AND (_severity IS NULL OR v.severity    = _severity)
  ORDER BY (CASE v.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 WHEN 'info' THEN 2 ELSE 3 END),
           v.package_key NULLS LAST
  LIMIT GREATEST(_limit, 1);
END $$;

REVOKE ALL ON FUNCTION public.admin_get_canonical_drift_packages(text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_canonical_drift_packages(text,text,int) TO authenticated;


-- =====================================================================
-- Track 2.3b — Attribution Propagation
-- =====================================================================

-- Registry of event types that require a package context.
CREATE TABLE IF NOT EXISTS public.conversion_event_attribution_policy (
  event_type text PRIMARY KEY,
  requires_package boolean NOT NULL DEFAULT true,
  strict boolean NOT NULL DEFAULT false,
  scope text NOT NULL DEFAULT 'package',  -- 'package' | 'global' | 'page'
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.conversion_event_attribution_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_admin_read" ON public.conversion_event_attribution_policy;
CREATE POLICY "policy_admin_read"
  ON public.conversion_event_attribution_policy
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Seed policy (idempotent)
INSERT INTO public.conversion_event_attribution_policy (event_type, requires_package, strict, scope, notes) VALUES
  ('quiz_started',             true,  false, 'package', 'strict event — package_id required (bridged via quizBundleMap)'),
  ('quiz_completed',           true,  false, 'package', 'strict event'),
  ('lead_capture_submitted',   true,  false, 'package', 'strict event'),
  ('checkout_complete',        true,  false, 'package', 'strict event — resolved server-side'),
  ('checkout_started',         true,  false, 'package', 'resolved in create-product-checkout'),
  ('pricing_hero_view',        true,  false, 'package', 'visible on package landing'),
  ('product_view',             true,  false, 'package', 'visible on product page'),
  ('shop_view',                false, false, 'global',  'shop index — global'),
  ('cta_visible',              true,  false, 'package', 'CTA on package context'),
  ('cta_click',                true,  false, 'package', 'CTA click on package context'),
  ('bundle_cta_clicked',       true,  false, 'package', 'bundle CTA'),
  ('quiz_cta_clicked',         true,  false, 'package', 'quiz CTA'),
  ('lead_magnet_view',         true,  false, 'package', 'lead magnet bound to package via quizBundleMap'),
  ('landing_view',             false, false, 'global',  'generic landing page view'),
  ('lernplan_viewed',          false, false, 'global',  'lernplan view (may be cross-package)'),
  ('heatmap_scroll_depth',     false, false, 'page',    'observability only'),
  ('package_published',        true,  false, 'package', 'server-side admin event')
ON CONFLICT (event_type) DO NOTHING;

-- Soft-audit trigger: insert audit row when policy violated; only block when strict=true.
CREATE OR REPLACE FUNCTION public.fn_conversion_events_attribution_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy public.conversion_event_attribution_policy%ROWTYPE;
  v_has_pkg boolean;
BEGIN
  SELECT * INTO v_policy
  FROM public.conversion_event_attribution_policy
  WHERE event_type = NEW.event_type;

  IF NOT FOUND OR v_policy.requires_package = false THEN
    RETURN NEW;
  END IF;

  v_has_pkg := (NEW.package_id IS NOT NULL)
            OR (NEW.metadata ? 'package_id' AND NULLIF(NEW.metadata->>'package_id','') IS NOT NULL);

  IF v_has_pkg THEN
    RETURN NEW;
  END IF;

  -- Soft audit
  BEGIN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'conversion_event_attribution_violation',
      'conversion_event',
      NULL,
      CASE WHEN v_policy.strict THEN 'blocked' ELSE 'observed' END,
      jsonb_build_object(
        'event_type', NEW.event_type,
        'session_id', NEW.session_id,
        'page_path', NEW.page_path,
        'strict', v_policy.strict,
        'scope', v_policy.scope
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF v_policy.strict THEN
    RAISE EXCEPTION 'attribution_required: event_type=% needs package context (set metadata.package_id or top-level package_id)', NEW.event_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_conversion_events_attribution_audit ON public.conversion_events;
CREATE TRIGGER trg_conversion_events_attribution_audit
  BEFORE INSERT ON public.conversion_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_conversion_events_attribution_audit();

-- Audit summary view (window-based)
CREATE OR REPLACE FUNCTION public.admin_get_attribution_audit_summary(_window_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(_window_days, 1));
BEGIN
  IF NOT (v_uid IS NOT NULL AND has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'window_days', _window_days,
    'generated_at', now(),
    'totals', (
      SELECT jsonb_build_object(
        'events_total', count(*),
        'events_with_pkg', count(*) FILTER (WHERE package_id IS NOT NULL OR (metadata ? 'package_id' AND NULLIF(metadata->>'package_id','') IS NOT NULL)),
        'attribution_pct',
          CASE WHEN count(*)=0 THEN 0
               ELSE round(100.0 * count(*) FILTER (WHERE package_id IS NOT NULL OR (metadata ? 'package_id' AND NULLIF(metadata->>'package_id','') IS NOT NULL))::numeric / count(*)::numeric, 1)
          END
      )
      FROM conversion_events
      WHERE created_at >= v_cutoff
    ),
    'by_event_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_type', e.event_type,
        'requires_package', COALESCE(p.requires_package, false),
        'strict', COALESCE(p.strict, false),
        'scope', COALESCE(p.scope, 'unknown'),
        'total', e.total,
        'with_pkg', e.with_pkg,
        'without_pkg', e.total - e.with_pkg,
        'attribution_pct',
          CASE WHEN e.total = 0 THEN 0
               ELSE round(100.0 * e.with_pkg::numeric / e.total::numeric, 1)
          END
      ) ORDER BY e.total DESC)
      FROM (
        SELECT event_type,
               count(*) AS total,
               count(*) FILTER (WHERE package_id IS NOT NULL OR (metadata ? 'package_id' AND NULLIF(metadata->>'package_id','') IS NOT NULL)) AS with_pkg
        FROM conversion_events
        WHERE created_at >= v_cutoff
        GROUP BY event_type
      ) e
      LEFT JOIN conversion_event_attribution_policy p ON p.event_type = e.event_type
    ), '[]'::jsonb),
    'recent_violations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'logged_at', logged_at,
        'event_type', metadata->>'event_type',
        'page_path', metadata->>'page_path',
        'strict', (metadata->>'strict')::boolean,
        'result_status', result_status
      ) ORDER BY logged_at DESC)
      FROM (
        SELECT * FROM auto_heal_log
        WHERE action_type = 'conversion_event_attribution_violation'
          AND logged_at >= v_cutoff
        ORDER BY logged_at DESC
        LIMIT 50
      ) recent
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_attribution_audit_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_attribution_audit_summary(int) TO authenticated;

-- Policy mutation RPC
CREATE OR REPLACE FUNCTION public.admin_set_attribution_policy(
  _event_type text,
  _requires_package boolean,
  _strict boolean,
  _scope text DEFAULT 'package',
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT (v_uid IS NOT NULL AND has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.conversion_event_attribution_policy(event_type, requires_package, strict, scope, notes, updated_at, updated_by)
  VALUES (_event_type, _requires_package, _strict, COALESCE(_scope,'package'), _notes, now(), v_uid)
  ON CONFLICT (event_type) DO UPDATE
    SET requires_package = EXCLUDED.requires_package,
        strict = EXCLUDED.strict,
        scope = EXCLUDED.scope,
        notes = COALESCE(EXCLUDED.notes, public.conversion_event_attribution_policy.notes),
        updated_at = now(),
        updated_by = v_uid;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'attribution_policy_updated',
    'conversion_event_policy',
    'ok',
    jsonb_build_object('event_type', _event_type, 'requires_package', _requires_package, 'strict', _strict, 'scope', _scope, 'actor_uid', v_uid)
  );

  RETURN jsonb_build_object('ok', true, 'event_type', _event_type);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_attribution_policy(text,boolean,boolean,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_attribution_policy(text,boolean,boolean,text,text) TO authenticated;

-- Baseline audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES (
  'track_2_3a_2_3b_init',
  'system',
  'ok',
  jsonb_build_object(
    'track', '2.3a+2.3b',
    'components', jsonb_build_array(
      'v_canonical_drift_classification_v1',
      'admin_get_canonical_drift_summary',
      'admin_get_canonical_drift_packages',
      'conversion_event_attribution_policy',
      'trg_conversion_events_attribution_audit',
      'admin_get_attribution_audit_summary',
      'admin_set_attribution_policy'
    )
  )
);
