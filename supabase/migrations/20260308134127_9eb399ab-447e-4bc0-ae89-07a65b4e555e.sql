-- Fix beruf_id mapping for Phase 2 curricula
UPDATE curricula SET beruf_id = (
  SELECT b.id FROM berufe b 
  WHERE lower(b.bezeichnung_kurz) ILIKE '%büro%' 
     OR lower(b.bezeichnung_lang) ILIKE '%büromanagement%' 
  LIMIT 1
) WHERE id = 'bd547ecd-6491-4e1f-a581-b2a9718bfee2' AND beruf_id IS NULL;

UPDATE curricula SET beruf_id = (
  SELECT b.id FROM berufe b 
  WHERE lower(b.bezeichnung_kurz) ILIKE '%elektronik%energie%' 
     OR lower(b.bezeichnung_lang) ILIKE '%elektronik%' 
  LIMIT 1
) WHERE id = '45e6ea8a-6a16-4fa7-94b0-f7707ce53c1c' AND beruf_id IS NULL;

UPDATE curricula SET beruf_id = (
  SELECT b.id FROM berufe b 
  WHERE lower(b.bezeichnung_kurz) ILIKE '%fachinformatik%' 
     OR lower(b.bezeichnung_lang) ILIKE '%fachinformatik%anwendung%' 
  LIMIT 1
) WHERE id = 'a8a6340d-fd50-445f-a55b-7d5a6c72e2e1' AND beruf_id IS NULL;

UPDATE curricula SET beruf_id = (
  SELECT b.id FROM berufe b 
  WHERE lower(b.bezeichnung_kurz) ILIKE '%verkäufer%' 
     OR lower(b.bezeichnung_lang) ILIKE '%verkäufer%' 
  LIMIT 1
) WHERE id = '8e8f0f32-d21f-4871-a23d-ed1570cc3fa7' AND beruf_id IS NULL;

-- Trigger enrichment jobs (without curriculum_id column)
INSERT INTO job_queue (job_type, status, attempts, max_attempts, payload, run_after)
SELECT 
  'generate_curriculum_content',
  'pending',
  0,
  5,
  jsonb_build_object('curriculum_id', c.id, 'triggered_by', 'wave_e_phase2_enrichment'),
  now()
FROM curricula c
WHERE c.id IN (
  'bd547ecd-6491-4e1f-a581-b2a9718bfee2',
  '45e6ea8a-6a16-4fa7-94b0-f7707ce53c1c',
  'a8a6340d-fd50-445f-a55b-7d5a6c72e2e1',
  '8e8f0f32-d21f-4871-a23d-ed1570cc3fa7',
  '1f49fe35-ad16-4718-82a1-447b321c42f7'
);