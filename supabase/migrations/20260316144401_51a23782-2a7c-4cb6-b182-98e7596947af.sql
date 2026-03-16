
-- ═══════════════════════════════════════════════════════════════
-- Sharded Content Architecture v1
-- ═══════════════════════════════════════════════════════════════

-- 1. Shard tracking table
CREATE TABLE IF NOT EXISTS public.package_content_shards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  learning_field_id uuid NOT NULL,
  fanout_id uuid NOT NULL,
  chunk_index integer NOT NULL DEFAULT 1,
  chunk_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  lesson_target_count integer NOT NULL DEFAULT 0,
  lesson_generated_count integer NOT NULL DEFAULT 0,
  lesson_failed_count integer NOT NULL DEFAULT 0,
  claimed_by_job_id uuid NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  last_error text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, learning_field_id, fanout_id, chunk_index)
);

-- 2. Lesson generation tracking columns
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS generation_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS generation_job_id uuid NULL,
  ADD COLUMN IF NOT EXISTS generation_claimed_at timestamptz NULL;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_lessons_generation_status
  ON public.lessons(generation_status);
CREATE INDEX IF NOT EXISTS idx_lessons_generation_job_id
  ON public.lessons(generation_job_id) WHERE generation_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_package_content_shards_package_status
  ON public.package_content_shards(package_id, status);
CREATE INDEX IF NOT EXISTS idx_package_content_shards_fanout
  ON public.package_content_shards(fanout_id);
CREATE INDEX IF NOT EXISTS idx_package_content_shards_lf
  ON public.package_content_shards(learning_field_id, status);

-- 4. RLS
ALTER TABLE public.package_content_shards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.package_content_shards
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Detail view
CREATE OR REPLACE VIEW public.v_package_content_shard_progress AS
SELECT
  s.package_id, s.course_id, s.learning_field_id, s.fanout_id,
  s.status AS shard_status,
  s.lesson_target_count, s.lesson_generated_count, s.lesson_failed_count,
  s.started_at, s.completed_at, s.last_error,
  s.created_at, s.updated_at,
  CASE WHEN s.lesson_target_count > 0
    THEN round((s.lesson_generated_count::numeric / s.lesson_target_count) * 100, 1)
    ELSE 0 END AS progress_pct,
  lf.title AS learning_field_title,
  lf.sort_order AS lf_position
FROM public.package_content_shards s
LEFT JOIN public.learning_fields lf ON lf.id = s.learning_field_id
ORDER BY s.package_id, lf.sort_order NULLS LAST, s.chunk_index;

-- 6. Summary view
CREATE OR REPLACE VIEW public.v_package_shard_summary AS
SELECT
  s.package_id,
  count(*) AS total_shards,
  count(*) FILTER (WHERE s.status = 'pending') AS pending_shards,
  count(*) FILTER (WHERE s.status = 'processing') AS processing_shards,
  count(*) FILTER (WHERE s.status = 'completed') AS completed_shards,
  count(*) FILTER (WHERE s.status = 'failed') AS failed_shards,
  sum(s.lesson_target_count) AS total_lessons,
  sum(s.lesson_generated_count) AS total_generated,
  sum(s.lesson_failed_count) AS total_failed,
  CASE WHEN sum(s.lesson_target_count) > 0
    THEN round((sum(s.lesson_generated_count)::numeric / sum(s.lesson_target_count)) * 100, 1)
    ELSE 0 END AS overall_progress_pct,
  max(s.updated_at) AS last_activity_at,
  CASE WHEN count(*) FILTER (WHERE s.status IN ('pending','processing')) = 0
        AND count(*) FILTER (WHERE s.status = 'completed') > 0
    THEN true ELSE false END AS all_shards_complete
FROM public.package_content_shards s
GROUP BY s.package_id;

-- 7. Atomic lesson claiming RPC
CREATE OR REPLACE FUNCTION public.claim_lessons_for_shard(
  p_shard_id uuid,
  p_job_id uuid,
  p_learning_field_id uuid,
  p_course_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(lesson_id uuid, module_id uuid, title text) AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT l.id, l.module_id, l.title
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = p_course_id
      AND m.learning_field_id = p_learning_field_id
      AND COALESCE(l.generation_status, 'pending') IN ('pending', 'failed')
    ORDER BY l.position ASC NULLS LAST, l.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF l SKIP LOCKED
  )
  UPDATE public.lessons l
  SET generation_status = 'claimed',
      generation_job_id = p_job_id,
      generation_claimed_at = now()
  FROM claimable c
  WHERE l.id = c.id
  RETURNING l.id AS lesson_id, l.module_id, l.title;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Shard progress update RPC
CREATE OR REPLACE FUNCTION public.update_shard_progress(
  p_shard_id uuid,
  p_generated_count integer,
  p_failed_count integer DEFAULT 0,
  p_status text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE public.package_content_shards
  SET lesson_generated_count = p_generated_count,
      lesson_failed_count = p_failed_count,
      status = COALESCE(p_status, status),
      last_error = p_error,
      completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_shard_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Batch shard creation RPC
CREATE OR REPLACE FUNCTION public.create_content_shards(
  p_package_id uuid,
  p_course_id uuid,
  p_fanout_id uuid,
  p_shards jsonb
)
RETURNS integer AS $$
DECLARE
  shard_count integer := 0;
  shard_item jsonb;
BEGIN
  FOR shard_item IN SELECT * FROM jsonb_array_elements(p_shards)
  LOOP
    INSERT INTO public.package_content_shards (
      package_id, course_id, learning_field_id, fanout_id,
      chunk_index, chunk_count, lesson_target_count, status
    ) VALUES (
      p_package_id, p_course_id,
      (shard_item->>'learning_field_id')::uuid,
      p_fanout_id,
      COALESCE((shard_item->>'chunk_index')::integer, 1),
      COALESCE((shard_item->>'chunk_count')::integer, 1),
      COALESCE((shard_item->>'lesson_count')::integer, 0),
      'pending'
    )
    ON CONFLICT (package_id, learning_field_id, fanout_id, chunk_index)
    DO UPDATE SET
      lesson_target_count = EXCLUDED.lesson_target_count,
      status = CASE WHEN package_content_shards.status IN ('completed','failed') THEN 'pending'
                    ELSE package_content_shards.status END,
      lesson_generated_count = 0,
      lesson_failed_count = 0,
      last_error = NULL,
      updated_at = now();
    shard_count := shard_count + 1;
  END LOOP;
  RETURN shard_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
