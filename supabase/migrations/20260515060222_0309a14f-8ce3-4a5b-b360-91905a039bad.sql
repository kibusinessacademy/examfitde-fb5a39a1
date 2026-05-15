DO $$
DECLARE
  v_seeded int;
  v_enqueued int;
BEGIN
  WITH anchors(curriculum_id, competency_id, package_id) AS (VALUES
    ('97a5a99f-05fb-4328-b298-72268a4b6f84'::uuid, 'a735a0b6-7d30-40b4-92fb-ea16e2fda09a'::uuid, 'a9f19137-a004-4850-838a-bdc8f8a705f5'::uuid),
    ('b4a6641a-c4f7-4d6d-a108-2e78ffc1ca75'::uuid, '2c6be03e-9299-4e79-bbeb-4eb6da196be6'::uuid, '6a2c6859-4b3b-4f6e-b32d-c2574a1333ad'::uuid),
    ('2c01d31e-e7ed-4b82-b04e-d5094d1dc179'::uuid, '16a18088-0bee-47bc-8f11-555636fbc8eb'::uuid, '9c1b3734-bb25-4986-baef-5bb1c20a212c'::uuid),
    ('e24f7b10-0740-4729-8abe-e10fe765f6db'::uuid, '5642f1a1-75c5-48da-8d33-0d47d4cd2bed'::uuid, '2e8da39f-60f8-44d9-8b70-e1176222ca55'::uuid),
    ('63635f46-0186-49e7-80c1-67925dbdf638'::uuid, 'd8ff6c49-fce9-498b-be6d-0001ff006449'::uuid, '59b6e214-e181-4c2b-986e-1ce544984d04'::uuid),
    ('b33edd39-2038-464d-ada3-cd149a4a1a20'::uuid, '4c769032-d471-41d8-8f4d-e99509b2fb15'::uuid, 'adce63f4-03ba-49ec-964c-c35e3984a591'::uuid)
  ),
  intents(intent_key) AS (VALUES
    ('intent_pruefungsfragen'),('intent_typische_fehler'),('intent_durchfallquote'),('intent_lernplan')
  ),
  seed AS (
    INSERT INTO seo_content_priority_queue (
      curriculum_id, competency_id, intent_key, persona_type, wave, generation_status, last_evaluated_at
    )
    SELECT a.curriculum_id, a.competency_id, i.intent_key, 'azubi', 3, 'ready', now()
    FROM anchors a CROSS JOIN intents i
    ON CONFLICT (curriculum_id, competency_id, intent_key, persona_type) DO UPDATE
      SET wave=3, generation_status='ready', last_evaluated_at=now()
    RETURNING id, curriculum_id, competency_id, intent_key
  ),
  seed_with_pkg AS (
    SELECT s.*, a.package_id
    FROM seed s
    JOIN anchors a ON a.curriculum_id = s.curriculum_id
  ),
  enq AS (
    INSERT INTO job_queue (job_type, package_id, payload, status, priority)
    SELECT 'seo_intent_page_generate', sp.package_id,
           jsonb_build_object(
             'wave', 3,
             'package_id', sp.package_id,
             'persona_type', 'azubi',
             'competency_id', sp.competency_id,
             'curriculum_id', sp.curriculum_id,
             'enqueue_source', 'wave3_seed_2026-05-15',
             'intent_template', sp.intent_key,
             'priority_queue_id', sp.id,
             'learning_field_filter', sp.intent_key || ':' || left(sp.competency_id::text, 8)
           ),
           'pending', 5
    FROM seed_with_pkg sp
    RETURNING id, payload
  ),
  link AS (
    UPDATE seo_content_priority_queue q
       SET job_id = e.id,
           generation_status = 'queued',
           last_enqueued_at = now()
      FROM enq e
     WHERE q.id = (e.payload->>'priority_queue_id')::uuid
     RETURNING q.id
  )
  SELECT (SELECT COUNT(*) FROM seed), (SELECT COUNT(*) FROM enq)
    INTO v_seeded, v_enqueued;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'seo_intent_wave_seed',
    'system',
    'ok',
    jsonb_build_object(
      'wave', 3,
      'seeded', v_seeded,
      'enqueued', v_enqueued,
      'enqueue_source', 'wave3_seed_2026-05-15',
      'curricula', jsonb_build_array(
        'Steuerfachangestellter','Kfm. Groß- und Außenhandel','Industriemechaniker',
        'Mechatroniker','Verkäufer','Fachlagerist'
      )
    )
  );
END $$;