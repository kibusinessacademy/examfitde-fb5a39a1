
-- 1) Extend notification_intent_registry with renewal cadence + admin-actor variant
INSERT INTO public.notification_intent_registry
  (intent_key, label, description, trigger_reason, default_cta_label, default_cta_path,
   recovery_action, max_per_day, respects_quiet_hours, respects_fatigue, enabled,
   safety_class, min_delivery_floor, governance_notes)
VALUES
  ('org_seat_expiring_14d',
   'B2B Lizenz 14 Tage',
   'Org-Lizenz läuft in 14 Tagen ab — Verlängerung empfohlen.',
   'org_license.ends_at in 13..15d',
   'Lizenz verlängern',
   '/b2b/lizenz/verlaengern',
   'followup_email', 1, true, true, true,
   'sensitive', 'prefer',
   'B2B-Renewal Stage 2: 14 Tage vor Ablauf — Owner/Admin only.'),
  ('org_seat_expiring_7d',
   'B2B Lizenz 7 Tage',
   'Org-Lizenz läuft in 7 Tagen ab — letzte Erinnerung vor Auto-Lock.',
   'org_license.ends_at in 6..8d',
   'Jetzt verlängern',
   '/b2b/lizenz/verlaengern',
   'escalation_signal', 1, true, true, true,
   'sensitive', 'prefer',
   'B2B-Renewal Stage 3: 7 Tage — Eskalation, höhere Sichtbarkeit.'),
  ('org_seat_expiring_1d',
   'B2B Lizenz 1 Tag',
   'Org-Lizenz läuft morgen ab — Lernzugang erlischt.',
   'org_license.ends_at in 0..2d',
   'Jetzt verlängern',
   '/b2b/lizenz/verlaengern',
   'escalation_signal', 1, true, false, true,
   'critical', 'prefer',
   'B2B-Renewal Stage 4: T-1 — kritisch, fatigue-bypass um Datenverlust zu verhindern.')
ON CONFLICT (intent_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    safety_class = EXCLUDED.safety_class,
    min_delivery_floor = EXCLUDED.min_delivery_floor,
    governance_notes = EXCLUDED.governance_notes,
    updated_at = now();

-- 2) Extend notification_jobs.kind check constraint
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.notification_jobs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%kind%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notification_jobs DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.notification_jobs
  ADD CONSTRAINT notification_jobs_kind_check CHECK (
    kind = ANY (ARRAY[
      'reminder','followup','escalation','engagement',
      'paywall_abandoned','checkout_abandoned',
      'readiness_red_upsell','bundle_upsell',
      'org_seat_expiring','org_seat_expiring_critical'
    ])
  );

-- 3) curriculum_upsell_paths SSOT
CREATE TABLE IF NOT EXISTS public.curriculum_upsell_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  target_curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  weight numeric NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 10),
  reason text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_curriculum_id, target_curriculum_id),
  CHECK (source_curriculum_id <> target_curriculum_id)
);

CREATE INDEX IF NOT EXISTS idx_upsell_paths_source ON public.curriculum_upsell_paths(source_curriculum_id) WHERE enabled = true;

ALTER TABLE public.curriculum_upsell_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "upsell_paths_admin_read"
  ON public.curriculum_upsell_paths FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) B2B Renewal producer
