-- =========================================================================
-- LOOP D — Admin-Cockpit: 6 Status-Ampeln (Snapshot + RPC)
-- =========================================================================

-- 1) Persistenter Daily-Snapshot der 6 Domain-KPIs
CREATE TABLE IF NOT EXISTS public.cockpit_daily_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  domain        text NOT NULL CHECK (domain IN ('seo','funnel','crm','revenue','learning','pipeline')),
  status        text NOT NULL CHECK (status IN ('green','yellow','red','grey')),
  score         numeric(5,2),
  primary_kpi   text,
  primary_value numeric,
  secondary     jsonb DEFAULT '{}'::jsonb,
  reasons       text[] DEFAULT ARRAY[]::text[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, domain)
);

CREATE INDEX IF NOT EXISTS idx_cockpit_snapshots_date ON public.cockpit_daily_snapshots(snapshot_date DESC, domain);

ALTER TABLE public.cockpit_daily_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_cockpit_snapshots" ON public.cockpit_daily_snapshots;
CREATE POLICY "admins_read_cockpit_snapshots" ON public.cockpit_daily_snapshots
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2) RPC: Live-Status der 6 Ampeln
CREATE OR REPLACE FUNCTION public.get_cockpit_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_seo jsonb;
  v_funnel jsonb;
  v_crm jsonb;
  v_revenue jsonb;
  v_learning jsonb;
  v_pipeline jsonb;
  v_funnel_row record;
  v_revenue_24h numeric := 0;
  v_revenue_7d numeric := 0;
  v_orders_24h int := 0;
  v_seo_live int := 0;
  v_seo_draft int := 0;
  v_contacts_total int := 0;
  v_contacts_7d int := 0;
  v_subs_confirmed int := 0;
  v_email_pending int := 0;
  v_email_failed int := 0;
  v_grants_active int := 0;
  v_tutor_24h int := 0;
  v_tutor_blocked_24h int := 0;
  v_jobs_failed_24h int := 0;
  v_jobs_processing int := 0;
