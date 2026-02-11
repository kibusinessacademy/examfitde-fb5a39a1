
-- Council 7 Phase 2: Approval flow + cooldown + dedupe

-- 1) Add cooldown + dedupe key
ALTER TABLE public.growth_actions
ADD COLUMN IF NOT EXISTS dedupe_key text NULL,
ADD COLUMN IF NOT EXISTS cooldown_until timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_growth_actions_user_status
ON public.growth_actions(target_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_actions_dedupe
ON public.growth_actions(dedupe_key);

-- 2) Dedupe gate trigger
CREATE OR REPLACE FUNCTION public.guard_growth_action_dedupe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_exists int;
BEGIN
  IF NEW.dedupe_key IS NULL OR NEW.target_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_exists
  FROM public.growth_actions
  WHERE target_user_id = NEW.target_user_id
    AND dedupe_key = NEW.dedupe_key
    AND status IN ('proposed','approved','sent')
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_exists > 0 THEN
    RAISE EXCEPTION 'Growth action blocked (dedupe): user=% dedupe_key=%', NEW.target_user_id, NEW.dedupe_key;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_growth_action_dedupe ON public.growth_actions;
CREATE TRIGGER trg_guard_growth_action_dedupe
BEFORE INSERT OR UPDATE ON public.growth_actions
FOR EACH ROW EXECUTE FUNCTION public.guard_growth_action_dedupe();

-- 3) Cooldown RPC
CREATE OR REPLACE FUNCTION public.set_growth_action_cooldown(
  p_action_id uuid,
  p_days int DEFAULT 3
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.growth_actions
  SET cooldown_until = now() + make_interval(days => p_days),
      updated_at = now()
  WHERE id = p_action_id;
END $$;

-- 4) Approve/Dismiss RPCs
CREATE OR REPLACE FUNCTION public.admin_approve_growth_action(p_action_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.growth_actions
  SET status = 'approved', updated_at = now()
  WHERE id = p_action_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_dismiss_growth_action(p_action_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.growth_actions
  SET status = 'dismissed', updated_at = now()
  WHERE id = p_action_id;
END $$;

-- 5) Learner-visible view: only approved, not cooled down
CREATE OR REPLACE VIEW public.v_growth_actions_approved AS
SELECT
  id, action_type, target_user_id, title, payload_json, rationale_json, created_at
FROM public.growth_actions
WHERE status = 'approved'
  AND (cooldown_until IS NULL OR cooldown_until <= now());
