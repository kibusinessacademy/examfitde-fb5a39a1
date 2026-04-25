
DROP FUNCTION IF EXISTS public.admin_resolve_repair_strategy_for_package(uuid);

CREATE OR REPLACE FUNCTION public.admin_resolve_repair_strategy_for_package(
  _package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_history record;
  v_hardish_pct numeric;
  v_target_hardish numeric := 45;
  v_strategy text;
  v_reason text;
  v_setting jsonb;
  v_enabled boolean;
  v_handler_registered boolean;
  v_match text;
BEGIN
  SELECT * INTO v_history
  FROM public.integrity_check_history
  WHERE package_id = _package_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_history IS NULL THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','no_integrity_history',
      'package_id', _package_id
    );
  END IF;

  -- Extract hardish_pct from hard_fail_reasons array (e.g. "hardish_too_low_20.5_pct_...")
  v_hardish_pct := 100;  -- default = no defect
  IF v_history.hard_fail_reasons IS NOT NULL THEN
    SELECT (regexp_match(reason, 'hardish_too_low_([0-9.]+)_pct'))[1]
    INTO v_match
    FROM unnest(v_history.hard_fail_reasons) AS reason
    WHERE reason ILIKE 'hardish_too_low%'
    LIMIT 1;

    IF v_match IS NOT NULL THEN
      v_hardish_pct := v_match::numeric;
    END IF;
  END IF;

  SELECT value INTO v_setting
  FROM public.admin_settings
  WHERE key = 'heal_strategy_hardish_balance';

  v_enabled := COALESCE((v_setting->>'enabled')::boolean, false);
  v_handler_registered := COALESCE((v_setting->>'handler_registered')::boolean, false);

  IF v_hardish_pct < v_target_hardish THEN
    IF v_enabled AND v_handler_registered THEN
      v_strategy := 'package_repair_hardish_balance';
      v_reason := format(
        'hardish_too_low_%s_pct_target_%s_pct_handler_active',
        round(v_hardish_pct,1), v_target_hardish
      );
    ELSE
      v_strategy := 'manual_review_required';
      v_reason := format(
        'hardish_too_low_%s_pct_target_%s_pct_handler_%s',
        round(v_hardish_pct,1), v_target_hardish,
        CASE
          WHEN NOT v_handler_registered THEN 'not_registered'
          WHEN NOT v_enabled THEN 'toggle_disabled'
          ELSE 'unknown'
        END
      );
    END IF;
  ELSE
    v_strategy := 'no_repair_needed';
    v_reason := 'hardish_within_target';
  END IF;

  INSERT INTO public.admin_notifications (category, severity, title, body, metadata)
  VALUES (
    'heal_strategy_resolver',
    'info',
    'Resolver decision',
    format('pkg=%s strategy=%s reason=%s', _package_id, v_strategy, v_reason),
    jsonb_build_object(
      'package_id', _package_id,
      'strategy', v_strategy,
      'reason', v_reason,
      'toggle_enabled', v_enabled,
      'handler_registered', v_handler_registered,
      'hardish_pct', v_hardish_pct
    )
  );

  RETURN jsonb_build_object(
    'strategy', v_strategy,
    'reason', v_reason,
    'package_id', _package_id,
    'hardish_pct', v_hardish_pct,
    'toggle_enabled', v_enabled,
    'handler_registered', v_handler_registered
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_resolve_repair_strategy_for_package(uuid) TO authenticated;

-- Block-Diagnose Patterns erweitern
CREATE OR REPLACE FUNCTION public.admin_get_package_block_diagnosis(
  p_package_id uuid
)
RETURNS TABLE(
  step_key text,
  status text,
  block_type text,
  block_detail text,
  attempts integer,
  last_error text,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ps.step_key::text,
    ps.status::text,
    CASE
      WHEN ps.last_error ILIKE '%COVERAGE_GAP%' THEN 'COVERAGE_GAP'
      WHEN ps.last_error ILIKE 'PREREQ_NOT_DONE%' THEN 'PREREQ'
      WHEN ps.last_error ILIKE 'CAUSALITY_BLOCKED%' THEN 'CAUSALITY'
      WHEN ps.last_error ILIKE 'GATE_FAIL%' THEN 'GATE_FAIL'
      WHEN ps.last_error ILIKE 'QUALITY_THRESHOLD_NOT_MET%' THEN 'QUALITY'
      WHEN ps.last_error ILIKE 'HTTP 5%' THEN 'HTTP_500'
      WHEN ps.last_error ILIKE '%crash%' THEN 'HTTP_500'
      WHEN ps.last_error IS NULL AND ps.status::text IN ('queued','pending') THEN 'WAITING_DEPENDENCY'
      ELSE 'OTHER'
    END::text AS block_type,
    COALESCE(ps.last_error, '(no error)')::text AS block_detail,
    COALESCE(ps.attempts,0)::integer AS attempts,
    ps.last_error::text,
    ps.updated_at
  FROM public.package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status::text IN ('queued','pending','running','failed')
  ORDER BY ps.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_package_block_diagnosis(uuid) TO authenticated;
