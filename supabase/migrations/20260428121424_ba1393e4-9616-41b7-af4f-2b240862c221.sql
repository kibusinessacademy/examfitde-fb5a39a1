DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'ds-v2-test@examfit.de';
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Test user not found';
    RETURN;
  END IF;

  INSERT INTO public.learner_course_grants (user_id, curriculum_id, source, status, granted_at, activated_at)
  VALUES (v_user_id, 'a8a6340d-fd50-445f-a55b-7d5a6c72e2e1', 'admin_test_grant', 'active', now(), now())
  ON CONFLICT DO NOTHING;
END $$;