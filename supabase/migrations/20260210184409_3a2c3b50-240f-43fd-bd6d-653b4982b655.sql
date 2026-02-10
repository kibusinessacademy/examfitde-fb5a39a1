
-- 1) AutoPilot Status on courses
ALTER TABLE public.courses 
ADD COLUMN IF NOT EXISTS autopilot_status text NOT NULL DEFAULT 'idle'
  CHECK (autopilot_status IN ('idle', 'running', 'generating', 'finalizing', 'sealed'));

ALTER TABLE public.courses
ADD COLUMN IF NOT EXISTS autopilot_started_at timestamptz,
ADD COLUMN IF NOT EXISTS autopilot_sealed_at timestamptz,
ADD COLUMN IF NOT EXISTS autopilot_runner_id text;

-- 2) Course health snapshots (taken at seal time and periodically)
CREATE TABLE IF NOT EXISTS public.course_health_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  snapshot_type text NOT NULL DEFAULT 'seal', -- seal, periodic, manual
  lesson_count integer NOT NULL DEFAULT 0,
  competency_count integer NOT NULL DEFAULT 0,
  covered_competency_count integer NOT NULL DEFAULT 0,
  step_distribution jsonb DEFAULT '{}',
  duplicate_titles integer NOT NULL DEFAULT 0,
  empty_content_count integer NOT NULL DEFAULT 0,
  avg_word_count integer NOT NULL DEFAULT 0,
  health_score numeric(5,2) NOT NULL DEFAULT 0,
  health_status text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'warning', 'critical', 'unknown')),
  issues jsonb DEFAULT '[]',
  benchmarks jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.course_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view health snapshots"
  ON public.course_health_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can manage health snapshots"
  ON public.course_health_snapshots FOR ALL
  USING (true) WITH CHECK (true);

-- 3) Post-validation results
CREATE TABLE IF NOT EXISTS public.post_validation_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  validation_type text NOT NULL, -- dedup, missing_steps, ihk_terms, consistency
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  findings jsonb DEFAULT '[]',
  auto_fixed integer NOT NULL DEFAULT 0,
  manual_review integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.post_validation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view validation results"
  ON public.post_validation_results FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can manage validation results"
  ON public.post_validation_results FOR ALL
  USING (true) WITH CHECK (true);

-- 4) Guard: prevent parallel autopilot starts (unique partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_autopilot_running 
  ON public.courses (curriculum_id) 
  WHERE autopilot_status IN ('running', 'generating', 'finalizing');

-- 5) Add job types to job_queue for the new workers
COMMENT ON TABLE public.course_health_snapshots IS 'Stores health metrics snapshots for courses, taken at seal time or periodically';
COMMENT ON TABLE public.post_validation_results IS 'Stores results from post-generation validation runs (dedup, missing steps, IHK terms)';
