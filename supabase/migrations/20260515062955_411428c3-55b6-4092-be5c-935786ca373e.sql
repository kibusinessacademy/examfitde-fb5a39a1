DO $$
DECLARE
  v_seeded int;
  v_enqueued int;
BEGIN
  WITH anchors(curriculum_id, competency_id, package_id) AS (VALUES
    ('e06a570a-d810-410d-873a-c87229465f41'::uuid, 'c4e1ad2d-614f-4f39-95eb-da2019dbed9e'::uuid, 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'::uuid),
    ('bda2612f-9a21-48ee-a78b-606d59a7a8fc'::uuid, 'cc1a129e-7d4f-4ff7-a0f5-307e9688a79e'::uuid, '21c83a1a-a2f8-4351-ae6b-26fe0292641a'::uuid),
    ('3ca7fd74-9815-4525-9ebe-b6ec54218cd0'::uuid, 'e761c003-d93f-42ff-9970-b5e8cce14d70'::uuid, '4e32e53d-300a-402b-b37a-612d51426f85'::uuid),
    ('8620adb3-b494-4ee8-95fb-b9f836c8f2db'::uuid, '950ded4b-0544-456c-9c7c-ef915374e8af'::uuid, '060fa7ef-f9b9-4b5e-8590-de8f667ee34d'::uuid),
    ('71fc8bdb-ba5a-4808-8d37-3752eeee6d6b'::uuid, '894b3497-cd11-48af-a699-7c30e240bb5a'::uuid, 'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab'::uuid),
    ('7c5fb60a-d70f-4d5b-87cb-28e2663394e7'::uuid, '8252cdd0-e87f-4c3a-a7c9-a4d64ca380cb'::uuid, '56aee54d-5fd6-4f18-90c0-c6f7f493618a'::uuid)
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
             'enqueue_source', 'wave3b_seed_2026-05-15',
             'intent_template', sp.intent_key,
             'priority_queue_id', sp.id,
             'learning_field_filter', sp.intent_key || ':' || left(sp.competency_id::text, 8)
           ),
           'pending', 5
    FROM seed_with_pkg sp
    RETURNING id, payload
  )
  SELECT (SELECT COUNT(*) FROM seed), (SELECT COUNT(*) FROM enq)
    INTO v_seeded, v_enqueued;

  -- Fallback link (CTE-snapshot safe)
  UPDATE seo_content_priority_queue q
     SET job_id = jq.id,
         generation_status = 'queued',
         last_enqueued_at = COALESCE(q.last_enqueued_at, jq.created_at)
    FROM job_queue jq
   WHERE jq.payload->>'enqueue_source' = 'wave3b_seed_2026-05-15'
     AND (jq.payload->>'priority_queue_id')::uuid = q.id
     AND q.generation_status = 'ready';

  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'seo_intent_wave_seed',
    'system',
    'ok',
    jsonb_build_object(
      'wave', '3b',
      'seeded', v_seeded,
      'enqueued', v_enqueued,
      'enqueue_source', 'wave3b_seed_2026-05-15',
      'curricula', jsonb_build_array(
        'Elektroniker für Betriebstechnik','Chemielaborant',
        'Eisenbahner Lokführer','Chemikant','Drogist',
        'Elektroniker für Geräte und Systeme'
      )
    )
  );
END $$;