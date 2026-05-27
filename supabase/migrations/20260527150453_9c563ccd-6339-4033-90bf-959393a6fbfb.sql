-- 1) vertical_subscriptions
CREATE TABLE IF NOT EXISTS public.vertical_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vertical_slug text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('starter','professional','enterprise')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','past_due','canceled','expired')),
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  stripe_price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  monthly_vorgang_limit integer NOT NULL DEFAULT 300,
  vorgaenge_used_current_period integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vertical_subscriptions_user
  ON public.vertical_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_vertical_subscriptions_user_vertical_active
  ON public.vertical_subscriptions(user_id, vertical_slug)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE ON public.vertical_subscriptions TO authenticated;
GRANT ALL ON public.vertical_subscriptions TO service_role;

ALTER TABLE public.vertical_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own vertical subs"
  ON public.vertical_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service role full vertical subs"
  ON public.vertical_subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "admins manage vertical subs"
  ON public.vertical_subscriptions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) vertical_usage_events
CREATE TABLE IF NOT EXISTS public.vertical_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.vertical_subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  vertical_slug text NOT NULL,
  action_type text NOT NULL,
  vorgaenge_consumed integer NOT NULL DEFAULT 1 CHECK (vorgaenge_consumed > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vertical_usage_subscription
  ON public.vertical_usage_events(subscription_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_vertical_usage_user
  ON public.vertical_usage_events(user_id, occurred_at DESC);

GRANT SELECT ON public.vertical_usage_events TO authenticated;
GRANT ALL ON public.vertical_usage_events TO service_role;

ALTER TABLE public.vertical_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own usage"
  ON public.vertical_usage_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service role write usage"
  ON public.vertical_usage_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3) updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_vertical_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vertical_subscriptions_updated_at ON public.vertical_subscriptions;
CREATE TRIGGER trg_vertical_subscriptions_updated_at
  BEFORE UPDATE ON public.vertical_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_vertical_subscriptions_updated_at();

-- 4) helper to get active subscription
CREATE OR REPLACE FUNCTION public.get_active_vertical_subscription(
  _user_id uuid,
  _vertical_slug text
)
RETURNS public.vertical_subscriptions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.vertical_subscriptions
  WHERE user_id = _user_id
    AND vertical_slug = _vertical_slug
    AND status = 'active'
    AND (current_period_end IS NULL OR current_period_end > now())
  ORDER BY created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_vertical_subscription(uuid, text) TO authenticated, service_role;