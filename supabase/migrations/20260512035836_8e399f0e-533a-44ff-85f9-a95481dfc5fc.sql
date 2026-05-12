-- 1) Legacy alias for smoke cleanup (compat for older smoke RPCs)
CREATE OR REPLACE FUNCTION public._smoke_cleanup_orders(p_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._smoke_cleanup_launch_orders(p_ids);
$$;

REVOKE ALL ON FUNCTION public._smoke_cleanup_orders(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._smoke_cleanup_orders(uuid[]) TO service_role;

-- 2) Alert dedupe / suppression table
CREATE TABLE IF NOT EXISTS public.heal_alert_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL,
  reason text NOT NULL,
  cooldown_minutes int NOT NULL DEFAULT 60,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (alert_key)
);
ALTER TABLE public.heal_alert_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access heal_alert_suppressions" ON public.heal_alert_suppressions;
CREATE POLICY "service_role full access heal_alert_suppressions"
  ON public.heal_alert_suppressions FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "admins read heal_alert_suppressions" ON public.heal_alert_suppressions;
CREATE POLICY "admins read heal_alert_suppressions"
  ON public.heal_alert_suppressions FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) Suppression check used by the alert pipeline
CREATE OR REPLACE FUNCTION public.fn_alert_is_suppressed(p_alert_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.heal_alert_suppressions s
    LEFT JOIN LATERAL (
      SELECT max(created_at) AS last_alert_at
      FROM public.heal_alert_notifications n
      WHERE n.alert_key = s.alert_key
    ) n ON true
    WHERE s.alert_key = p_alert_key
      AND s.active
      AND (s.expires_at IS NULL OR s.expires_at > now())
      AND (
        n.last_alert_at IS NULL
        OR n.last_alert_at > now() - (s.cooldown_minutes || ' minutes')::interval
      )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_alert_is_suppressed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_alert_is_suppressed(text) TO authenticated, service_role;

-- 4) BEFORE INSERT trigger on heal_alert_notifications: skip if suppressed
CREATE OR REPLACE FUNCTION public.fn_dedupe_heal_alert_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.alert_key IS NOT NULL AND public.fn_alert_is_suppressed(NEW.alert_key) THEN
    INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
    VALUES ('heal_alert_suppressed','system','skipped',
      jsonb_build_object('alert_key',NEW.alert_key,'severity',NEW.severity,'channel',NEW.channel,'target',NEW.target));
    RETURN NULL; -- swallow insert
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dedupe_heal_alert_notification ON public.heal_alert_notifications;
CREATE TRIGGER trg_dedupe_heal_alert_notification
  BEFORE INSERT ON public.heal_alert_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_dedupe_heal_alert_notification();

-- 5) Bootstrap suppression for the now-fixed false positive
INSERT INTO public.heal_alert_suppressions(alert_key, reason, cooldown_minutes, active, expires_at)
VALUES (
  'launch.orders.paid_no_grant',
  'False-positive cleared 2026-05-12: synthetic E2E orders + cs_test_synthetic sessions filtered in fn_launch_orders_health + repair RPC; auto-repair cron 234 runs every 5min',
  120,
  true,
  now() + interval '7 days'
)
ON CONFLICT (alert_key) DO UPDATE
  SET reason = EXCLUDED.reason,
      cooldown_minutes = EXCLUDED.cooldown_minutes,
      active = true,
      expires_at = EXCLUDED.expires_at;