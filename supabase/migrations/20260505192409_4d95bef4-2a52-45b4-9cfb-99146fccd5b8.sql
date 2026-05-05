-- Patch admin_create_test_purchase_grant + admin_smoke_reset_password to insert auth.users with empty strings (not NULL) in token columns
-- Backfill: fix any other smoke users with NULL tokens
UPDATE auth.users SET 
  confirmation_token = COALESCE(confirmation_token,''),
  recovery_token = COALESCE(recovery_token,''),
  email_change = COALESCE(email_change,''),
  email_change_token_new = COALESCE(email_change_token_new,''),
  email_change_token_current = COALESCE(email_change_token_current,''),
  reauthentication_token = COALESCE(reauthentication_token,''),
  phone_change = COALESCE(phone_change,''),
  phone_change_token = COALESCE(phone_change_token,'')
WHERE confirmation_token IS NULL OR recovery_token IS NULL OR email_change IS NULL 
   OR email_change_token_new IS NULL OR email_change_token_current IS NULL 
   OR reauthentication_token IS NULL OR phone_change IS NULL OR phone_change_token IS NULL;

-- Wrap auto-provisioning helper used by admin_create_test_purchase_grant + admin_smoke_reset_password
CREATE OR REPLACE FUNCTION public.fn_provision_smoke_auth_user(p_email text, p_password text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_email !~* '@examfit-smoke\.local$' THEN
    RAISE EXCEPTION 'only @examfit-smoke.local emails allowed';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
  IF v_user_id IS NOT NULL THEN
    UPDATE auth.users SET
      encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      confirmation_token = '', recovery_token = '', email_change = '',
      email_change_token_new = '', email_change_token_current = '',
      reauthentication_token = '', phone_change = '', phone_change_token = '',
      updated_at = now()
    WHERE id = v_user_id;
    RETURN v_user_id;
  END IF;

  v_user_id := gen_random_uuid();
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    reauthentication_token, phone_change, phone_change_token,
    is_sso_user, is_anonymous, email_change_confirm_status
  ) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid, v_user_id, 'authenticated','authenticated',
    p_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('source','smoke_provision'), now(), now(),
    '', '', '', '', '', '', '', '',
    false, false, 0
  );

  INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at, last_sign_in_at)
  VALUES (gen_random_uuid(), v_user_id, 'email', v_user_id::text,
          jsonb_build_object('sub', v_user_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
          now(), now(), now());

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_provision_smoke_auth_user(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_provision_smoke_auth_user(text, text) TO service_role;