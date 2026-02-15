
-- ============================================================
-- Convert learning_fields + competencies → curriculum_topics
-- Fix: source_kind must be 'url' (not 'bibb_profil')
-- ============================================================

-- 1) Insert learning_fields as PARENT curriculum_topics
INSERT INTO curriculum_topics (
  id, certification_id, topic_name, topic_code, description, 
  parent_topic_id, weight_percentage, sort_order, created_at
)
SELECT 
  gen_random_uuid(), lf.curriculum_id, lf.title, lf.code,
  'Lernfeld ' || lf.code || ': ' || lf.title || COALESCE(' (' || lf.hours || ' Stunden)', ''),
  NULL,
  CASE WHEN th.total_hours > 0 THEN ROUND((lf.hours::numeric / th.total_hours) * 100, 1) ELSE NULL END,
  lf.sort_order, now()
FROM learning_fields lf
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(lf2.hours), 0) as total_hours 
  FROM learning_fields lf2 WHERE lf2.curriculum_id = lf.curriculum_id
) th
WHERE lf.curriculum_id IN (SELECT curriculum_id FROM course_packages WHERE priority <= 100)
  AND NOT EXISTS (
    SELECT 1 FROM curriculum_topics ct 
    WHERE ct.certification_id = lf.curriculum_id AND ct.topic_code = lf.code
  )
ON CONFLICT DO NOTHING;

-- 2) Insert competencies as CHILD curriculum_topics (Bloom→difficulty mapping)
INSERT INTO curriculum_topics (
  id, certification_id, topic_name, topic_code, description,
  parent_topic_id, difficulty_level, learning_objectives, sort_order, created_at
)
SELECT 
  gen_random_uuid(), lf.curriculum_id, comp.title, comp.code, comp.description,
  (SELECT ct.id FROM curriculum_topics ct 
   WHERE ct.certification_id = lf.curriculum_id AND ct.topic_code = lf.code LIMIT 1),
  CASE 
    WHEN comp.taxonomy_level IN ('Wissen','Verstehen') THEN 'easy'
    WHEN comp.taxonomy_level IN ('Anwenden','Planen') THEN 'medium'
    WHEN comp.taxonomy_level IN ('Analysieren','Synthese','Bewerten') THEN 'hard'
    ELSE NULL
  END,
  CASE WHEN comp.description IS NOT NULL THEN ARRAY[comp.description] ELSE NULL END,
  ROW_NUMBER() OVER (PARTITION BY comp.learning_field_id ORDER BY comp.code)::int,
  now()
FROM competencies comp
JOIN learning_fields lf ON lf.id = comp.learning_field_id
WHERE lf.curriculum_id IN (SELECT curriculum_id FROM course_packages WHERE priority <= 100)
  AND NOT EXISTS (
    SELECT 1 FROM curriculum_topics ct 
    WHERE ct.certification_id = lf.curriculum_id 
      AND ct.topic_code = comp.code AND ct.parent_topic_id IS NOT NULL
  )
ON CONFLICT DO NOTHING;

-- 3) Auto-link BIBB profile URLs (source_kind = 'url')
INSERT INTO certification_documents (
  id, certification_id, doc_type, source_kind, source_url, 
  legal_priority, status, created_at
)
SELECT DISTINCT ON (lf.curriculum_id)
  gen_random_uuid(), lf.curriculum_id, 'rahmenplan', 'url',
  b.bibb_profil_url, 50, 'active', now()
FROM learning_fields lf
JOIN curricula c ON c.id = lf.curriculum_id
JOIN berufe b ON c.title ILIKE '%' || b.bezeichnung_kurz || '%'
WHERE lf.curriculum_id IN (SELECT curriculum_id FROM course_packages WHERE priority <= 100)
  AND b.bibb_profil_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM certification_documents cd 
    WHERE cd.certification_id = lf.curriculum_id AND cd.status = 'active'
  )
ORDER BY lf.curriculum_id, b.bibb_profil_url
ON CONFLICT DO NOTHING;

-- 4) Link verordnung PDFs (source_kind = 'url')
INSERT INTO certification_documents (
  id, certification_id, doc_type, source_kind, source_url,
  legal_priority, status, created_at
)
SELECT DISTINCT ON (lf.curriculum_id)
  gen_random_uuid(), lf.curriculum_id, 'verordnung', 'url',
  b.verordnung_pdf_url, 90, 'active', now()
FROM learning_fields lf
JOIN curricula c ON c.id = lf.curriculum_id
JOIN berufe b ON c.title ILIKE '%' || b.bezeichnung_kurz || '%'
WHERE lf.curriculum_id IN (SELECT curriculum_id FROM course_packages WHERE priority <= 100)
  AND b.verordnung_pdf_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM certification_documents cd 
    WHERE cd.certification_id = lf.curriculum_id AND cd.doc_type = 'verordnung' AND cd.status = 'active'
  )
