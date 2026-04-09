
-- Link visitor-based attributions to authenticated user
CREATE OR REPLACE FUNCTION public.fn_link_visitor_attribution(
  _visitor_id text,
  _user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  UPDATE partner_attributions
  SET user_id = _user_id,
      updated_at = now()
  WHERE attribution_status = 'active'
    AND consumed_at IS NULL
    AND user_id IS NULL
    AND metadata_json->>'visitor_id' = _visitor_id;
  
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;