CREATE OR REPLACE FUNCTION public.fn_emit_b2b_renewal_intents(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped int := 0;
  v_today date := current_date;
  rec record;
  v_intent text;
  v_kind text;
  v_dedupe text;
BEGIN
  FOR rec IN
    SELECT l.id AS license_id, l.org_id, l.product_id, l.ends_at,
           l.seat_count, l.seats_used,
           CASE
             WHEN l.ends_at::date - v_today BETWEEN 0 AND 2 THEN 'org_seat_expiring_1d'
             WHEN l.ends_at::date - v_today BETWEEN 6 AND 8 THEN 'org_seat_expiring_7d'
             WHEN l.ends_at::date - v_today BETWEEN 13 AND 15 THEN 'org_seat_expiring_14d'
             WHEN l.ends_at::date - v_today BETWEEN 28 AND 32 THEN 'org_seat_expiring_30d'
             ELSE NULL
           END AS stage,
           m.user_id
    FROM public.org_licenses l
    JOIN public.org_memberships m
      ON m.org_id = l.org_id
     AND m.status = 'active'
     AND m.role IN ('owner','admin')
    WHERE l.status = 'active'
      AND l.ends_at IS NOT NULL
      AND COALESCE(l.cancel_at_period_end, false) = false
  LOOP
    CONTINUE WHEN rec.stage IS NULL;

    v_intent := rec.stage;
    v_kind := CASE WHEN rec.stage = 'org_seat_expiring_1d'
                   THEN 'org_seat_expiring_critical'
                   ELSE 'org_seat_expiring' END;
    v_dedupe := v_intent || ':' || rec.license_id::text || ':' || rec.user_id::text || ':' || v_today::text;

    IF p_dry_run THEN
      v_inserted := v_inserted + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.notification_jobs
        (user_id, curriculum_id, kind, channel, state, dedupe_key, payload, scheduled_for, expires_at)
      VALUES
        (rec.user_id, NULL, v_kind, 'push', 'pending', v_dedupe,
         jsonb_build_object(
           'intent_key', v_intent,
           'org_id', rec.org_id,
           'license_id', rec.license_id,
           'product_id', rec.product_id,
           'ends_at', rec.ends_at,
           'seat_count', rec.seat_count,
           'seats_used', rec.seats_used,
           'source', 'b2b_renewal_producer'
         ),
         now(),
         rec.ends_at + interval '7 days');
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, payload)
  VALUES ('b2b_renewal_intent_producer', 'system',
          CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
          jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'dry_run', p_dry_run));

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'dry_run', p_dry_run);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_emit_b2b_renewal_intents(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emit_b2b_renewal_intents(boolean) TO service_role;

-- 5) Bundle upsell producer
CREATE OR REPLACE FUNCTION public.fn_emit_bundle_upsell_intents(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped int := 0;
  rec record;
  v_dedupe text;
BEGIN
  FOR rec IN
    SELECT DISTINCT g.user_id, p.source_curriculum_id, p.target_curriculum_id, p.reason, p.weight
    FROM public.curriculum_upsell_paths p
    JOIN public.learner_course_grants g
      ON g.curriculum_id = p.source_curriculum_id
     AND g.status = 'active'
    WHERE p.enabled = true
      AND NOT EXISTS (
        SELECT 1 FROM public.learner_course_grants g2
        WHERE g2.user_id = g.user_id
          AND g2.curriculum_id = p.target_curriculum_id
          AND g2.status = 'active'
      )
  LOOP
    v_dedupe := 'bundle_upsell:' || rec.user_id::text || ':' || rec.target_curriculum_id::text || ':' || current_date::text;

    IF p_dry_run THEN
      v_inserted := v_inserted + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.notification_jobs
        (user_id, curriculum_id, kind, channel, state, dedupe_key, payload, scheduled_for, expires_at)
      VALUES
        (rec.user_id, rec.target_curriculum_id, 'bundle_upsell', 'push', 'pending', v_dedupe,
         jsonb_build_object(
           'intent_key', 'bundle_upsell_after_first_pass',
           'source_curriculum_id', rec.source_curriculum_id,
           'target_curriculum_id', rec.target_curriculum_id,
           'reason', rec.reason,
           'weight', rec.weight,
           'source', 'bundle_upsell_producer'
         ),
         now(),
         now() + interval '14 days');
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, payload)
  VALUES ('bundle_upsell_intent_producer', 'system',
          CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
          jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'dry_run', p_dry_run));

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'dry_run', p_dry_run);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_emit_bundle_upsell_intents(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emit_bundle_upsell_intents(boolean) TO service_role;

-- 6) Renewal pipeline view + RPC
CREATE OR REPLACE VIEW public.v_b2b_renewal_pipeline AS
SELECT
  l.id AS license_id,
  l.org_id,
  o.name AS org_name,
  l.product_id,
  l.ends_at,
  (l.ends_at::date - current_date) AS days_to_expiry,
  l.seat_count,
  l.seats_used,
  CASE WHEN l.seat_count > 0
       THEN ROUND((l.seats_used::numeric / l.seat_count) * 100, 1)
       ELSE 0 END AS seat_utilization_pct,
  CASE
    WHEN l.ends_at::date - current_date <= 7 THEN 'critical'
    WHEN l.ends_at::date - current_date <= 14 THEN 'high'
    WHEN l.ends_at::date - current_date <= 30 THEN 'medium'
    ELSE 'low'
  END AS risk_level,
  l.cancel_at_period_end,
  l.status
