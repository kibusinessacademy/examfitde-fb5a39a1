
-- ═══════════════════════════════════════════════════════════════
-- Sharded Content Fan-Out Architecture: DB Schema
-- ═══════════════════════════════════════════════════════════════

-- 1. package_content_shards — tracks fan-out shards per learning field
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
  claimed_by_job_id uuid NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  last_error text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, learning_field_id, fanout_id, chunk_index)
);

ALTER TABLE public.package_content_shards ENABLE ROW LEVEL SECURITY;

-- 2. Indexes for shard lookups
CREATE INDEX IF NOT EXISTS idx_package_content_shards_package_status
  ON public.package_content_shards(package_id, status);

CREATE INDEX IF NOT EXISTS idx_package_content_shards_fanout
  ON public.package_content_shards(fanout_id);

CREATE INDEX IF NOT EXISTS idx_lessons_generation_status
  ON public.lessons(generation_status);

-- 3. Atomic lesson claiming RPC
CREATE OR REPLACE FUNCTION public.claim_lessons_for_shard(
  p_course_id uuid,
  p_learning_field_id uuid,
  p_job_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS SETOF uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate AS (
    SELECT l.id
    FROM public.lessons l
    JOIN public.modules m ON l.module_id = m.id
    WHERE m.course_id = p_course_id
      AND m.learning_field_id = p_learning_field_id
      AND COALESCE(l.generation_status, 'pending') IN ('pending', 'failed')
    ORDER BY l.sort_order ASC NULLS LAST, l.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF l SKIP LOCKED
  )
  UPDATE public.lessons l
  SET
    generation_status = 'claimed',
    generation_job_id = p_job_id,
    generation_claimed_at = now()
  FROM candidate c
  WHERE l.id = c.id
  RETURNING l.id;
$$;

-- 4. Shard progress RPC for finalize barrier
CREATE OR REPLACE FUNCTION public.get_shard_progress(p_fanout_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_shards', COUNT(*),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'failed', COUNT(*) FILTER (WHERE status = 'failed'),
    'processing', COUNT(*) FILTER (WHERE status IN ('processing', 'claimed')),
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'all_done', BOOL_AND(status IN ('completed', 'skipped')),
    'has_failures', BOOL_OR(status = 'failed'),
    'total_lessons', COALESCE(SUM(lesson_target_count), 0),
    'generated_lessons', COALESCE(SUM(lesson_generated_count), 0)
  )
  FROM public.package_content_shards
  WHERE fanout_id = p_fanout_id;
$$;

-- 5. Lesson generation progress per learning field (for admin view)
CREATE OR REPLACE FUNCTION public.get_content_shard_overview(p_package_id uuid)
RETURNS TABLE(
  shard_id uuid,
  learning_field_id uuid,
  status text,
  lesson_target_count integer,
  lesson_generated_count integer,
  chunk_index integer,
  chunk_count integer,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  fanout_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.learning_field_id,
    s.status,
    s.lesson_target_count,
    s.lesson_generated_count,
    s.chunk_index,
    s.chunk_count,
    s.last_error,
    s.started_at,
    s.completed_at,
    s.fanout_id
  FROM public.package_content_shards s
  WHERE s.package_id = p_package_id
  ORDER BY s.created_at ASC;
$$;
