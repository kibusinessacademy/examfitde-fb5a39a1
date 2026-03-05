-- Patch 1: DB Hardening — Indices for needs_regen queries + scheduler performance

-- 1) Lessons join acceleration
CREATE INDEX IF NOT EXISTS idx_lessons_module_id ON public.lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_lessons_qc_status ON public.lessons(qc_status);

-- 2) Modules join acceleration
CREATE INDEX IF NOT EXISTS idx_modules_course_id ON public.modules(course_id);

-- 3) content_versions lookup (lesson_id + step_key + status)
CREATE INDEX IF NOT EXISTS idx_content_versions_lesson_step_status
  ON public.content_versions(lesson_id, step_key, status);

-- 4) job_queue: frequent filter pattern (job_type + status + created_at)
CREATE INDEX IF NOT EXISTS idx_job_queue_type_status_created
  ON public.job_queue(job_type, status, created_at DESC);