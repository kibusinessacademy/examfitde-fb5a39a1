
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role', true);
  v := public.admin_create_test_purchase_grant(
    '8eaabd56-3ee8-44da-9baf-345997a4c081'::uuid,
    'e2e+grant@examfit-smoke.local',
    'bypass smoke 2026-05-05 (auto-promote+alerts deploy)'
  );
  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('bypass_smoke_grant_run','system','success',v);
END $$;

SELECT public.admin_auto_promote_ready_courses(false);
