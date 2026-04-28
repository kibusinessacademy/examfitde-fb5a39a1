DO $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'likeitmark9@gmail.com' LIMIT 1;
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'ds-v2-test-org' LIMIT 1;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE org_type = 'COMPANY' ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO public.org_memberships (org_id, user_id, role, status, joined_at)
  VALUES (v_org_id, v_user_id, 'owner', 'active', now())
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', status = 'active';
END $$;