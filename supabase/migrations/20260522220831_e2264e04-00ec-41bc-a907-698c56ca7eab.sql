INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('scaffold_manifest_generated',
   ARRAY['package_id','file_count','total_bytes']::text[],
   'p13_export_preview'),
  ('scaffold_export_filtered',
   ARRAY['package_id','accepted_count','rejected_count','accepted_paths']::text[],
   'p13_export_preview')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module  = EXCLUDED.owner_module,
      updated_at    = now();

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.ops_audit_contract
  WHERE action_type IN ('scaffold_manifest_generated','scaffold_export_filtered');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'P13a smoke fail: expected 2 contracts, got %', v_count;
  END IF;
END $$;