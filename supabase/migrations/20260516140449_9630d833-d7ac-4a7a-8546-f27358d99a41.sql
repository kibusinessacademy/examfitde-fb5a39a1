
-- TRACK M3
CREATE TABLE IF NOT EXISTS public.curriculum_upsell_path_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_curriculum_id UUID NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  target_curriculum_id UUID NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  support_count INTEGER NOT NULL DEFAULT 0,
  source_buyer_count INTEGER NOT NULL DEFAULT 0,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  lift NUMERIC(8,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  promoted_path_id UUID REFERENCES public.curriculum_upsell_paths(id) ON DELETE SET NULL,
  notes TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_curriculum_id <> target_curriculum_id),
  UNIQUE (source_curriculum_id, target_curriculum_id)
);
CREATE INDEX IF NOT EXISTS idx_upsell_suggestions_status ON public.curriculum_upsell_path_suggestions(status, confidence DESC);
ALTER TABLE public.curriculum_upsell_path_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_read_upsell_suggestions" ON public.curriculum_upsell_path_suggestions;
CREATE POLICY "admins_read_upsell_suggestions" ON public.curriculum_upsell_path_suggestions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.org_owner_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('weekly','monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  enqueued_job_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, period, period_start)
);
CREATE INDEX IF NOT EXISTS idx_org_owner_digests_org_period ON public.org_owner_digests(org_id, period, period_start DESC);
ALTER TABLE public.org_owner_digests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_read_org_owner_digests" ON public.org_owner_digests;
CREATE POLICY "admins_read_org_owner_digests" ON public.org_owner_digests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Registry: korrekte Spalten
INSERT INTO public.notification_intent_registry
  (intent_key, label, description, trigger_reason, recovery_action, max_per_day, respects_quiet_hours, respects_fatigue, enabled, safety_class, min_delivery_floor)
VALUES
  ('org_owner_weekly_digest','Wöchentlicher Owner-Report',
   'Wöchentlicher Bericht an Org-Owner mit Nutzung, Lizenzen, ablaufenden Sitzplätzen.',
   'weekly_schedule','none',1,true,true,true,'sensitive','none'),
  ('org_owner_monthly_digest','Monatlicher Owner-Report',
   'Monatlicher Bericht an Org-Owner mit aggregierten KPIs.',
   'monthly_schedule','none',1,true,true,true,'sensitive','none')
ON CONFLICT (intent_key) DO NOTHING;

ALTER TABLE public.notification_jobs DROP CONSTRAINT IF EXISTS notification_jobs_kind_check;
ALTER TABLE public.notification_jobs ADD CONSTRAINT notification_jobs_kind_check
  CHECK (kind = ANY (ARRAY[
    'reminder','followup','escalation','engagement',
    'paywall_abandoned','checkout_abandoned','readiness_red_upsell',
    'bundle_upsell','org_seat_expiring','org_seat_expiring_critical',
    'org_owner_digest'
  ]));

