
DROP FUNCTION IF EXISTS public.fn_link_visitor_attribution(text, uuid);

CREATE FUNCTION public.fn_link_visitor_attribution(
  _visitor_id text,
  _user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE partner_attributions
  SET user_id = _user_id,
      updated_at = now()
  WHERE visitor_id = _visitor_id
    AND attribution_status = 'active'
    AND consumed_at IS NULL
    AND expired_at IS NULL
    AND (user_id IS NULL OR user_id = _user_id);
END;
$$;
