-- ============================================================================
-- 1) conversion_events: erweitern + Pflicht-Events + RLS
-- ============================================================================

ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS anonymous_id text,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS page_path text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.crm_deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conv_events_anon ON public.conversion_events(anonymous_id) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_events_type_time ON public.conversion_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_events_contact ON public.conversion_events(contact_id) WHERE contact_id IS NOT NULL;

-- Pflicht-Events Whitelist (legacy events bleiben erlaubt)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='conversion_events_event_type_v2_chk') THEN
    ALTER TABLE public.conversion_events
      ADD CONSTRAINT conversion_events_event_type_v2_chk
      CHECK (event_type IN (
        -- Pflicht-Events (SSOT)
        'hero_cta_click','pricing_view','checkout_start','checkout_complete',
        'lead_magnet_download','quiz_complete',
        -- Legacy / weitere
        'paywall_view','cta_click','checkout_started','checkout_completed','dismissed',
        'pricing_hero_view','pricing_hero_primary_click','pricing_hero_secondary_click',
        'optin_submit','doi_confirmed','b2b_form_submit','course_open','exam_attempt'
      ));
  END IF;
END $$;

-- RLS aktivieren (falls noch nicht)
ALTER TABLE public.conversion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ce_admin_select" ON public.conversion_events;
CREATE POLICY "ce_admin_select" ON public.conversion_events FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "ce_user_insert_own" ON public.conversion_events;
CREATE POLICY "ce_user_insert_own" ON public.conversion_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RPC v2: erlaubt anonyme + authentifizierte Tracking-Calls, validiert event_type strikt
CREATE OR REPLACE FUNCTION public.track_conversion_event_v2(
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_anonymous_id text DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_page_path text DEFAULT NULL,
  p_curriculum_id uuid DEFAULT NULL,
  p_intent text DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_user uuid := auth.uid();
BEGIN
  IF p_event_type NOT IN (
    'hero_cta_click','pricing_view','checkout_start','checkout_complete',
    'lead_magnet_download','quiz_complete','optin_submit','doi_confirmed',
    'b2b_form_submit','course_open','exam_attempt'
  ) THEN
    RAISE EXCEPTION 'invalid event_type: %', p_event_type;
  END IF;

  INSERT INTO public.conversion_events(
    user_id, anonymous_id, session_id, page_path, event_type,
    metadata, curriculum_id, intent, contact_id
  ) VALUES (
    v_user, p_anonymous_id, p_session_id, p_page_path, p_event_type,
    COALESCE(p_metadata,'{}'::jsonb), p_curriculum_id, p_intent, p_contact_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.track_conversion_event_v2(text,jsonb,text,text,text,uuid,text,uuid) TO anon, authenticated;

-- ============================================================================
-- 2) Newsletter Double-Optin (DOI)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.newsletter_doi_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  source text,
  curriculum_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doi_token ON public.newsletter_doi_tokens(token);
CREATE INDEX IF NOT EXISTS idx_doi_email ON public.newsletter_doi_tokens(lower(email));

ALTER TABLE public.newsletter_doi_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "doi_admin_select" ON public.newsletter_doi_tokens;
CREATE POLICY "doi_admin_select" ON public.newsletter_doi_tokens FOR SELECT
  USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.create_doi_token(
  p_email text, p_source text DEFAULT NULL, p_curriculum_id uuid DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_token text;
BEGIN
  v_token := encode(gen_random_bytes(24),'hex');
  INSERT INTO public.newsletter_doi_tokens(email, token, source, curriculum_id, metadata)
  VALUES (lower(trim(p_email)), v_token, p_source, p_curriculum_id, COALESCE(p_metadata,'{}'::jsonb));
  RETURN v_token;
END $$;
GRANT EXECUTE ON FUNCTION public.create_doi_token(text,text,uuid,jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_doi_token(p_token text)
RETURNS TABLE(ok boolean, email text, contact_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rec public.newsletter_doi_tokens%ROWTYPE; v_sub uuid; v_contact uuid;
BEGIN
  SELECT * INTO v_rec FROM public.newsletter_doi_tokens WHERE token = p_token;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::text, NULL::uuid; RETURN; END IF;
  IF v_rec.confirmed_at IS NOT NULL THEN RETURN QUERY SELECT true, v_rec.email, NULL::uuid; RETURN; END IF;
  IF v_rec.expires_at < now() THEN RETURN QUERY SELECT false, v_rec.email, NULL::uuid; RETURN; END IF;

  UPDATE public.newsletter_doi_tokens SET confirmed_at = now() WHERE id = v_rec.id;

  -- Subscriber upsert
  INSERT INTO public.newsletter_subscribers(email, is_subscribed, subscribed_at, source)
  VALUES (v_rec.email, true, now(), COALESCE(v_rec.source,'doi'))
  ON CONFLICT (email) DO UPDATE SET
    is_subscribed = true,
    subscribed_at = COALESCE(public.newsletter_subscribers.subscribed_at, now()),
    unsubscribed_at = NULL;

  -- CRM contact upsert (Trigger uebernimmt eigentlich, aber idempotent absichern)
  INSERT INTO public.crm_contacts(email, lifecycle_stage, lead_source)
  VALUES (v_rec.email, 'subscriber', COALESCE(v_rec.source,'doi'))
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_contact FROM public.crm_contacts WHERE lower(email)=lower(v_rec.email) LIMIT 1;

  -- Conversion-Event (DOI bestaetigt)
  INSERT INTO public.conversion_events(event_type, metadata, contact_id, curriculum_id)
  VALUES ('doi_confirmed', jsonb_build_object('source', v_rec.source), v_contact, v_rec.curriculum_id);

  RETURN QUERY SELECT true, v_rec.email, v_contact;
END $$;
GRANT EXECUTE ON FUNCTION public.confirm_doi_token(text) TO anon, authenticated;

-- ============================================================================
-- 3) CRM Auto-Sync Trigger
-- ============================================================================

-- Eindeutigkeit auf email fuer crm_contacts (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contacts_email_lower ON public.crm_contacts(lower(email)) WHERE email IS NOT NULL;

-- 3a) newsletter_subscribers -> crm_contacts
CREATE OR REPLACE FUNCTION public.fn_sync_subscriber_to_crm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.email IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.crm_contacts(email, lifecycle_stage, lead_source, first_name, last_name, user_id)
  VALUES (lower(NEW.email),
          CASE WHEN NEW.is_subscribed THEN 'subscriber' ELSE 'unsubscribed' END,
          COALESCE(NEW.source,'newsletter'), NEW.first_name, NEW.last_name, NEW.user_id)
  ON CONFLICT (lower(email)) DO UPDATE SET
    lifecycle_stage = EXCLUDED.lifecycle_stage,
    lead_source = COALESCE(public.crm_contacts.lead_source, EXCLUDED.lead_source),
    first_name = COALESCE(public.crm_contacts.first_name, EXCLUDED.first_name),
    last_name  = COALESCE(public.crm_contacts.last_name, EXCLUDED.last_name),
    user_id    = COALESCE(public.crm_contacts.user_id, EXCLUDED.user_id),
    updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_subscriber_to_crm ON public.newsletter_subscribers;
CREATE TRIGGER trg_sync_subscriber_to_crm
  AFTER INSERT OR UPDATE OF email, is_subscribed, source ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_subscriber_to_crm();

-- 3b) b2b_leads -> crm_contacts + crm_deals(stage=qualification)
CREATE OR REPLACE FUNCTION public.fn_sync_b2b_lead_to_crm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_contact uuid;
BEGIN
  IF NEW.contact_email IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.crm_contacts(email, first_name, company, phone, lifecycle_stage, lead_source)
  VALUES (lower(NEW.contact_email),
          split_part(COALESCE(NEW.contact_name,''),' ',1),
          NEW.company_name, NEW.contact_phone, 'lead', COALESCE(NEW.source,'b2b_form'))
  ON CONFLICT (lower(email)) DO UPDATE SET
    company = COALESCE(public.crm_contacts.company, EXCLUDED.company),
    phone   = COALESCE(public.crm_contacts.phone, EXCLUDED.phone),
    lifecycle_stage = CASE WHEN public.crm_contacts.lifecycle_stage IN ('subscriber','unsubscribed')
                           THEN 'lead' ELSE public.crm_contacts.lifecycle_stage END,
    updated_at = now()
  RETURNING id INTO v_contact;

  INSERT INTO public.crm_deals(contact_id, title, stage, value_cents, currency, probability, notes)
  VALUES (v_contact,
          'B2B: '||COALESCE(NEW.company_name,'Unbekannt'),
          'qualification',
          COALESCE((NEW.deal_value_eur*100)::int, 0),
          'eur', 20, NEW.notes);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_b2b_lead_to_crm ON public.b2b_leads;
CREATE TRIGGER trg_sync_b2b_lead_to_crm
  AFTER INSERT ON public.b2b_leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_b2b_lead_to_crm();

-- 3c) Pricing-Visit erhoeht lead_score
CREATE OR REPLACE FUNCTION public.fn_score_on_pricing_view()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.event_type IN ('pricing_view','pricing_hero_view') AND NEW.contact_id IS NOT NULL THEN
    UPDATE public.crm_contacts
       SET lead_score = COALESCE(lead_score,0) + 5,
           last_contacted_at = COALESCE(last_contacted_at, now()),
           updated_at = now()
     WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_score_on_pricing_view ON public.conversion_events;
CREATE TRIGGER trg_score_on_pricing_view
  AFTER INSERT ON public.conversion_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_score_on_pricing_view();

-- ============================================================================
-- 4) Convenience-Views fuer Cockpit (P5 Vorbereitung)
-- ============================================================================
CREATE OR REPLACE VIEW public.v_funnel_overview_24h AS
SELECT
  count(*) FILTER (WHERE event_type='hero_cta_click') AS hero_cta_clicks,
  count(*) FILTER (WHERE event_type='pricing_view')   AS pricing_views,
  count(*) FILTER (WHERE event_type='checkout_start') AS checkout_starts,
  count(*) FILTER (WHERE event_type='checkout_complete') AS checkout_completes,
  count(*) FILTER (WHERE event_type='lead_magnet_download') AS lead_magnet_downloads,
  count(*) FILTER (WHERE event_type='quiz_complete')  AS quiz_completes,
  count(DISTINCT COALESCE(user_id::text, anonymous_id)) AS unique_visitors
FROM public.conversion_events
WHERE created_at > now() - interval '24 hours';