DO $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_results jsonb := '[]'::jsonb;
  v_call jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('c2e41dc3-0fdb-4906-a694-485d0ddea180'::uuid, 'f95c70f0-d86c-4b21-9b91-843fe750074a'::uuid, 'b960658d-95e9-4824-a404-821d5e9b5142'::uuid, 'pruefungsfragen',         '64c01df7-c51a-4ca1-ad62-2d12234d41cd'::uuid),
      ('c2e41dc3-0fdb-4906-a694-485d0ddea180'::uuid, 'f95c70f0-d86c-4b21-9b91-843fe750074a'::uuid, 'b960658d-95e9-4824-a404-821d5e9b5142'::uuid, 'intent_typische_fehler', '0acf4287-d013-4e11-ad10-812065fea9db'::uuid),
      ('0e2605f4-20f8-44c8-b224-4b97a3511add'::uuid, '572a9aa3-fcd7-4380-adb4-37495d74c846'::uuid, 'ccdcb409-b708-460c-834d-254a382f8b28'::uuid, 'durchfallquote',         'd26ffb77-126d-4ccb-aea4-371f7389b097'::uuid),
      ('0e2605f4-20f8-44c8-b224-4b97a3511add'::uuid, '572a9aa3-fcd7-4380-adb4-37495d74c846'::uuid, 'ccdcb409-b708-460c-834d-254a382f8b28'::uuid, 'lernplan',               'd06fa45a-c0c9-4f46-9f86-7a1debe913fe'::uuid)
    ) AS t(curriculum_id, competency_id, package_id, intent_key, pq_id)
  LOOP
    -- Attempt 1 (dry_run)
    v_call := admin_seo_wave_enqueue_one(r.curriculum_id, r.competency_id, r.package_id, r.intent_key, 'azubi', 99, r.pq_id, 'smoke_dry_run_2026-05-15', 5, true);
    v_results := v_results || jsonb_build_object('intent', r.intent_key, 'attempt', 1, 'status', v_call->>'status', 'idem', v_call->>'idempotency_key');
    -- Attempt 2 (dry_run, same input)
    v_call := admin_seo_wave_enqueue_one(r.curriculum_id, r.competency_id, r.package_id, r.intent_key, 'azubi', 99, r.pq_id, 'smoke_dry_run_2026-05-15', 5, true);
    v_results := v_results || jsonb_build_object('intent', r.intent_key, 'attempt', 2, 'status', v_call->>'status', 'idem', v_call->>'idempotency_key');
  END LOOP;

  INSERT INTO auto_heal_log (id, action_type, target_type, target_id, result_status, metadata)
  VALUES (
    v_run_id,
    'seo_wave_enqueue_smoke',
    'system',
    NULL,
    'completed',
    jsonb_build_object(
      'run_id', v_run_id,
      'mode', 'dry_run',
      'call_count', jsonb_array_length(v_results),
      'results', v_results,
      'expected', '8x dry_run',
      'ts', now()
    )
  );
END $$;