ORDER BY lf.curriculum_id, b.verordnung_pdf_url
ON CONFLICT DO NOTHING;

-- 5) Mark curriculum_ingest steps as 'done' where topics exist
UPDATE package_steps ps
SET status = 'done', updated_at = now()
WHERE ps.step_key = 'curriculum_ingest'
  AND ps.status != 'done'
  AND EXISTS (
    SELECT 1 FROM curriculum_topics ct 
    WHERE ct.certification_id = (
      SELECT cp.curriculum_id FROM course_packages cp WHERE cp.id = ps.package_id
    )
  );

-- 6) Auto-seed function for future curricula
CREATE OR REPLACE FUNCTION auto_seed_curriculum_topics()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT lf.curriculum_id
    FROM learning_fields lf
    WHERE NOT EXISTS (SELECT 1 FROM curriculum_topics ct WHERE ct.certification_id = lf.curriculum_id)
      AND EXISTS (SELECT 1 FROM course_packages cp WHERE cp.curriculum_id = lf.curriculum_id)
  LOOP
    INSERT INTO curriculum_topics (certification_id, topic_name, topic_code, description, sort_order)
    SELECT v_rec.curriculum_id, lf.title, lf.code,
      'Lernfeld ' || lf.code || ': ' || lf.title, lf.sort_order
    FROM learning_fields lf WHERE lf.curriculum_id = v_rec.curriculum_id
    ON CONFLICT DO NOTHING;

    INSERT INTO curriculum_topics (certification_id, topic_name, topic_code, description, parent_topic_id, difficulty_level, sort_order)
    SELECT v_rec.curriculum_id, comp.title, comp.code, comp.description,
      (SELECT ct.id FROM curriculum_topics ct WHERE ct.certification_id = v_rec.curriculum_id AND ct.topic_code = lf.code LIMIT 1),
      CASE 
        WHEN comp.taxonomy_level IN ('Wissen','Verstehen') THEN 'easy'
        WHEN comp.taxonomy_level IN ('Anwenden','Planen') THEN 'medium'
        WHEN comp.taxonomy_level IN ('Analysieren','Synthese','Bewerten') THEN 'hard'
        ELSE NULL
      END,
      ROW_NUMBER() OVER (PARTITION BY comp.learning_field_id ORDER BY comp.code)::int
    FROM competencies comp
    JOIN learning_fields lf ON lf.id = comp.learning_field_id
    WHERE lf.curriculum_id = v_rec.curriculum_id
    ON CONFLICT DO NOTHING;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- 7) Update auto_ops_cycle with topic seeding
CREATE OR REPLACE FUNCTION auto_ops_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_retried int := 0; v_rescued int := 0; v_cleaned int := 0;
  v_unblocked int := 0; v_ingested int := 0; v_seeded int := 0;
  v_priority_ceiling int;
BEGIN
  v_seeded := auto_seed_curriculum_topics();
  v_ingested := auto_trigger_curriculum_ingest();
  v_priority_ceiling := get_priority_ceiling();
  PERFORM enforce_priority_gate();

  WITH r AS (
    UPDATE job_queue SET status='pending', run_after=now()+interval '30s', updated_at=now()
    WHERE status='failed' AND attempts < max_attempts AND priority <= v_priority_ceiling RETURNING id
  ) SELECT count(*) INTO v_retried FROM r;

  WITH r AS (
    UPDATE job_queue SET status='pending', run_after=now()+interval '1m', updated_at=now()
    WHERE status='processing' AND updated_at < now()-interval '10m' RETURNING id
  ) SELECT count(*) INTO v_rescued FROM r;

  WITH r AS (
    DELETE FROM job_queue WHERE status IN ('completed','cancelled') AND updated_at < now()-interval '24h' RETURNING id
  ) SELECT count(*) INTO v_cleaned FROM r;

  WITH r AS (
    UPDATE course_packages cp SET status='queued', blocked_reason=NULL, updated_at=now()
    WHERE cp.status='blocked' AND cp.priority <= v_priority_ceiling
      AND EXISTS (SELECT 1 FROM curricula c WHERE c.id=cp.curriculum_id AND c.status='frozen')
      AND EXISTS (SELECT 1 FROM curriculum_topics ct WHERE ct.certification_id=cp.curriculum_id)
    RETURNING cp.id
  ) SELECT count(*) INTO v_unblocked FROM r;

  RETURN jsonb_build_object(
    'seeded_topics', v_seeded, 'ingested', v_ingested,
    'priority_ceiling', v_priority_ceiling,
    'retried', v_retried, 'rescued', v_rescued,
    'cleaned', v_cleaned, 'unblocked', v_unblocked, 'ts', now()
  );
END;
$$;
