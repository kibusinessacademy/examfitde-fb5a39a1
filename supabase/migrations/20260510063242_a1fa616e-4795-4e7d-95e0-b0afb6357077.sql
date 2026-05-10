DO $$
BEGIN
  RAISE NOTICE 'current_user=% session_user=% current_setting_role=% auth_uid=%',
    current_user, session_user, current_setting('role', true), auth.uid();
END $$;