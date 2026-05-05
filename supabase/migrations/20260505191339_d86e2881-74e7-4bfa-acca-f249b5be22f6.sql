-- RPC: set a known password for an E2E smoke learner OR generate a magic link.
-- service_role + admin only. Restricted to @examfit-smoke.local domain.

CREATE OR REPLACE FUNCTION public.admin_smoke_reset_password(
  p_email text,
  p_new_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid;
  v_password text;
  v_caller uuid := auth.uid();
BEGIN
  -- Auth gate: service_role OR admin role
  IF current_setting('role', true) <> 'service_role'
     AND NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Domain restriction
  IF p_email !~* '@examfit-smoke\.local$' THEN
    RAISE EXCEPTION 'only @examfit-smoke.local emails are allowed for smoke reset';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status','user_not_found','email',p_email);
  END IF;

  v_password := COALESCE(p_new_password, 'SmokeTest_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12) || '!');

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = v_user_id;

  INSERT INTO public.admin_actions (action_type, target_type, target_id, performed_by, metadata)
  VALUES ('smoke_password_reset', 'auth.user', v_user_id, v_caller,
          jsonb_build_object('email', p_email, 'caller_role', current_setting('role', true)));

  RETURN jsonb_build_object(
    'status','ok',
    'user_id', v_user_id,
    'email', p_email,
    'password', v_password
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_smoke_reset_password(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_smoke_reset_password(text, text) TO service_role;