FROM public.org_licenses l
JOIN public.organizations o ON o.id = l.org_id
WHERE l.status = 'active'
  AND l.ends_at IS NOT NULL
  AND l.ends_at::date - current_date <= 60;

REVOKE ALL ON public.v_b2b_renewal_pipeline FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_b2b_renewal_pipeline TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_b2b_renewal_pipeline()
RETURNS TABLE (
  license_id uuid, org_id uuid, org_name text, product_id uuid,
  ends_at timestamptz, days_to_expiry int, seat_count int, seats_used int,
  seat_utilization_pct numeric, risk_level text, cancel_at_period_end boolean, status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.v_b2b_renewal_pipeline ORDER BY days_to_expiry ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_b2b_renewal_pipeline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_b2b_renewal_pipeline() TO authenticated;

-- 7) Upsell-paths admin CRUD
CREATE OR REPLACE FUNCTION public.admin_get_curriculum_upsell_paths()
RETURNS TABLE (
  id uuid, source_curriculum_id uuid, target_curriculum_id uuid,
  weight numeric, reason text, enabled boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT p.id, p.source_curriculum_id, p.target_curriculum_id, p.weight, p.reason, p.enabled
  FROM public.curriculum_upsell_paths p
  ORDER BY p.weight DESC, p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_curriculum_upsell_paths() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_curriculum_upsell_paths() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_curriculum_upsell_path(
  p_source uuid, p_target uuid, p_weight numeric, p_reason text, p_enabled boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.curriculum_upsell_paths
    (source_curriculum_id, target_curriculum_id, weight, reason, enabled)
  VALUES (p_source, p_target, p_weight, p_reason, p_enabled)
  ON CONFLICT (source_curriculum_id, target_curriculum_id) DO UPDATE
    SET weight = EXCLUDED.weight, reason = EXCLUDED.reason,
        enabled = EXCLUDED.enabled, updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, payload)
  VALUES ('curriculum_upsell_path_upsert', 'system', 'success',
          jsonb_build_object('id', v_id, 'source', p_source, 'target', p_target,
                             'weight', p_weight, 'enabled', p_enabled, 'admin_id', auth.uid()));
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_curriculum_upsell_path(uuid,uuid,numeric,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_curriculum_upsell_path(uuid,uuid,numeric,text,boolean) TO authenticated;

-- 8) Smoke
CREATE OR REPLACE FUNCTION public.admin_smoke_b2b_renewal_pipeline()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_intent_count int;
  v_renewal jsonb;
  v_upsell jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_intent_count
  FROM public.notification_intent_registry
  WHERE intent_key IN ('org_seat_expiring_30d','org_seat_expiring_14d',
                       'org_seat_expiring_7d','org_seat_expiring_1d',
                       'bundle_upsell_after_first_pass');

  v_renewal := public.fn_emit_b2b_renewal_intents(true);
  v_upsell := public.fn_emit_bundle_upsell_intents(true);

  RETURN jsonb_build_object(
    'ok', v_intent_count = 5,
    'intents_present', v_intent_count,
    'intents_expected', 5,
    'renewal_producer_dry_run', v_renewal,
    'upsell_producer_dry_run', v_upsell,
    'timestamp', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_smoke_b2b_renewal_pipeline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_smoke_b2b_renewal_pipeline() TO authenticated;
