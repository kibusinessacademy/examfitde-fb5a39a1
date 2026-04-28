DO $$
DECLARE
  v_user_id   uuid;
  v_org_id    uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'likeitmark9@gmail.com';
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Admin user likeitmark9@gmail.com not found — skipping.';
    RETURN;
  END IF;

  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = 'ds-v2-test-org'
     OR name ILIKE '%ds-v2-test%'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'Test organization ds-v2-test-org not found — skipping.';
    RETURN;
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_org_id, v_user_id, 'admin', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        status = 'active';

  RAISE NOTICE 'Admin user % added to org % as admin', v_user_id, v_org_id;
END$$;