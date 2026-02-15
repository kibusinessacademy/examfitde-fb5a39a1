
-- ═══════════════════════════════════════════════════════════════
-- Vollautomatische fachliche Tiefe – korrekter doc_type
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_seed_curriculum_topics()
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
    JOIN curricula cur ON cur.id = lf.curriculum_id
    WHERE cur.status = 'frozen'
      AND NOT EXISTS (SELECT 1 FROM curriculum_topics ct WHERE ct.certification_id = lf.curriculum_id)
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
        ELSE NULL END,
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

CREATE OR REPLACE FUNCTION public.auto_link_certification_documents()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT cur.id as curriculum_id, b.rahmenlehrplan_url, b.verordnung_pdf_url
    FROM curricula cur
    JOIN berufe b ON b.id = cur.beruf_id
    WHERE cur.beruf_id IS NOT NULL
      AND (b.rahmenlehrplan_url IS NOT NULL OR b.verordnung_pdf_url IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM certification_documents cd WHERE cd.certification_id = cur.id)
  LOOP
    IF v_rec.rahmenlehrplan_url IS NOT NULL AND v_rec.rahmenlehrplan_url <> '' THEN
      INSERT INTO certification_documents (certification_id, doc_type, source_kind, source_url, status, legal_priority)
      VALUES (v_rec.curriculum_id, 'rahmenplan', 'url', v_rec.rahmenlehrplan_url, 'active', 80)
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
    IF v_rec.verordnung_pdf_url IS NOT NULL AND v_rec.verordnung_pdf_url <> '' THEN
      INSERT INTO certification_documents (certification_id, doc_type, source_kind, source_url, status, legal_priority)
      VALUES (v_rec.curriculum_id, 'verordnung', 'url', v_rec.verordnung_pdf_url, 'active', 100)
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_curriculum_freeze_seed_topics()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'frozen' AND (OLD.status IS NULL OR OLD.status <> 'frozen') THEN
    INSERT INTO curriculum_topics (certification_id, topic_name, topic_code, description, sort_order)
    SELECT NEW.id, lf.title, lf.code, 'Lernfeld ' || lf.code || ': ' || lf.title, lf.sort_order
    FROM learning_fields lf WHERE lf.curriculum_id = NEW.id
    ON CONFLICT DO NOTHING;

    INSERT INTO curriculum_topics (certification_id, topic_name, topic_code, description, parent_topic_id, difficulty_level, sort_order)
    SELECT NEW.id, comp.title, comp.code, comp.description,
      (SELECT ct.id FROM curriculum_topics ct WHERE ct.certification_id = NEW.id AND ct.topic_code = lf.code LIMIT 1),
      CASE 
        WHEN comp.taxonomy_level IN ('Wissen','Verstehen') THEN 'easy'
        WHEN comp.taxonomy_level IN ('Anwenden','Planen') THEN 'medium'
        WHEN comp.taxonomy_level IN ('Analysieren','Synthese','Bewerten') THEN 'hard'
        ELSE NULL END,
      ROW_NUMBER() OVER (PARTITION BY comp.learning_field_id ORDER BY comp.code)::int
    FROM competencies comp
    JOIN learning_fields lf ON lf.id = comp.learning_field_id
    WHERE lf.curriculum_id = NEW.id
    ON CONFLICT DO NOTHING;

    IF NEW.beruf_id IS NOT NULL THEN
      INSERT INTO certification_documents (certification_id, doc_type, source_kind, source_url, status, legal_priority)
      SELECT NEW.id, 'rahmenplan', 'url', b.rahmenlehrplan_url, 'active', 80
      FROM berufe b WHERE b.id = NEW.beruf_id AND b.rahmenlehrplan_url IS NOT NULL AND b.rahmenlehrplan_url <> ''
        AND NOT EXISTS (SELECT 1 FROM certification_documents cd WHERE cd.certification_id = NEW.id AND cd.doc_type = 'rahmenplan')
      ON CONFLICT DO NOTHING;
      INSERT INTO certification_documents (certification_id, doc_type, source_kind, source_url, status, legal_priority)
      SELECT NEW.id, 'verordnung', 'url', b.verordnung_pdf_url, 'active', 100
      FROM berufe b WHERE b.id = NEW.beruf_id AND b.verordnung_pdf_url IS NOT NULL AND b.verordnung_pdf_url <> ''
        AND NOT EXISTS (SELECT 1 FROM certification_documents cd WHERE cd.certification_id = NEW.id AND cd.doc_type = 'verordnung')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_curriculum_freeze_seed ON public.curricula;
CREATE TRIGGER trg_curriculum_freeze_seed
  AFTER UPDATE ON public.curricula
  FOR EACH ROW
  EXECUTE FUNCTION on_curriculum_freeze_seed_topics();

CREATE OR REPLACE FUNCTION public.auto_ops_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_retried int := 0; v_rescued int := 0; v_cleaned int := 0;
  v_unblocked int := 0; v_ingested int := 0; v_seeded int := 0;
  v_linked int := 0; v_priority_ceiling int;
BEGIN
  v_linked := auto_link_certification_documents();
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
    'linked_docs', v_linked, 'seeded_topics', v_seeded, 'ingested', v_ingested,
    'priority_ceiling', v_priority_ceiling,
    'retried', v_retried, 'rescued', v_rescued,
    'cleaned', v_cleaned, 'unblocked', v_unblocked, 'ts', now()
  );
END;
$$;

-- Sofort ausführen
SELECT auto_link_certification_documents();
SELECT auto_seed_curriculum_topics();
