
DO $$
DECLARE
  pkg_ids uuid[] := ARRAY[
    '9c1b3734-bb25-4986-baef-5bb1c20a212c'::uuid,
    'fd1d8192-a16f-496b-80c8-5e06f70ec21a'::uuid
  ];
  pkg_id uuid;
BEGIN
  UPDATE public.course_packages
  SET feature_flags = jsonb_set(coalesce(feature_flags,'{}'::jsonb), '{has_minichecks}', 'true'::jsonb, true),
      updated_at = now()
  WHERE id = ANY(pkg_ids);

  FOREACH pkg_id IN ARRAY pkg_ids LOOP
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
    VALUES
      ('ux_gap_detected',
       'course_package',
       pkg_id::text,
       'reality_audit',
       'success',
       'minicheck_flag_drift healed: feature_flags.has_minichecks=true',
       jsonb_build_object(
         'gap', 'minicheck_flag_drift',
         'reason', 'minichecks vorhanden, flag stand auf false',
         'fix', 'feature_flags.has_minichecks=true',
         'source', 'reality_audit_2026_06_24'
       ));
  END LOOP;
END $$;
