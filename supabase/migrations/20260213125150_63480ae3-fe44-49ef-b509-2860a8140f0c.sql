
-- Add unique index on curriculum_topics for idempotent upserts
-- Using (certification_id, source_document_id, parent_topic_id, topic_code) as the natural key
CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_topics_idempotent
  ON public.curriculum_topics (certification_id, COALESCE(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(parent_topic_id, '00000000-0000-0000-0000-000000000000'::uuid), topic_code)
  WHERE topic_code IS NOT NULL;

-- Also add a fallback index for name-based dedup when topic_code is null
CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_topics_name_dedup
  ON public.curriculum_topics (certification_id, COALESCE(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(parent_topic_id, '00000000-0000-0000-0000-000000000000'::uuid), topic_name)
  WHERE topic_code IS NULL;

-- Add sort_order column if not exists
DO $$ BEGIN
  ALTER TABLE public.curriculum_topics ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Seed the Wirtschaftsfachwirt Verordnung PDF as a real document
INSERT INTO public.certification_documents (certification_id, doc_type, source_kind, source_url, legal_priority, status, version_label)
VALUES (
  'c09b2c12-0c63-4d76-9544-4e1062eb59b6',
  'verordnung',
  'url',
  'https://www.gesetze-im-internet.de/wfachwprv/WFachwPrV.pdf',
  100,
  'active',
  '2024'
)
ON CONFLICT DO NOTHING;