BEGIN
  v_is_admin := public.has_role(auth.uid(), 'admin'::public.app_role);
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- SEO
  SELECT
    COALESCE(SUM(CASE WHEN status='live' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END), 0)
  INTO v_seo_live, v_seo_draft FROM public.seo_content_pages;

  v_seo := jsonb_build_object(
    'domain','seo',
    'status', CASE WHEN v_seo_live >= 50 THEN 'green' WHEN v_seo_live >= 10 THEN 'yellow' ELSE 'red' END,
    'primary_kpi','live_pages',
    'primary_value', v_seo_live,
    'secondary', jsonb_build_object('draft_pages', v_seo_draft),
    'reasons',
      CASE
        WHEN v_seo_live = 0 THEN ARRAY['Keine SEO-Seiten live']
        WHEN v_seo_live < 10 THEN ARRAY['SEO-Volumen niedrig (<10 live)']
        WHEN v_seo_draft > v_seo_live THEN ARRAY['Mehr Drafts als Live-Seiten']
        ELSE ARRAY[]::text[]
      END,
    'cta', CASE WHEN v_seo_draft > 0 THEN 'SEO-Drafts publizieren' ELSE 'SEO-Pipeline füllen' END,
    'route','/admin/growth'
  );

  -- Funnel (24h)
  SELECT * INTO v_funnel_row FROM public.v_funnel_overview_24h LIMIT 1;
  v_funnel := jsonb_build_object(
    'domain','funnel',
    'status',
      CASE
        WHEN COALESCE(v_funnel_row.checkout_completes,0) > 0 THEN 'green'
        WHEN COALESCE(v_funnel_row.checkout_starts,0) > 0 OR COALESCE(v_funnel_row.pricing_views,0) > 5 THEN 'yellow'
        WHEN COALESCE(v_funnel_row.unique_visitors,0) = 0 THEN 'grey'
        ELSE 'red'
      END,
    'primary_kpi','checkout_completes_24h',
    'primary_value', COALESCE(v_funnel_row.checkout_completes,0),
    'secondary', jsonb_build_object(
      'visitors_24h', COALESCE(v_funnel_row.unique_visitors,0),
      'hero_cta_24h', COALESCE(v_funnel_row.hero_cta_clicks,0),
      'pricing_views_24h', COALESCE(v_funnel_row.pricing_views,0),
      'checkout_starts_24h', COALESCE(v_funnel_row.checkout_starts,0),
      'lead_magnet_24h', COALESCE(v_funnel_row.lead_magnet_downloads,0),
      'quiz_completes_24h', COALESCE(v_funnel_row.quiz_completes,0)
    ),
    'reasons',
      CASE
        WHEN COALESCE(v_funnel_row.unique_visitors,0) = 0 THEN ARRAY['Keine Conversion-Events in 24h']
        WHEN COALESCE(v_funnel_row.pricing_views,0) > 0 AND COALESCE(v_funnel_row.checkout_starts,0) = 0 THEN ARRAY['Pricing-Views ohne Checkout-Starts']
        WHEN COALESCE(v_funnel_row.checkout_starts,0) > 0 AND COALESCE(v_funnel_row.checkout_completes,0) = 0 THEN ARRAY['Checkout-Abbrüche – Stripe-Webhook prüfen']
        ELSE ARRAY[]::text[]
      END,
    'cta','Funnel-Audit ausführen',
    'route','/admin/kpi'
  );

  -- CRM
  SELECT COUNT(*) INTO v_contacts_total FROM public.crm_contacts;
  SELECT COUNT(*) INTO v_contacts_7d FROM public.crm_contacts WHERE created_at >= now() - interval '7 days';
  SELECT COUNT(*) INTO v_subs_confirmed FROM public.newsletter_subscribers WHERE is_subscribed = true;
  SELECT COUNT(*) INTO v_email_pending FROM public.email_delivery_queue WHERE status='pending';
  SELECT COUNT(*) INTO v_email_failed FROM public.email_delivery_queue WHERE status='failed' AND created_at >= now() - interval '24 hours';

  v_crm := jsonb_build_object(
    'domain','crm',
    'status',
      CASE
        WHEN v_email_failed > 5 THEN 'red'
        WHEN v_contacts_total = 0 THEN 'red'
        WHEN v_contacts_7d = 0 THEN 'yellow'
        ELSE 'green'
      END,
    'primary_kpi','contacts_total',
    'primary_value', v_contacts_total,
    'secondary', jsonb_build_object(
      'new_contacts_7d', v_contacts_7d,
      'newsletter_confirmed', v_subs_confirmed,
      'emails_pending', v_email_pending,
      'emails_failed_24h', v_email_failed
    ),
    'reasons',
      CASE
        WHEN v_email_failed > 5 THEN ARRAY[v_email_failed::text || ' Email-Fehler in 24h – Worker prüfen']
        WHEN v_contacts_total = 0 THEN ARRAY['Keine CRM-Kontakte – Lead-Capture inaktiv?']
        WHEN v_contacts_7d = 0 THEN ARRAY['Keine neuen Kontakte in 7 Tagen']
        ELSE ARRAY[]::text[]
      END,
    'cta', CASE WHEN v_email_failed > 0 THEN 'Email-Worker triggern' ELSE 'CRM öffnen' END,
    'route','/admin/kpi'
  );

  -- Revenue
  SELECT COUNT(*), COALESCE(SUM(total_cents),0)::numeric/100
    INTO v_orders_24h, v_revenue_24h
  FROM public.orders WHERE status='paid' AND created_at >= now() - interval '24 hours';
  SELECT COALESCE(SUM(total_cents),0)::numeric/100 INTO v_revenue_7d
  FROM public.orders WHERE status='paid' AND created_at >= now() - interval '7 days';

  v_revenue := jsonb_build_object(
    'domain','revenue',
    'status',
      CASE
        WHEN v_orders_24h > 0 THEN 'green'
        WHEN v_revenue_7d > 0 THEN 'yellow'
        ELSE 'red'
      END,
    'primary_kpi','revenue_24h_eur',
    'primary_value', v_revenue_24h,
    'secondary', jsonb_build_object(
      'orders_24h', v_orders_24h,
      'revenue_7d_eur', v_revenue_7d
    ),
    'reasons',
      CASE
        WHEN v_orders_24h = 0 AND v_revenue_7d = 0 THEN ARRAY['Keine bezahlten Orders in 7 Tagen']
        WHEN v_orders_24h = 0 THEN ARRAY['Keine Orders heute – Funnel-Cliff?']
        ELSE ARRAY[]::text[]
      END,
    'cta','Stripe-Audit',
    'route','/admin/kpi'
  );

  -- Learning
  SELECT COUNT(*) INTO v_grants_active FROM public.learner_course_grants WHERE status='active';
  SELECT COALESCE(SUM(cnt),0), COALESCE(SUM(CASE WHEN decision LIKE 'blocked%' THEN cnt ELSE 0 END),0)
    INTO v_tutor_24h, v_tutor_blocked_24h
  FROM public.v_ai_tutor_audit_kpis WHERE day = CURRENT_DATE;

  v_learning := jsonb_build_object(
    'domain','learning',
    'status',
      CASE
        WHEN v_tutor_24h > 0 AND v_tutor_blocked_24h::numeric / NULLIF(v_tutor_24h,0) > 0.3 THEN 'red'
        WHEN v_grants_active = 0 THEN 'yellow'
        ELSE 'green'
      END,
    'primary_kpi','active_grants',
    'primary_value', v_grants_active,
    'secondary', jsonb_build_object(
      'tutor_requests_24h', v_tutor_24h,
      'tutor_blocked_24h', v_tutor_blocked_24h,
      'block_rate_pct',
        CASE WHEN v_tutor_24h > 0
             THEN ROUND((v_tutor_blocked_24h::numeric / v_tutor_24h) * 100, 1)
             ELSE 0 END
    ),
    'reasons',
      CASE
        WHEN v_tutor_24h > 0 AND v_tutor_blocked_24h::numeric / NULLIF(v_tutor_24h,0) > 0.3
          THEN ARRAY['Tutor blockiert >30% Anfragen – Citation-Quelle prüfen']
        WHEN v_grants_active = 0 THEN ARRAY['Keine aktiven Lizenzen – Order→Grant prüfen']
        ELSE ARRAY[]::text[]
      END,
    'cta', CASE WHEN v_tutor_blocked_24h > 0 THEN 'AI-Tutor-Audit' ELSE 'Lerner-Übersicht' END,
    'route','/admin/kpi'
  );

  -- Pipeline
  SELECT COUNT(*) INTO v_jobs_failed_24h FROM public.job_queue WHERE status='failed' AND COALESCE(updated_at, created_at) >= now() - interval '24 hours';
  SELECT COUNT(*) INTO v_jobs_processing FROM public.job_queue WHERE status='processing';

  v_pipeline := jsonb_build_object(
    'domain','pipeline',
    'status',
      CASE
        WHEN v_jobs_failed_24h > 50 THEN 'red'
        WHEN v_jobs_failed_24h > 10 THEN 'yellow'
        ELSE 'green'
      END,
    'primary_kpi','jobs_processing',
    'primary_value', v_jobs_processing,
    'secondary', jsonb_build_object(
      'jobs_failed_24h', v_jobs_failed_24h
    ),
    'reasons',
      CASE
        WHEN v_jobs_failed_24h > 50 THEN ARRAY[v_jobs_failed_24h::text || ' Job-Failures in 24h']
        WHEN v_jobs_failed_24h > 10 THEN ARRAY['Erhöhte Job-Failures (' || v_jobs_failed_24h || ')']
        ELSE ARRAY[]::text[]
      END,
    'cta','Queue öffnen',
    'route','/admin/queue'
  );

  RETURN jsonb_build_object(
    'as_of', now(),
    'cards', jsonb_build_array(v_seo, v_funnel, v_crm, v_revenue, v_learning, v_pipeline)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cockpit_status() TO authenticated;

-- 3) Daily-Persist-Funktion (vom Cron aufgerufen)
CREATE OR REPLACE FUNCTION public.persist_cockpit_daily_snapshot()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_card jsonb;
  v_count int := 0;
