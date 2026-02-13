
CREATE OR REPLACE FUNCTION public.claim_provider_slot(p_provider text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  UPDATE provider_status
  SET current_load = current_load + 1,
      updated_at = now()
  WHERE provider = p_provider
    AND current_load < max_concurrency
    AND is_healthy = true
    AND (rate_limited_until IS NULL OR rate_limited_until < now());
  
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
