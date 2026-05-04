
CREATE OR REPLACE FUNCTION public._admin_drift_wave_heal_2026_05_04()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v := public.admin_heal_pending_enqueue_drift(
    ARRAY['163b33c0-2d1b-4eb0-bb6b-d3b4bf10eac6','351260d4-4351-4c0a-8593-10b2ab163e45','3b67d34c-42c6-4990-b813-18ee96975b6c','41b8c6db-059b-44ff-986b-5d2e7f212a0c','4ee66313-e8e7-4c82-9b08-3e2c7b10c9ef','55edacdf-5230-4e9a-b9c1-dcde00b8cd47','56aee54d-5fd6-4f18-90c0-c6f7f493618a','5d74dcbf-8ae7-4c82-b181-09e23f02dd2c','96d0fb31-9951-408d-a83e-b2937f5a6af8','a02cde5e-a0ad-45fc-a5db-ffe239d387f5','a9f19137-a004-4850-838a-bdc8f8a705f5','adce63f4-03ba-49ec-964c-c35e3984a591','d2000001-0009-4000-8000-000000000001','eebb9776-4634-4118-8f53-9329c5018e66']::uuid[],
    'drift_wave_2026_05_04', false);
  RETURN v;
END $$;

DO $$ DECLARE r jsonb;
BEGIN r := public._admin_drift_wave_heal_2026_05_04();
  RAISE NOTICE 'wave heal: %', r;
END $$;

DROP FUNCTION public._admin_drift_wave_heal_2026_05_04();
