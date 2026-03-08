
-- Budget policies table
CREATE TABLE IF NOT EXISTS public.ai_budget_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  daily_limit_eur numeric(12,4) NOT NULL DEFAULT 0,
  wave_limit_eur numeric(12,4) NOT NULL DEFAULT 0,
  package_limit_eur numeric(12,4) NOT NULL DEFAULT 0,
  hard_stop boolean NOT NULL DEFAULT true,
  warn_threshold_pct numeric(5,2) NOT NULL DEFAULT 80,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_budget_policies ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ai_budget_policies (
  policy_key, is_enabled,
  daily_limit_eur, wave_limit_eur, package_limit_eur,
  hard_stop, warn_threshold_pct
) VALUES (
  'factory_default', true,
  250.00, 75.00, 8.00,
  true, 80
) ON CONFLICT (policy_key) DO NOTHING;

-- Budget guard check RPC
CREATE OR REPLACE FUNCTION public.check_ai_budget_guard(
  p_wave_id uuid DEFAULT NULL,
  p_package_id uuid DEFAULT NULL,
  p_policy_key text DEFAULT 'factory_default'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy record;
  v_daily_spend numeric := 0;
  v_wave_spend numeric := 0;
  v_package_spend numeric := 0;
  v_daily_pct numeric := 0;
  v_wave_pct numeric := 0;
  v_package_pct numeric := 0;
  v_blocked boolean := false;
  v_reason text := null;
BEGIN
  SELECT *
  INTO v_policy
  FROM public.ai_budget_policies
  WHERE policy_key = p_policy_key
    AND is_enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'policy_found', false, 'blocked', false
    );
  END IF;

  -- Daily spend from ai_generations
  BEGIN
    SELECT COALESCE(sum(cost_eur), 0)
    INTO v_daily_spend
    FROM public.ai_generations
    WHERE created_at >= date_trunc('day', now());
  EXCEPTION WHEN OTHERS THEN
    v_daily_spend := 0;
  END;

  -- Wave spend
  IF p_wave_id IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(sum(ag.cost_eur), 0)
      INTO v_wave_spend
      FROM public.ai_generations ag
      JOIN public.production_wave_items wi ON wi.package_id::text = ag.entity_id
      WHERE wi.wave_id = p_wave_id
        AND ag.entity_type = 'package';
    EXCEPTION WHEN OTHERS THEN
      v_wave_spend := 0;
    END;
  END IF;

  -- Package spend
  IF p_package_id IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(sum(cost_eur), 0)
      INTO v_package_spend
      FROM public.ai_generations
      WHERE entity_id = p_package_id::text
        AND entity_type = 'package';
    EXCEPTION WHEN OTHERS THEN
      v_package_spend := 0;
    END;
  END IF;

  v_daily_pct := CASE WHEN v_policy.daily_limit_eur > 0
    THEN round(v_daily_spend / v_policy.daily_limit_eur * 100, 2) ELSE 0 END;
  v_wave_pct := CASE WHEN v_policy.wave_limit_eur > 0
    THEN round(v_wave_spend / v_policy.wave_limit_eur * 100, 2) ELSE 0 END;
  v_package_pct := CASE WHEN v_policy.package_limit_eur > 0
    THEN round(v_package_spend / v_policy.package_limit_eur * 100, 2) ELSE 0 END;

  IF v_policy.hard_stop THEN
    IF v_policy.daily_limit_eur > 0 AND v_daily_spend >= v_policy.daily_limit_eur THEN
      v_blocked := true; v_reason := 'daily_limit_reached';
    ELSIF v_policy.wave_limit_eur > 0 AND p_wave_id IS NOT NULL AND v_wave_spend >= v_policy.wave_limit_eur THEN
      v_blocked := true; v_reason := 'wave_limit_reached';
    ELSIF v_policy.package_limit_eur > 0 AND p_package_id IS NOT NULL AND v_package_spend >= v_policy.package_limit_eur THEN
      v_blocked := true; v_reason := 'package_limit_reached';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'policy_found', true,
    'blocked', v_blocked,
    'reason', v_reason,
    'warn_threshold_pct', v_policy.warn_threshold_pct,
    'daily_spend_eur', round(v_daily_spend, 4),
    'wave_spend_eur', round(v_wave_spend, 4),
    'package_spend_eur', round(v_package_spend, 4),
    'daily_limit_eur', v_policy.daily_limit_eur,
    'wave_limit_eur', v_policy.wave_limit_eur,
    'package_limit_eur', v_policy.package_limit_eur,
    'daily_pct', v_daily_pct,
    'wave_pct', v_wave_pct,
    'package_pct', v_package_pct,
    'warn_daily', v_daily_pct >= v_policy.warn_threshold_pct,
    'warn_wave', v_wave_pct >= v_policy.warn_threshold_pct,
    'warn_package', v_package_pct >= v_policy.warn_threshold_pct
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_ai_budget_guard(uuid, uuid, text) TO service_role;

-- Pause wave for budget
CREATE OR REPLACE FUNCTION public.pause_wave_for_budget(
  p_wave_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.production_waves
  SET
    status = 'paused',
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'budget_paused', true,
      'budget_pause_reason', p_reason,
      'budget_pause_at', now()
    )
  WHERE id = p_wave_id;

  RETURN jsonb_build_object(
    'ok', true,
    'wave_id', p_wave_id,
    'status', 'paused',
    'reason', p_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pause_wave_for_budget(uuid, text) TO service_role;
