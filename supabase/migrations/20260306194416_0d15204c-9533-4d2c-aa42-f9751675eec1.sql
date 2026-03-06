
-- Auto-heal configuration table
CREATE TABLE public.auto_heal_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  threshold_minutes integer DEFAULT 30,
  max_per_run integer DEFAULT 20,
  cooldown_minutes integer DEFAULT 10,
  config_json jsonb DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  last_run_result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.auto_heal_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read auto_heal_config"
  ON public.auto_heal_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin update auto_heal_config"
  ON public.auto_heal_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default policies
INSERT INTO public.auto_heal_config (policy_key, label, description, enabled, threshold_minutes, max_per_run, cooldown_minutes) VALUES
  ('requeue_transient_failed', 'Transient Failed Jobs requeue', 'Jobs mit transienten Fehlern (503, Timeout, Rate-Limit) automatisch auf pending zurücksetzen', false, 5, 20, 10),
  ('release_expired_cooldowns', 'Abgelaufene Cooldowns lösen', 'Provider-Cooldowns automatisch freigeben wenn cooldown_until abgelaufen', true, 0, 50, 5),
  ('reset_stuck_steps', 'Stuck Steps zurücksetzen', 'Pipeline-Steps die länger als threshold_minutes hängen automatisch auf queued resetten', false, 60, 10, 15),
  ('cancel_zombies', 'Zombie-Pakete blockieren', 'Pakete im Build-Status ohne aktive Jobs/Leases nach Schwellenwert blockieren', false, 120, 10, 30);

-- Extend admin_actions with before/after audit columns
ALTER TABLE public.admin_actions
  ADD COLUMN IF NOT EXISTS before_state jsonb,
  ADD COLUMN IF NOT EXISTS after_state jsonb,
  ADD COLUMN IF NOT EXISTS affected_ids text[],
  ADD COLUMN IF NOT EXISTS scope text;
