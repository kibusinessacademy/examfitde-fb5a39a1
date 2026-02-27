
-- ═══════════════════════════════════════════════════════════
-- Version-Locked Exam Sessions
-- Sessions are pinned to the package version at creation time
-- ═══════════════════════════════════════════════════════════

-- 1. Add package_id to exam_sessions (nullable for existing rows)
ALTER TABLE public.exam_sessions
  ADD COLUMN IF NOT EXISTS package_id uuid NULL;

CREATE INDEX IF NOT EXISTS exam_sessions_package_idx ON public.exam_sessions(package_id);

-- 2. Backfill: Link existing sessions to current active package via curriculum
-- Each session has curriculum_id → find the active published package for that curriculum
UPDATE public.exam_sessions es
SET package_id = cp.id
FROM public.course_packages cp
WHERE cp.curriculum_id = es.curriculum_id
  AND cp.is_published = true
  AND es.package_id IS NULL;

-- Fallback: if is_published not set yet, use status = 'published'
UPDATE public.exam_sessions es
SET package_id = cp.id
FROM public.course_packages cp
WHERE cp.curriculum_id = es.curriculum_id
  AND cp.status = 'published'
  AND es.package_id IS NULL;

-- 3. RPC to get version-locked active package for session creation
CREATE OR REPLACE FUNCTION public.get_active_package_for_curriculum(p_curriculum_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cp.id
  FROM course_packages cp
  JOIN products p ON p.active_package_id = cp.id
  WHERE cp.curriculum_id = p_curriculum_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_package_for_curriculum TO authenticated, service_role;
