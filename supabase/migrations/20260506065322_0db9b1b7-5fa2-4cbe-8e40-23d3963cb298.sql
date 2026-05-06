CREATE OR REPLACE FUNCTION public.submit_b2b_demo_request(
  p_company_name text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_azubi_count integer DEFAULT NULL,
  p_seats integer DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_source text DEFAULT 'website'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_meta jsonb;
BEGIN
  IF p_company_name IS NULL OR length(trim(p_company_name)) < 2 THEN
    RAISE EXCEPTION 'company_name required' USING ERRCODE = '22023';
  END IF;
  IF p_contact_email IS NULL OR p_contact_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'valid contact_email required' USING ERRCODE = '22023';
  END IF;

  v_meta := jsonb_build_object(
    'seats', p_seats,
    'message', p_message,
    'submitted_at', now()
  );

  INSERT INTO public.b2b_leads (
    company_name, contact_name, contact_email, contact_phone,
    industry, azubi_count, source, status, notes, meta
  ) VALUES (
    trim(p_company_name), p_contact_name, lower(trim(p_contact_email)), p_contact_phone,
    p_industry, p_azubi_count,
    COALESCE(p_source, 'website'),
    'new',
    p_message,
    v_meta
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_b2b_demo_request(text,text,text,text,text,integer,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_b2b_demo_request(text,text,text,text,text,integer,integer,text,text) TO anon, authenticated;