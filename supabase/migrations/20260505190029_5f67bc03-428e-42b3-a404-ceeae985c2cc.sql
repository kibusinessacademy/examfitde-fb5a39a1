
CREATE OR REPLACE FUNCTION public.admin_create_test_purchase_grant(
  _course_id uuid, _user_email text, _reason text DEFAULT 'manual_test'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid; v_curriculum_id uuid; v_grant_id uuid;
  v_product_id uuid; v_created boolean := false;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
         OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM public.courses WHERE id = _course_id;
  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_found');
  END IF;

  SELECT id INTO v_product_id FROM public.products
   WHERE curriculum_id=v_curriculum_id AND status='active'
   ORDER BY (visibility='public') DESC, created_at DESC LIMIT 1;

  SELECT id INTO v_user_id FROM auth.users WHERE email = _user_email LIMIT 1;

  IF v_user_id IS NULL THEN
    IF _user_email NOT LIKE '%@examfit-smoke.local' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'user_not_found',
        'hint','auto-provision only for *@examfit-smoke.local');
    END IF;

    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      v_user_id, '00000000-0000-0000-0000-000000000000',
      'authenticated','authenticated', _user_email,
      extensions.crypt(encode(extensions.gen_random_bytes(24),'hex'), extensions.gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider','email','providers',ARRAY['email']),
      jsonb_build_object('source','admin_test_grant_autoprovision')
    );

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_user_id,
            jsonb_build_object('sub', v_user_id::text, 'email', _user_email),
            'email', v_user_id::text, now(), now(), now())
    ON CONFLICT DO NOTHING;

    BEGIN
      INSERT INTO public.profiles (user_id, email, display_name)
      VALUES (v_user_id, _user_email, split_part(_user_email,'@',1))
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (v_user_id, 'learner') ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    v_created := true;
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('test_learner_autoprovisioned','user', v_user_id::text, 'success',
      jsonb_build_object('email', _user_email, 'reason', _reason));
  END IF;

  v_grant_id := public.grant_learner_course_access(
    v_user_id, v_curriculum_id, v_product_id, 'test_purchase', NULL::uuid,
    jsonb_build_object('reason', _reason, 'source','admin_create_test_purchase_grant')
  );

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('test_purchase_grant_created','user', v_user_id::text, 'success',
    jsonb_build_object('email', _user_email, 'course_id', _course_id,
                       'curriculum_id', v_curriculum_id, 'product_id', v_product_id,
                       'grant_id', v_grant_id,
                       'user_autoprovisioned', v_created, 'reason', _reason));

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant_id,
    'user_id', v_user_id, 'user_autoprovisioned', v_created,
    'course_id', _course_id, 'curriculum_id', v_curriculum_id, 'product_id', v_product_id);
END $$;

DO $$ DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role', true);
  v := public.admin_create_test_purchase_grant(
    '8eaabd56-3ee8-44da-9baf-345997a4c081'::uuid,
    'e2e+grant@examfit-smoke.local',
    'bypass smoke 2026-05-05 fast-lane');
  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('bypass_smoke_grant_run','system','success',v);
END $$;