-- Discovery
CREATE OR REPLACE FUNCTION public.fn_discover_upsell_paths_from_copurchases(p_dry_run BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_users INTEGER;
  v_candidate_count INTEGER := 0;
  v_inserted INTEGER := 0;
  v_min_support INTEGER := 2;
  v_min_confidence NUMERIC := 0.05;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO v_total_users
  FROM public.learner_course_grants
  WHERE status='active' AND curriculum_id IS NOT NULL;

  WITH pairs AS (
    SELECT g1.curriculum_id AS source_id, g2.curriculum_id AS target_id,
           COUNT(DISTINCT g1.user_id) AS support
    FROM public.learner_course_grants g1
    JOIN public.learner_course_grants g2
      ON g1.user_id=g2.user_id AND g1.curriculum_id<g2.curriculum_id
    WHERE g1.status='active' AND g2.status='active'
      AND g1.curriculum_id IS NOT NULL AND g2.curriculum_id IS NOT NULL
    GROUP BY g1.curriculum_id, g2.curriculum_id
    HAVING COUNT(DISTINCT g1.user_id) >= v_min_support
  ),
  src_counts AS (
    SELECT curriculum_id, COUNT(DISTINCT user_id) AS n
    FROM public.learner_course_grants
    WHERE status='active' AND curriculum_id IS NOT NULL GROUP BY curriculum_id
  ),
  scored AS (
    SELECT p.source_id, p.target_id, p.support, sc.n AS source_n,
      CASE WHEN sc.n>0 THEN (p.support::NUMERIC/sc.n) ELSE 0 END AS confidence,
      CASE WHEN tc.n>0 AND v_total_users>0
           THEN (p.support::NUMERIC/sc.n)/(tc.n::NUMERIC/v_total_users) ELSE 0 END AS lift
    FROM pairs p
    JOIN src_counts sc ON sc.curriculum_id=p.source_id
    JOIN src_counts tc ON tc.curriculum_id=p.target_id
  )
  SELECT COUNT(*) INTO v_candidate_count FROM scored WHERE confidence >= v_min_confidence;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok',true,'dry_run',true,'total_users',v_total_users,
      'candidates',v_candidate_count,'min_support',v_min_support,'min_confidence',v_min_confidence);
  END IF;

  WITH pairs AS (
    SELECT g1.curriculum_id AS source_id, g2.curriculum_id AS target_id,
           COUNT(DISTINCT g1.user_id) AS support
    FROM public.learner_course_grants g1
    JOIN public.learner_course_grants g2
      ON g1.user_id=g2.user_id AND g1.curriculum_id<g2.curriculum_id
    WHERE g1.status='active' AND g2.status='active'
      AND g1.curriculum_id IS NOT NULL AND g2.curriculum_id IS NOT NULL
    GROUP BY g1.curriculum_id, g2.curriculum_id
    HAVING COUNT(DISTINCT g1.user_id) >= v_min_support
  ),
  src_counts AS (
    SELECT curriculum_id, COUNT(DISTINCT user_id) AS n
    FROM public.learner_course_grants
    WHERE status='active' AND curriculum_id IS NOT NULL GROUP BY curriculum_id
  ),
  scored AS (
    SELECT p.source_id, p.target_id, p.support, sc.n AS source_n,
      CASE WHEN sc.n>0 THEN (p.support::NUMERIC/sc.n) ELSE 0 END AS confidence,
      CASE WHEN tc.n>0 AND v_total_users>0
           THEN (p.support::NUMERIC/sc.n)/(tc.n::NUMERIC/v_total_users) ELSE 0 END AS lift
    FROM pairs p
    JOIN src_counts sc ON sc.curriculum_id=p.source_id
    JOIN src_counts tc ON tc.curriculum_id=p.target_id
  ),
  ins AS (
    INSERT INTO public.curriculum_upsell_path_suggestions
      (source_curriculum_id, target_curriculum_id, support_count, source_buyer_count, confidence, lift, last_seen_at)
    SELECT source_id, target_id, support, source_n, confidence, lift, now()
    FROM scored WHERE confidence >= v_min_confidence
    ON CONFLICT (source_curriculum_id, target_curriculum_id) DO UPDATE
      SET support_count=EXCLUDED.support_count, source_buyer_count=EXCLUDED.source_buyer_count,
          confidence=EXCLUDED.confidence, lift=EXCLUDED.lift,
          last_seen_at=now(), updated_at=now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  INSERT INTO public.auto_heal_log(action_type, result_status, target_type, metadata)
  VALUES ('upsell_path_discovery_run','success','system',
    jsonb_build_object('total_users',v_total_users,'candidates',v_candidate_count,'upserted',v_inserted));

  RETURN jsonb_build_object('ok',true,'total_users',v_total_users,'candidates',v_candidate_count,'upserted',v_inserted);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_discover_upsell_paths_from_copurchases(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_discover_upsell_paths_from_copurchases(BOOLEAN) TO service_role;

-- Owner-Digest Producer
CREATE OR REPLACE FUNCTION public.fn_emit_org_owner_digests(p_period TEXT DEFAULT 'weekly', p_dry_run BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE := CURRENT_DATE;
  v_intent TEXT;
  v_orgs_processed INTEGER := 0;
  v_jobs_enqueued INTEGER := 0;
  r RECORD; v_owner RECORD;
  v_payload JSONB; v_new_job_id UUID;
  v_job_ids UUID[]; v_dedupe TEXT;
BEGIN
  IF p_period NOT IN ('weekly','monthly') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_period');
  END IF;
  IF p_period='weekly' THEN
    v_period_start := CURRENT_DATE - INTERVAL '7 days';
    v_intent := 'org_owner_weekly_digest';
  ELSE
    v_period_start := CURRENT_DATE - INTERVAL '30 days';
    v_intent := 'org_owner_monthly_digest';
  END IF;

  FOR r IN
    SELECT o.id AS org_id, o.name
    FROM public.organizations o
    WHERE o.is_active=true
      AND EXISTS (SELECT 1 FROM public.org_licenses ol WHERE ol.org_id=o.id AND ol.status='active')
  LOOP
    IF EXISTS (SELECT 1 FROM public.org_owner_digests
               WHERE org_id=r.org_id AND period=p_period AND period_start=v_period_start) THEN
      CONTINUE;
    END IF;

    SELECT jsonb_build_object(
      'org_id',r.org_id,'org_name',r.name,'period',p_period,
      'period_start',v_period_start,'period_end',v_period_end,
      'active_licenses',(SELECT COUNT(*) FROM public.org_licenses WHERE org_id=r.org_id AND status='active'),
      'total_seats',COALESCE((SELECT SUM(seat_count) FROM public.org_licenses WHERE org_id=r.org_id AND status='active'),0),
      'seats_used',COALESCE((SELECT SUM(seats_used) FROM public.org_licenses WHERE org_id=r.org_id AND status='active'),0),
      'expiring_30d',(SELECT COUNT(*) FROM public.org_licenses WHERE org_id=r.org_id AND status='active'
                      AND ends_at IS NOT NULL AND ends_at <= now() + INTERVAL '30 days'),
      'active_learners',(SELECT COUNT(DISTINCT m.user_id) FROM public.org_memberships m
                         WHERE m.org_id=r.org_id AND m.role='learner' AND m.status='active')
    ) INTO v_payload;

    v_job_ids := '{}'::uuid[];
    v_orgs_processed := v_orgs_processed+1;

    IF NOT p_dry_run THEN
      FOR v_owner IN
        SELECT user_id FROM public.org_memberships
        WHERE org_id=r.org_id AND role IN ('owner','admin') AND status='active'
      LOOP
        v_dedupe := v_intent||':'||r.org_id::text||':'||v_period_start::text||':'||v_owner.user_id::text;
        BEGIN
          INSERT INTO public.notification_jobs(user_id,kind,channel,payload,intent_key,dedupe_key,state)
          VALUES (v_owner.user_id,'org_owner_digest','email',v_payload,v_intent,v_dedupe,'pending')
          RETURNING id INTO v_new_job_id;
          v_job_ids := array_append(v_job_ids,v_new_job_id);
          v_jobs_enqueued := v_jobs_enqueued+1;
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
      END LOOP;

      INSERT INTO public.org_owner_digests(org_id,period,period_start,period_end,payload,recipients_count,enqueued_job_ids)
      VALUES (r.org_id,p_period,v_period_start,v_period_end,v_payload,COALESCE(array_length(v_job_ids,1),0),v_job_ids)
      ON CONFLICT (org_id,period,period_start) DO NOTHING;
    END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
    VALUES ('org_owner_digest_run','success','system',
      jsonb_build_object('period',p_period,'orgs_processed',v_orgs_processed,'jobs_enqueued',v_jobs_enqueued));
  END IF;

  RETURN jsonb_build_object('ok',true,'period',p_period,'orgs_processed',v_orgs_processed,'jobs_enqueued',v_jobs_enqueued,'dry_run',p_dry_run);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_emit_org_owner_digests(TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emit_org_owner_digests(TEXT,BOOLEAN) TO service_role;

-- Admin RPCs
CREATE OR REPLACE FUNCTION public.admin_get_upsell_suggestions(p_status TEXT DEFAULT 'pending', p_limit INTEGER DEFAULT 50)
RETURNS TABLE(id UUID, source_curriculum_id UUID, source_title TEXT, target_curriculum_id UUID, target_title TEXT,
  support_count INTEGER, source_buyer_count INTEGER, confidence NUMERIC, lift NUMERIC, status TEXT, last_seen_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT s.id, s.source_curriculum_id, cs.title, s.target_curriculum_id, ct.title,
           s.support_count, s.source_buyer_count, s.confidence, s.lift, s.status, s.last_seen_at
    FROM public.curriculum_upsell_path_suggestions s
    LEFT JOIN public.curricula cs ON cs.id=s.source_curriculum_id
    LEFT JOIN public.curricula ct ON ct.id=s.target_curriculum_id
    WHERE (p_status='all' OR s.status=p_status)
    ORDER BY s.confidence DESC, s.support_count DESC LIMIT p_limit;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_get_upsell_suggestions(TEXT,INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_upsell_suggestion(p_id UUID, p_action TEXT, p_reason TEXT DEFAULT 'curriculum_co_purchase')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row RECORD; v_path_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_action NOT IN ('approve','reject') THEN RETURN jsonb_build_object('ok',false,'error','invalid_action'); END IF;
  SELECT * INTO v_row FROM public.curriculum_upsell_path_suggestions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF p_action='approve' THEN
    INSERT INTO public.curriculum_upsell_paths(source_curriculum_id,target_curriculum_id,weight,reason,enabled)
    VALUES (v_row.source_curriculum_id,v_row.target_curriculum_id,GREATEST(v_row.confidence,0.1),p_reason,true)
    ON CONFLICT (source_curriculum_id,target_curriculum_id) DO UPDATE
      SET enabled=true, weight=EXCLUDED.weight, reason=EXCLUDED.reason, updated_at=now()
    RETURNING id INTO v_path_id;
    UPDATE public.curriculum_upsell_path_suggestions
      SET status='approved', reviewed_by=auth.uid(), reviewed_at=now(), promoted_path_id=v_path_id, updated_at=now()
      WHERE id=p_id;
  ELSE
    UPDATE public.curriculum_upsell_path_suggestions
      SET status='rejected', reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now()
      WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'action',p_action,'path_id',v_path_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_review_upsell_suggestion(UUID,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_org_digest_history(p_period TEXT DEFAULT 'weekly', p_limit INTEGER DEFAULT 30)
RETURNS TABLE(id UUID, org_id UUID, org_name TEXT, period TEXT, period_start DATE, period_end DATE,
  recipients_count INTEGER, payload JSONB, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
    SELECT d.id,d.org_id,o.name,d.period,d.period_start,d.period_end,d.recipients_count,d.payload,d.created_at
    FROM public.org_owner_digests d LEFT JOIN public.organizations o ON o.id=d.org_id
    WHERE (p_period='all' OR d.period=p_period)
    ORDER BY d.created_at DESC LIMIT p_limit;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_get_org_digest_history(TEXT,INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_smoke_track_m3()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_intents INTEGER; v_kind_ok BOOLEAN; v_disc JSONB; v_dig_w JSONB; v_dig_m JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COUNT(*) INTO v_intents FROM public.notification_intent_registry
    WHERE intent_key IN ('org_owner_weekly_digest','org_owner_monthly_digest');
  SELECT pg_get_constraintdef(oid) LIKE '%org_owner_digest%' INTO v_kind_ok
    FROM pg_constraint WHERE conname='notification_jobs_kind_check';
  v_disc  := public.fn_discover_upsell_paths_from_copurchases(true);
  v_dig_w := public.fn_emit_org_owner_digests('weekly', true);
  v_dig_m := public.fn_emit_org_owner_digests('monthly', true);
  RETURN jsonb_build_object('ok',(v_intents=2 AND v_kind_ok),
    'intents_present',v_intents,'kind_constraint_ok',v_kind_ok,
    'discovery_dry_run',v_disc,'digest_weekly_dry_run',v_dig_w,'digest_monthly_dry_run',v_dig_m);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_smoke_track_m3() TO authenticated;
