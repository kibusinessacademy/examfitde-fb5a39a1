WITH targets(curriculum_id, competency_id, package_id, intent_key, label) AS (
  VALUES
    ('b33edd39-2038-464d-ada3-cd149a4a1a20'::uuid,'4c769032-d471-41d8-8f4d-e99509b2fb15'::uuid,'adce63f4-03ba-49ec-964c-c35e3984a591'::uuid,'intent_pruefungsfragen','Fachlagerist/pruefungsfragen'),
    ('b33edd39-2038-464d-ada3-cd149a4a1a20'::uuid,'4c769032-d471-41d8-8f4d-e99509b2fb15'::uuid,'adce63f4-03ba-49ec-964c-c35e3984a591'::uuid,'intent_lernplan','Fachlagerist/lernplan'),
    ('97a5a99f-05fb-4328-b298-72268a4b6f84'::uuid,'a735a0b6-7d30-40b4-92fb-ea16e2fda09a'::uuid,'a9f19137-a004-4850-838a-bdc8f8a705f5'::uuid,'intent_pruefungsfragen','Steuerfach/pruefungsfragen'),
    ('97a5a99f-05fb-4328-b298-72268a4b6f84'::uuid,'a735a0b6-7d30-40b4-92fb-ea16e2fda09a'::uuid,'a9f19137-a004-4850-838a-bdc8f8a705f5'::uuid,'intent_lernplan','Steuerfach/lernplan'),
    ('63635f46-0186-49e7-80c1-67925dbdf638'::uuid,'d8ff6c49-fce9-498b-be6d-0001ff006449'::uuid,'59b6e214-e181-4c2b-986e-1ce544984d04'::uuid,'intent_pruefungsfragen','Verkäufer/pruefungsfragen'),
    ('63635f46-0186-49e7-80c1-67925dbdf638'::uuid,'d8ff6c49-fce9-498b-be6d-0001ff006449'::uuid,'59b6e214-e181-4c2b-986e-1ce544984d04'::uuid,'intent_lernplan','Verkäufer/lernplan')
),
results AS (
  SELECT t.label,
         admin_seo_wave_enqueue_one(t.curriculum_id, t.competency_id, t.package_id, t.intent_key, 'azubi', 5, NULL, 'wave5_skeleton_progression', 5, true) AS r
  FROM targets t
)
INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
SELECT 'seo_wave5_dryrun', 'system', 'success',
       jsonb_build_object('results', jsonb_agg(jsonb_build_object('label', label, 'r', r)))
FROM results;