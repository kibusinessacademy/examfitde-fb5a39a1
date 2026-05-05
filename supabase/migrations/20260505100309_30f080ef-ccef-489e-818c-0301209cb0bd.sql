-- 1) QA Test-User anlegen (idempotent)
DO $$
DECLARE
  v_user_id uuid;
  v_email text := 'qa-allaccess@examfit.test';
  v_password text := 'QaAllAccess_2026!';
  r RECORD;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated', v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',ARRAY['email']),
      jsonb_build_object('full_name','QA All Access'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_user_id,
            jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
            'email', v_user_id::text, now(), now(), now());
  ELSE
    UPDATE auth.users
       SET encrypted_password = crypt(v_password, gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = v_user_id;
  END IF;

  -- 2) Grants für alle published Curricula
  FOR r IN
    SELECT DISTINCT cp.curriculum_id
    FROM course_packages cp
    WHERE cp.status = 'published' AND cp.curriculum_id IS NOT NULL
  LOOP
    PERFORM public.grant_learner_course_access(
      v_user_id, r.curriculum_id, NULL, 'qa_all_access', NULL,
      jsonb_build_object('reason','qa_test_user','granted_by','migration')
    );
  END LOOP;
END $$;