BEGIN
  -- Bypass RLS-Check by directly reading the same logic; we re-implement via
  -- querying the existing public.get_cockpit_status under elevated bypass.
  -- Simpler: temporarily set role to admin context via the function body — but
  -- since persist runs only via cron (service role), we read views directly.
  -- We just call get_cockpit_status as definer-bypass: skip role check.
  PERFORM set_config('request.jwt.claim.role','service_role', true);
  -- Easier: replicate by selecting from the function with admin bypass:
  -- We'll fetch by raising no exception in get_cockpit_status when called from
  -- service_role. To stay simple, we re-run the SELECTs inline:
  v_payload := NULL;

  -- We bypass the role guard by directly constructing snapshots for each domain
  -- using the same view set. (Keeps single source of computation in the RPC for
  -- live; persistence reads counts directly.)
  INSERT INTO public.cockpit_daily_snapshots (snapshot_date, domain, status, primary_kpi, primary_value, secondary, reasons)
  SELECT CURRENT_DATE, 'seo',
    CASE WHEN COUNT(*) FILTER (WHERE status='live') >= 50 THEN 'green'
         WHEN COUNT(*) FILTER (WHERE status='live') >= 10 THEN 'yellow'
         ELSE 'red' END,
    'live_pages',
    COUNT(*) FILTER (WHERE status='live')::numeric,
    jsonb_build_object('draft_pages', COUNT(*) FILTER (WHERE status='draft')),
    ARRAY[]::text[]
  FROM public.seo_content_pages
  ON CONFLICT (snapshot_date, domain) DO UPDATE
    SET status=EXCLUDED.status, primary_value=EXCLUDED.primary_value, secondary=EXCLUDED.secondary;
  v_count := v_count + 1;

  INSERT INTO public.cockpit_daily_snapshots (snapshot_date, domain, status, primary_kpi, primary_value, secondary, reasons)
  SELECT CURRENT_DATE, 'funnel',
    CASE WHEN COALESCE(checkout_completes,0) > 0 THEN 'green'
         WHEN COALESCE(checkout_starts,0) > 0 THEN 'yellow'
         WHEN COALESCE(unique_visitors,0) = 0 THEN 'grey'
         ELSE 'red' END,
    'checkout_completes_24h',
    COALESCE(checkout_completes,0)::numeric,
    jsonb_build_object(
      'visitors', COALESCE(unique_visitors,0),
      'pricing_views', COALESCE(pricing_views,0),
      'checkout_starts', COALESCE(checkout_starts,0)
    ),
    ARRAY[]::text[]
  FROM public.v_funnel_overview_24h
  ON CONFLICT (snapshot_date, domain) DO UPDATE
    SET status=EXCLUDED.status, primary_value=EXCLUDED.primary_value, secondary=EXCLUDED.secondary;
  v_count := v_count + 1;

  INSERT INTO public.cockpit_daily_snapshots (snapshot_date, domain, status, primary_kpi, primary_value, secondary, reasons)
  SELECT CURRENT_DATE, 'crm',
    CASE WHEN (SELECT COUNT(*) FROM public.crm_contacts) = 0 THEN 'red'
         WHEN (SELECT COUNT(*) FROM public.crm_contacts WHERE created_at >= now()-interval '7 days') = 0 THEN 'yellow'
         ELSE 'green' END,
    'contacts_total',
    (SELECT COUNT(*) FROM public.crm_contacts)::numeric,
    jsonb_build_object(
      'new_7d', (SELECT COUNT(*) FROM public.crm_contacts WHERE created_at >= now()-interval '7 days'),
      'subs_confirmed', (SELECT COUNT(*) FROM public.newsletter_subscribers WHERE is_subscribed=true)
    ),
    ARRAY[]::text[]
  ON CONFLICT (snapshot_date, domain) DO UPDATE
    SET status=EXCLUDED.status, primary_value=EXCLUDED.primary_value, secondary=EXCLUDED.secondary;
  v_count := v_count + 1;

  INSERT INTO public.cockpit_daily_snapshots (snapshot_date, domain, status, primary_kpi, primary_value, secondary, reasons)
  SELECT CURRENT_DATE, 'revenue',
    CASE WHEN COUNT(*) FILTER (WHERE created_at >= now()-interval '24 hours') > 0 THEN 'green'
         WHEN COUNT(*) > 0 THEN 'yellow' ELSE 'red' END,
    'revenue_24h_eur',
    (COALESCE(SUM(total_cents) FILTER (WHERE created_at >= now()-interval '24 hours'),0)::numeric/100),
    jsonb_build_object(
      'orders_24h', COUNT(*) FILTER (WHERE created_at >= now()-interval '24 hours'),
      'revenue_7d_eur', (COALESCE(SUM(total_cents) FILTER (WHERE created_at >= now()-interval '7 days'),0)::numeric/100)
    ),
    ARRAY[]::text[]
  FROM public.orders WHERE status='paid'
  ON CONFLICT (snapshot_date, domain) DO UPDATE
    SET status=EXCLUDED.status, primary_value=EXCLUDED.primary_value, secondary=EXCLUDED.secondary;
  v_count := v_count + 1;

  INSERT INTO public.cockpit_daily_snapshots (snapshot_date, domain, status, primary_kpi, primary_value, secondary, reasons)
  SELECT CURRENT_DATE, 'learning',
    CASE WHEN (SELECT COUNT(*) FROM public.learner_course_grants WHERE status='active') > 0 THEN 'green' ELSE 'yellow' END,
    'active_grants',
    (SELECT COUNT(*) FROM public.learner_course_grants WHERE status='active')::numeric,
    jsonb_build_object(
      'tutor_24h', (SELECT COALESCE(SUM(cnt),0) FROM public.v_ai_tutor_audit_kpis WHERE day=CURRENT_DATE),
      'tutor_blocked_24h', (SELECT COALESCE(SUM(cnt),0) FROM public.v_ai_tutor_audit_kpis WHERE day=CURRENT_DATE AND decision LIKE 'blocked%')
    ),
    ARRAY[]::text[]
  ON CONFLICT (snapshot_date, domain) DO UPDATE
    SET status=EXCLUDED.status, primary_value=EXCLUDED.primary_value, secondary=EXCLUDED.secondary;
  v_count := v_count + 1;

  INSERT INTO public.cockpit_daily_snapshots (snapshot_date, domain, status, primary_kpi, primary_value, secondary, reasons)
  SELECT CURRENT_DATE, 'pipeline',
    CASE WHEN COUNT(*) FILTER (WHERE status='failed' AND COALESCE(updated_at,created_at) >= now()-interval '24 hours') > 50 THEN 'red'
         WHEN COUNT(*) FILTER (WHERE status='failed' AND COALESCE(updated_at,created_at) >= now()-interval '24 hours') > 10 THEN 'yellow'
         ELSE 'green' END,
    'jobs_processing',
    COUNT(*) FILTER (WHERE status='processing')::numeric,
    jsonb_build_object(
      'failed_24h', COUNT(*) FILTER (WHERE status='failed' AND COALESCE(updated_at,created_at) >= now()-interval '24 hours')
    ),
    ARRAY[]::text[]
  FROM public.job_queue
  ON CONFLICT (snapshot_date, domain) DO UPDATE
    SET status=EXCLUDED.status, primary_value=EXCLUDED.primary_value, secondary=EXCLUDED.secondary;
  v_count := v_count + 1;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.persist_cockpit_daily_snapshot() TO service_role;

-- 4) Daily Cron um 06:00 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('cockpit-daily-snapshot') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cockpit-daily-snapshot');
    PERFORM cron.schedule(
      'cockpit-daily-snapshot',
      '0 6 * * *',
      $cron$ SELECT public.persist_cockpit_daily_snapshot(); $cron$
    );
  END IF;
END$$;